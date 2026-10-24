import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

/**
 * Phase 2-A hardening: Cloudflare Access assertion, admin audit actors, user sessions,
 * log hygiene, CORS allow-list, audit field cleaning, seat race, account deletion scrub.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-sec-2a-"));
const originalCwd = process.cwd();
const adminSecret = "vynor-security-2a-admin-secret-32chars!!";
const TEAM = "vynor-test.cloudflareaccess.com";
const AUD = "aud-tag-1234567890";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const KID = "kid-1";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256" };
const otherPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

let dbm: typeof import("../src/db.js");
let server: import("node:http").Server;
let baseUrl = "";

function accessJwt(
  claims: Record<string, unknown> = {},
  options: jwt.SignOptions & { key?: crypto.KeyObject } = {},
) {
  const { key, ...signOptions } = options;
  return jwt.sign({ email: "staff@vynor.lk", ...claims }, key ?? privateKey, {
    algorithm: "RS256",
    keyid: KID,
    audience: AUD,
    issuer: `https://${TEAM}`,
    expiresIn: "5m",
    ...signOptions,
  });
}

before(async () => {
  process.chdir(tempDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = adminSecret;
  process.env.DB_DRIVER = "sqlite";
  delete process.env.DATABASE_URL;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  // The plan override table is created by the plan manager at boot, not by initDb().
  await (await import("../src/services/planManager.js")).initPlanManager();
  const express = (await import("express")).default;
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUD;
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
});

async function configureAccess() {
  const { setCfAccessJwksFetcherForTests } = await import(
    "../src/services/cfAccess.js"
  );
  process.env.CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.CF_ACCESS_AUD = AUD;
  setCfAccessJwksFetcherForTests(async () => ({ keys: [jwk as any] }));
}
async function unconfigureAccess() {
  const { setCfAccessJwksFetcherForTests } = await import(
    "../src/services/cfAccess.js"
  );
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUD;
  setCfAccessJwksFetcherForTests(undefined);
}

// ── 1. Cloudflare Access assertion ────────────────────────────────────────────

test("with Access configured, the e-mail header alone grants nothing", async () => {
  await configureAccess();
  try {
    const forged = await fetch(`${baseUrl}/admin/session`, {
      headers: { "cf-access-authenticated-user-email": "attacker@evil.test" },
    });
    assert.equal(forged.status, 401);
    const health = await fetch(`${baseUrl}/admin/health`, {
      headers: {
        "cf-access-authenticated-user-email": "attacker@evil.test",
        "cf-access-jwt-assertion": "not.a.jwt",
      },
    });
    assert.equal(health.status, 401);
  } finally {
    await unconfigureAccess();
  }
});

test("a verified assertion is accepted and its e-mail becomes the audit actor", async () => {
  await configureAccess();
  try {
    const res = await fetch(`${baseUrl}/admin/session`, {
      headers: {
        "cf-access-authenticated-user-email": "staff@vynor.lk",
        "cf-access-jwt-assertion": accessJwt(),
      },
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.authMethod, "cloudflare_zero_trust");
    assert.equal(body.email, "staff@vynor.lk");
  } finally {
    await unconfigureAccess();
  }
});

test("assertions with the wrong audience, issuer, key, algorithm, expiry or e-mail are rejected", async () => {
  await configureAccess();
  try {
    const { verifyCfAccessAssertion } = await import(
      "../src/services/cfAccess.js"
    );
    const ok = await verifyCfAccessAssertion(accessJwt(), "staff@vynor.lk");
    assert.equal(ok.ok, true);
    const cases: Array<[string, string, string]> = [
      [
        "wrong audience",
        accessJwt({}, { audience: "other" }),
        "staff@vynor.lk",
      ],
      [
        "wrong issuer",
        accessJwt({}, { issuer: "https://evil.example" }),
        "staff@vynor.lk",
      ],
      [
        "signed with another key",
        accessJwt({}, { key: otherPair.privateKey }),
        "staff@vynor.lk",
      ],
      ["expired", accessJwt({}, { expiresIn: -60 }), "staff@vynor.lk"],
      ["header e-mail differs from the claim", accessJwt(), "other@vynor.lk"],
      [
        "HS256 token using the public key text as secret",
        jwt.sign(
          { email: "staff@vynor.lk" },
          publicKey.export({ type: "spki", format: "pem" }) as string,
          {
            algorithm: "HS256",
            keyid: KID,
            audience: AUD,
            issuer: `https://${TEAM}`,
          },
        ),
        "staff@vynor.lk",
      ],
      [
        "unknown key id",
        accessJwt({}, { keyid: "rotated-away" }),
        "staff@vynor.lk",
      ],
    ];
    for (const [name, token, email] of cases) {
      const result = await verifyCfAccessAssertion(token, email);
      assert.equal(result.ok, false, name);
    }
  } finally {
    await unconfigureAccess();
  }
});

test("without CF_ACCESS settings the header is ignored outside the test runner (fail closed)", async () => {
  await unconfigureAccess();
  const previous = process.env.NODE_ENV;
  for (const env of ["production", "development", undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    try {
      const res = await fetch(`${baseUrl}/admin/session`, {
        headers: { "cf-access-authenticated-user-email": "attacker@evil.test" },
      });
      assert.equal(res.status, 401, `NODE_ENV=${env}`);
    } finally {
      process.env.NODE_ENV = previous;
    }
  }
  // The admin secret keeps working, so nobody is locked out.
  const bySecret = await fetch(`${baseUrl}/admin/session`, {
    headers: { "x-admin-secret": adminSecret },
  });
  assert.equal(bySecret.status, 200);
});

test("the Cloudflare team domain must be a plain host name", async () => {
  const { readCfAccessConfig } = await import("../src/services/cfAccess.js");
  assert.equal(
    readCfAccessConfig({
      CF_ACCESS_TEAM_DOMAIN: "evil.test/../x",
      CF_ACCESS_AUD: "a",
    } as any),
    undefined,
  );
  assert.equal(
    readCfAccessConfig({
      CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com/",
      CF_ACCESS_AUD: "a",
    } as any)?.teamDomain,
    "team.cloudflareaccess.com",
  );
  assert.equal(
    readCfAccessConfig({ CF_ACCESS_TEAM_DOMAIN: "team.example" } as any),
    undefined,
  );
});

// ── 2. Admin audit actor + error codes + caps ─────────────────────────────────

const adminHeaders = {
  "content-type": "application/json",
  "x-admin-secret": adminSecret,
};

async function insertUser(id: string, email = `${id}@example.com`) {
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name) VALUES (?, ?, 'x', ?, ?, 'T')",
    [id, email, `key-${id}`, `hash-${id}`],
  );
}

test("admin actions are attributed to a verified admin and never log the user's e-mail", async () => {
  await insertUser("u-audit-1", "private.person@example.com");
  const res = await fetch(`${baseUrl}/admin/users/u-audit-1/toggle-suspend`, {
    method: "POST",
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  const rows = await dbm.dbAll<any>(
    "SELECT actor, target, details FROM security_audit_logs WHERE event_type IN ('ADMIN_USER_SUSPENDED','ADMIN_USER_REACTIVATED')",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "admin-secret");
  assert.equal(rows[0].target, "user:u-audit-1");
  assert.ok(!JSON.stringify(rows).includes("private.person@example.com"));
});

test("plan edits and model switches write metadata-only audit events", async () => {
  const res = await fetch(`${baseUrl}/admin/plans/pro`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ monthly_requests: 1234 }),
  });
  assert.equal(res.status, 200);
  const rows = await dbm.dbAll<any>(
    "SELECT actor, target, details FROM security_audit_logs WHERE event_type = 'ADMIN_PLAN_UPDATED'",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, "plan:pro");
  assert.match(rows[0].details, /monthly_requests/);
  assert.ok(!rows[0].details.includes("1234"));
  await fetch(`${baseUrl}/admin/plans/pro/override`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  const cleared = await dbm.dbAll<any>(
    "SELECT 1 FROM security_audit_logs WHERE event_type = 'ADMIN_PLAN_OVERRIDE_CLEARED'",
  );
  assert.equal(cleared.length, 1);
});

test("grant days and top-up tokens are bounded; a grant leaves exactly one active subscription", async () => {
  await insertUser("u-grant-1");
  const tooLong = await fetch(
    `${baseUrl}/admin/users/u-grant-1/grant-subscription`,
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ plan: "pro", days: 9_999_999 }),
    },
  );
  assert.equal(tooLong.status, 400);
  const hugeTopup = await fetch(`${baseUrl}/admin/users/u-grant-1/add-tokens`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ tokens: 10 ** 15 }),
  });
  assert.equal(hugeTopup.status, 400);
  const ok = await fetch(
    `${baseUrl}/admin/users/u-grant-1/grant-subscription`,
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ plan: "pro", days: 30 }),
    },
  );
  assert.equal(ok.status, 200);
  const active = await dbm.dbAll<any>(
    "SELECT plan_name FROM subscriptions WHERE user_id = ? AND status = 'active'",
    ["u-grant-1"],
  );
  assert.equal(active.length, 1);
});

test("admin error bodies carry stable codes, never raw error text", async () => {
  const { adminErrorBody, stableAdminMessage } = await import(
    "../src/routes/admin.js"
  );
  const leaked = adminErrorBody(
    new Error(
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: provider_keys.secret=sk-live-123",
    ),
  );
  assert.equal(leaked.code, "ADMIN_REQUEST_REJECTED");
  assert.ok(!JSON.stringify(leaked).includes("sk-live"));
  assert.equal(
    adminErrorBody({ code: "KEY_LABEL_TAKEN" }).code,
    "KEY_LABEL_TAKEN",
  );
  assert.equal(
    stableAdminMessage(new Error("CLOUD_MANIFEST_NOT_FOUND"), "X"),
    "CLOUD_MANIFEST_NOT_FOUND",
  );
  assert.equal(
    stableAdminMessage(new Error("path /etc/passwd"), "CLOUD_X"),
    "CLOUD_X",
  );
});

// ── 3. Seat race and identity re-point ────────────────────────────────────────

test("two admins racing for the last seat cannot both get it, and a re-point is audited", async () => {
  const tenant = "66666666-6666-4666-8666-666666666666";
  await fetch(`${baseUrl}/admin/m365/tenants/${tenant}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      status: "enabled",
      allowedScopes: ["m365.excel.read"],
      planId: "pro",
      seatLimit: 1,
      subscriptionValidUntil: "2099-01-01T00:00:00.000Z",
    }),
  });
  await insertUser("u-seat-a");
  await insertUser("u-seat-b");
  const link = (objectId: string, userId: string) =>
    fetch(`${baseUrl}/admin/m365/identities/${tenant}/${objectId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ userId, enabled: true }),
    });
  const [first, second] = await Promise.all([
    link("obj-aaaa-1111", "u-seat-a"),
    link("obj-bbbb-2222", "u-seat-b"),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const seats = await dbm.dbAll<any>(
    "SELECT COUNT(*) AS c FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
    [tenant],
  );
  assert.equal(Number(seats[0].c), 1);

  // Re-pointing the existing identity to another user is allowed but records who owned it before.
  const owner = await dbm.dbGet<any>(
    "SELECT object_id, user_id FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
    [tenant],
  );
  const target = owner.user_id === "u-seat-a" ? "u-seat-b" : "u-seat-a";
  const moved = await link(owner.object_id, target);
  assert.equal(moved.status, 200);
  const audit = await dbm.dbAll<any>(
    "SELECT details FROM security_audit_logs WHERE event_type = 'M365_IDENTITY_RELINKED'",
  );
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].details).previousUserId, owner.user_id);
});

// ── 4. User sessions ──────────────────────────────────────────────────────────

test("a user session ends when the password changes, and other token kinds are not sessions", async () => {
  const { config } = await import("../src/config.js");
  const { signUserSession, verifyUserSession, sessionPredatesPasswordChange } =
    await import("../src/services/userSession.js");
  const token = signUserSession({ userId: "u1", email: "a@b.co" }, "hash-1");
  const session = verifyUserSession(token);
  assert.equal(session.userId, "u1");
  assert.equal(sessionPredatesPasswordChange(session, "hash-1"), false);
  assert.equal(sessionPredatesPasswordChange(session, "hash-2"), true);

  // A legacy token (raw secret, no kind) still works during the 30 day window.
  const legacy = jwt.sign({ userId: "u1", email: "a@b.co" }, config.jwtSecret, {
    expiresIn: "30d",
  });
  assert.equal(verifyUserSession(legacy).legacy, true);

  // Tokens minted for another purpose with the same secret must never be accepted as a session.
  const background = jwt.sign(
    { taskId: "t1", userId: "u1", scope: "background:model" },
    config.jwtSecret,
  );
  assert.throws(() => verifyUserSession(background));
  const m365 = jwt.sign(
    { userId: "u1", kind: "m365_session" },
    config.jwtSecret,
  );
  assert.throws(() => verifyUserSession(m365));
  // An unsigned (alg none) token is rejected.
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"userId":"u1","kind":"user_session"}').toString("base64url")}.`;
  assert.throws(() => verifyUserSession(unsigned));
  assert.throws(() => verifyUserSession("garbage"));
});

test("the public default JWT secret is reachable only under the test runner", async () => {
  const { isDevelopmentBuild } = await import("../src/config.js");
  assert.equal(isDevelopmentBuild({ NODE_ENV: "development" } as any), true);
  assert.equal(isDevelopmentBuild({ NODE_ENV: "test" } as any), true);
  assert.equal(isDevelopmentBuild({ NODE_ENV: "production" } as any), false);
  // A host that forgot NODE_ENV is NOT a development build: it fails closed.
  assert.equal(isDevelopmentBuild({} as any), false);
  assert.equal(isDevelopmentBuild({ NODE_ENV: "" } as any), false);

  const source = fs.readFileSync(
    path.join(originalCwd, "src", "config.ts"),
    "utf8",
  );
  const uses = [...source.matchAll(/vynorai_default_secret_2026/g)];
  assert.equal(uses.length, 1, "the default secret appears exactly once");
  const around = source.slice(
    Math.max(0, uses[0].index! - 120),
    uses[0].index!,
  );
  assert.match(around, /NODE_ENV === "test"/, "and only behind the test check");
  assert.match(source, /crypto\.randomBytes\(32\)\.toString\("hex"\)/);
});

// ── 5. Log hygiene, CORS, audit fields ────────────────────────────────────────

test("error log lines never carry the request body, and e-mails are masked", async () => {
  const { describeError, maskEmail } = await import(
    "../src/services/httpHygiene.js"
  );
  const parse: any = new SyntaxError(
    `Unexpected token 'x', "{"password":"hunter2"}x" is not valid JSON`,
  );
  parse.body = '{"password":"hunter2"}x';
  parse.type = "entity.parse.failed";
  parse.status = 400;
  const line = describeError(parse);
  assert.ok(!line.includes("hunter2"));
  assert.match(line, /SyntaxError/);
  assert.equal(describeError(new Error("a\nb\rc")).includes("\n"), false);
  assert.equal(maskEmail("alice@example.com"), "a***@e***.com");
  assert.equal(maskEmail("bad"), "***");
});

test("CORS accepts only the explicit origin list", async () => {
  const { isAllowedCorsOrigin, DEFAULT_CORS_ORIGINS } = await import(
    "../src/services/httpHygiene.js"
  );
  const allowed = new Set(DEFAULT_CORS_ORIGINS);
  for (const ok of [
    "https://vynor.lk",
    "https://admin.vynor.lk",
    "http://localhost:3334",
    "http://127.0.0.1:5173",
    "vscode-webview://abc123",
  ])
    assert.equal(isAllowedCorsOrigin(ok, allowed), true, ok);
  for (const bad of [
    "https://evil.vynor.lk",
    "https://vynor.lk.evil.test",
    "http://localhost:9",
    "http://localhost:3334.evil.test",
    "https://notvynor.lk",
    "null",
  ])
    assert.equal(isAllowedCorsOrigin(bad, allowed), false, bad);
});

test("audit fields are cleaned and capped, and LIKE filters match literally", async () => {
  const {
    cleanAuditField,
    escapeLike,
    logSecurityEvent,
    getRecentSecurityEvents,
  } = await import("../src/services/securityAudit.js");
  assert.equal(cleanAuditField("a\r\nb\u0000c", 128), "abc");
  assert.equal(cleanAuditField("x".repeat(500), 128).length, 128);
  assert.equal(cleanAuditField("l1\nl2", 4000, true), "l1\nl2");
  await logSecurityEvent({
    eventType: "SEC_LIKE_100",
    actor: "evil\nFAKE LOG LINE",
    target: "t".repeat(400),
  });
  await logSecurityEvent({ eventType: "SEC_LIKEXYZ", actor: "x" });
  const rows = await dbm.dbAll<any>(
    "SELECT actor, target FROM security_audit_logs WHERE event_type = 'SEC_LIKE_100'",
  );
  assert.equal(rows[0].actor, "evilFAKE LOG LINE");
  assert.equal(rows[0].target.length, 128);
  // "%" and "_" are literals: "SEC_LIKE_1%" must not match SEC_LIKEXYZ.
  const literal = await getRecentSecurityEvents(50, "SEC_LIKE_1");
  assert.deepEqual(
    literal.map((row: any) => row.event_type),
    ["SEC_LIKE_100"],
  );
  const wildcard = await getRecentSecurityEvents(50, "SEC%");
  assert.equal(wildcard.length, 0);
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});
