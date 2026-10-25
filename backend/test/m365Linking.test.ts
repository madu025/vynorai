import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";

/**
 * Self-service Microsoft 365 identity linking: the person proves the Microsoft account in Excel
 * (Entra token, one-time code) and the VynorAI account on the web (signed-in session, preview and
 * explicit confirm). Runs on SQLite by default and on PostgreSQL when DATABASE_URL is set.
 */

const tenantId = "aaaaaaaa-1111-4111-8111-111111111111";
const objectId = "bbbbbbbb-2222-4222-8222-222222222222";
const otherObjectId = "bbbbbbbb-9999-4999-8999-999999999999";
const apiClientId = "cccccccc-3333-4333-8333-333333333333";
const callerClientId = "dddddddd-4444-4444-8444-444444444444";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-link-"));
const originalCwd = process.cwd();
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const RAW_EMAIL = "prasad@slts.lk";

let dbm: typeof import("../src/db.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let linking: typeof import("../src/services/m365Linking.js");
let label: typeof import("../src/services/m365Label.js");
let session: typeof import("../src/services/userSession.js");
let appServer: http.Server;
let jwksServer: http.Server;
let baseUrl = "";

function entraToken(oid = objectId) {
  return jwt.sign(
    {
      ver: "2.0",
      tid: tenantId,
      oid,
      name: "Prasad Perera",
      preferred_username: RAW_EMAIL,
      scp: "m365.excel.read m365.excel.write",
      azp: callerClientId,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: "test-key",
      audience: apiClientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expiresIn: "5m",
    },
  );
}

function userToken(userId: string) {
  return session.signUserSession(
    { userId, email: `${userId}@example.com` },
    "x",
  );
}

async function call(
  method: "GET" | "POST" | "DELETE",
  route: string,
  bearer: string,
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}/v1/m365${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // A non-JSON body is fine for an error.
  }
  return { status: response.status, json, headers: response.headers };
}

async function addUser(
  id: string,
  options: { verified?: number; suspended?: number } = {},
) {
  await dbm.dbRun("DELETE FROM users WHERE id = ?", [id]);
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash, is_suspended, email_verified) VALUES (?, ?, 'x', ?, ?, ?, ?)",
    [
      id,
      `${id}@example.com`,
      `key-${id}`,
      `hash-${id}`,
      options.suspended ?? 0,
      options.verified ?? 1,
    ],
  );
}

async function setTenant(
  options: { status?: "enabled" | "disabled"; seatLimit?: number } = {},
) {
  await registry.upsertM365Tenant({
    tenantId,
    displayName: "SLTS",
    status: options.status ?? "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
    aiEnabled: true,
    planId: null,
    seatLimit: options.seatLimit ?? 5,
    subscriptionValidUntil: null,
  });
}

async function adminLink(oid: string, userId: string, enabled = 1) {
  await dbm.dbRun(
    "DELETE FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, oid],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, ?)",
    [tenantId, oid, userId, enabled],
  );
}

async function startCode(oid = objectId): Promise<string> {
  const result = await linking.startLinkCode({
    tenantId,
    objectId: oid,
    label: "Prasad P. (p***@slts.lk)",
  });
  assert.equal(result.ok, true);
  return result.linkCode as string;
}

const confirmFor = (
  userId: string,
  rawCode: unknown,
  extra: Record<string, unknown> = {},
) =>
  linking.confirmLinkCode({
    userId,
    emailVerified: true,
    ip: "203.0.113.5",
    rawCode,
    confirm: true,
    ...extra,
  });

before(async () => {
  process.chdir(tempDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    M365_ENTRA_TENANT_ID: tenantId,
    M365_ENTRA_API_CLIENT_ID: apiClientId,
    M365_ENTRA_ALLOWED_CLIENT_IDS: callerClientId,
  });
  // SQLite unless the caller points the run at a (throwaway) PostgreSQL database.
  if (!process.env.DATABASE_URL) process.env.DB_DRIVER = "sqlite";
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ALLOWED_TENANT_IDS;
  delete process.env.M365_ALLOWED_TENANT_ID;
  jwksServer = http.createServer((_req, res) => {
    const jwk = publicKey.export({ format: "jwk" });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ keys: [{ ...jwk, kid: "test-key", use: "sig" }] }),
    );
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  process.env.M365_ENTRA_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as any).port}/keys`;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  registry = await import("../src/services/m365TenantRegistry.js");
  linking = await import("../src/services/m365Linking.js");
  label = await import("../src/services/m365Label.js");
  session = await import("../src/services/userSession.js");
  const express = (await import("express")).default;
  const { m365Router } = await import("../src/routes/m365.js");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/v1/m365", m365Router);
  appServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(appServer.address() as any).port}`;
});

beforeEach(async () => {
  linking.resetLinkFailureCounters();
  await dbm.dbRun("DELETE FROM m365_link_codes");
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await dbm.dbRun("DELETE FROM security_audit_logs");
  await setTenant();
  for (const id of ["user-a", "user-b", "user-c", "user-d"]) await addUser(id);
});

after(async () => {
  if (appServer)
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
  if (jwksServer)
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    await fs.promises.rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  } catch {
    // A locked temp directory must not fail the run.
  }
});

// ── building blocks ───────────────────────────────────────────────────────────────────────────

test("codes use 32 unambiguous symbols (40 bits), normalise forgivingly and hash with a key", () => {
  const alphabet = linking.LINK_CODE_ALPHABET;
  assert.equal(new Set(alphabet).size, 32);
  assert.equal(alphabet.length, 32);
  for (const lookAlike of "01IO") assert.ok(!alphabet.includes(lookAlike));
  assert.equal(linking.LINK_CODE_LENGTH * Math.log2(alphabet.length), 40);
  const codes = new Set<string>();
  for (let i = 0; i < 2000; i += 1) {
    const code = linking.generateLinkCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    codes.add(code);
  }
  assert.equal(codes.size, 2000);
  assert.equal(linking.normalizeLinkCode("abcd-efgh"), "ABCDEFGH");
  assert.equal(linking.normalizeLinkCode(" abcd efgh "), "ABCDEFGH");
  for (const bad of [
    "ABCD",
    "ABCD-EFG0",
    "ABCDEFGHJ",
    "",
    null,
    5,
    "ABCD-EFG!",
    "A".repeat(40),
  ])
    assert.equal(linking.normalizeLinkCode(bad), undefined);
  const hash = linking.hashLinkCode("ABCDEFGH");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(
    hash,
    crypto.createHash("sha256").update("ABCDEFGH").digest("hex"),
  );
});

test("labels keep a masked name and address, never the raw values", () => {
  assert.equal(label.maskEmail("prasad@slts.lk"), "p***@slts.lk");
  assert.equal(label.maskName("Prasad Perera"), "Prasad P.");
  assert.equal(
    label.buildIdentityLabel({
      name: "Prasad Perera",
      address: "prasad@slts.lk",
    }),
    "Prasad P. (p***@slts.lk)",
  );
  assert.equal(label.buildIdentityLabel({}), label.FALLBACK_LABEL);
  assert.equal(label.maskEmail("not an address"), undefined);
  assert.ok(
    !label
      .buildIdentityLabel({ name: "A\u0000B‮ C", address: "x@y.zz" })
      .includes("‮"),
  );
});

// ── the whole flow over HTTP ──────────────────────────────────────────────────────────────────

test("an Entra identity gets a code, the VynorAI account confirms it, and the pane can then use the add-in", async () => {
  // Not linked yet: the normal routes refuse it.
  const before = await call("GET", "/excel/capabilities", entraToken());
  assert.equal(before.status, 403);
  assert.equal(before.json.error.code, "M365_IDENTITY_NOT_LINKED");

  const start = await call("POST", "/link/start", entraToken());
  assert.equal(start.status, 200);
  assert.match(start.json.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(start.headers.get("cache-control"), "no-store");
  assert.ok(Date.parse(start.json.expiresAt) > Date.now());
  assert.deepEqual(Object.keys(start.json).sort(), ["code", "expiresAt"]);

  const pending = await call("GET", "/link/status", entraToken());
  assert.deepEqual(
    { linked: pending.json.linked, state: pending.json.state },
    { linked: false, state: "pending" },
  );

  const preview = await call("POST", "/link/preview", userToken("user-a"), {
    code: start.json.code,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.label, "Prasad P. (p***@slts.lk)");
  assert.equal(preview.json.tenantName, "SLTS");
  assert.ok(!JSON.stringify(preview.json).includes(RAW_EMAIL));
  // A preview changes nothing.
  assert.equal(
    (await call("GET", "/link/status", entraToken())).json.state,
    "pending",
  );

  const confirm = await call("POST", "/link/confirm", userToken("user-a"), {
    code: start.json.code.toLowerCase(),
    confirm: true,
  });
  assert.equal(confirm.status, 200);
  assert.deepEqual(confirm.json, { linked: true });

  const row = await dbm.dbGet<any>(
    "SELECT user_id, enabled, linked_via FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
  assert.equal(row.user_id, "user-a");
  assert.equal(Number(row.enabled), 1);
  assert.equal(row.linked_via, "self");
  assert.deepEqual(
    (({ linked, state }) => ({ linked, state }))(
      (await call("GET", "/link/status", entraToken())).json,
    ),
    { linked: true, state: "linked" },
  );
  assert.equal(
    (await call("GET", "/excel/capabilities", entraToken())).status,
    200,
  );
  // Starting again for a linked identity is refused, not silently re-linked.
  const again = await call("POST", "/link/start", entraToken());
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "m365_already_linked");
});

test("only an Entra access token can ask for a code; sessions, API keys and no token cannot", async () => {
  await adminLink(objectId, "user-a");
  const sessionToken = (await call("POST", "/session", entraToken())).json
    .sessionToken as string;
  assert.ok(sessionToken);
  const bySession = await call("POST", "/link/start", sessionToken);
  assert.equal(bySession.status, 401);
  assert.equal(bySession.json.error.code, "entra_token_required");
  const none = await fetch(`${baseUrl}/v1/m365/link/start`, { method: "POST" });
  assert.equal(none.status, 401);
  // The web endpoints refuse an API key and an Entra token.
  assert.equal(
    (
      await call("POST", "/link/preview", "vynor_live_abcdef", {
        code: "ABCD-EFGH",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("POST", "/link/confirm", entraToken(), {
        code: "ABCD-EFGH",
        confirm: true,
      })
    ).status,
    401,
  );
});

test("a disabled organisation gets no code", async () => {
  await setTenant({ status: "disabled" });
  const start = await call("POST", "/link/start", entraToken());
  assert.equal(start.status, 403);
  assert.equal(start.json.error.code, "tenant_disabled");
  assert.equal(start.json.error.action, "admin_enable_tenant");
  assert.equal(start.json.error.requestRecorded, true);
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_link_codes"))?.n ?? 0,
    0,
  );
});

// ── code lifecycle ────────────────────────────────────────────────────────────────────────────

test("the code is stored only as a keyed hash and never reaches the audit trail", async () => {
  const code = await startCode();
  const plain = linking.normalizeLinkCode(code)!;
  const rows = await dbm.dbAll<any>("SELECT * FROM m365_link_codes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code_hash, linking.hashLinkCode(plain));
  assert.ok(!JSON.stringify(rows).includes(plain));
  assert.ok(!JSON.stringify(rows).includes(RAW_EMAIL));
  const result = await confirmFor("user-a", code);
  assert.equal(result.ok, true);
  const audit = await dbm.dbAll<any>(
    "SELECT * FROM security_audit_logs WHERE event_type = 'M365_IDENTITY_SELF_LINKED'",
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, "user-a");
  assert.equal(audit[0].target, tenantId);
  const details = JSON.parse(audit[0].details);
  assert.deepEqual(Object.keys(details), ["objectRef"]);
  assert.equal(details.objectRef, linking.objectIdRef(objectId));
  const everything = JSON.stringify(
    await dbm.dbAll<any>("SELECT * FROM security_audit_logs"),
  );
  for (const secret of [plain, code, RAW_EMAIL, "Prasad", objectId])
    assert.ok(
      !everything.includes(secret),
      `audit rows must not contain ${secret}`,
    );
});

test("asking again replaces the earlier code", async () => {
  const first = await startCode();
  const second = await startCode();
  assert.notEqual(first, second);
  assert.equal(
    (
      await linking.previewLinkCode({
        userId: "user-a",
        ip: "203.0.113.5",
        rawCode: first,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await linking.previewLinkCode({
        userId: "user-a",
        ip: "203.0.113.5",
        rawCode: second,
      })
    ).ok,
    true,
  );
  const live = await dbm.dbAll<any>(
    "SELECT id FROM m365_link_codes WHERE consumed_at IS NULL",
  );
  assert.equal(live.length, 1);
});

test("a code works once; a replay after the claim is refused", async () => {
  const code = await startCode();
  assert.equal((await confirmFor("user-a", code)).ok, true);
  const replay = await confirmFor("user-b", code);
  assert.deepEqual(
    { ok: replay.ok, code: replay.code },
    { ok: false, code: "invalid_or_expired_code" },
  );
  const owner = await dbm.dbGet<any>(
    "SELECT user_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
  assert.equal(owner.user_id, "user-a");
});

test("an expired code is refused and the status says expired", async () => {
  const code = await startCode();
  await dbm.dbRun("UPDATE m365_link_codes SET expires_at = ?", [
    new Date(Date.now() - 1000).toISOString(),
  ]);
  const preview = await linking.previewLinkCode({
    userId: "user-a",
    ip: "203.0.113.5",
    rawCode: code,
  });
  assert.deepEqual(
    { ok: preview.ok, code: preview.code },
    { ok: false, code: "invalid_or_expired_code" },
  );
  const confirm = await confirmFor("user-a", code);
  assert.equal(confirm.code, "invalid_or_expired_code");
  assert.equal((await linking.linkStatus(tenantId, objectId)).state, "expired");
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    0,
  );
  // The retention sweep removes codes expired for more than a day.
  await dbm.dbRun("UPDATE m365_link_codes SET expires_at = ?", [
    new Date(Date.now() - 2 * 86_400_000).toISOString(),
  ]);
  assert.equal(await linking.sweepLinkCodes(), 1);
});

test("unknown, malformed and wrong codes all get the same answer, then the account is locked", async () => {
  const code = await startCode();
  const answers = new Set<string>();
  for (const wrong of ["ZZZZ-ZZZZ", "short", 12345, "", "ABCD-EFG0"]) {
    const result = await linking.previewLinkCode({
      userId: "user-a",
      ip: "203.0.113.5",
      rawCode: wrong,
    });
    answers.add(JSON.stringify(result));
  }
  assert.equal(answers.size, 1);
  assert.equal(JSON.parse([...answers][0]).code, "invalid_or_expired_code");
  // Five wrong tries used up the allowance: even the right code is now refused, on both steps.
  const locked = await linking.previewLinkCode({
    userId: "user-a",
    ip: "203.0.113.5",
    rawCode: code,
  });
  assert.equal(locked.code, "too_many_attempts");
  assert.equal((await confirmFor("user-a", code)).code, "too_many_attempts");
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    0,
  );
  // Another account from another address is not affected.
  assert.equal(
    (
      await linking.previewLinkCode({
        userId: "user-b",
        ip: "198.51.100.9",
        rawCode: code,
      })
    ).ok,
    true,
  );
});

test("one code can be previewed only a limited number of times", async () => {
  const code = await startCode();
  for (let i = 0; i < linking.LINK_CODE_MAX_PREVIEWS; i += 1)
    assert.equal(
      (
        await linking.previewLinkCode({
          userId: `user-${i}`,
          ip: `198.51.100.${i}`,
          rawCode: code,
        })
      ).ok,
      true,
    );
  assert.equal(
    (
      await linking.previewLinkCode({
        userId: "user-z",
        ip: "198.51.100.77",
        rawCode: code,
      })
    ).ok,
    false,
  );
});

// ── who may confirm ───────────────────────────────────────────────────────────────────────────

test("confirming needs an explicit confirm:true and leaves the code usable", async () => {
  const code = await startCode();
  const http400 = await call("POST", "/link/confirm", userToken("user-a"), {
    code,
  });
  assert.equal(http400.status, 400);
  assert.equal(http400.json.error.code, "confirmation_required");
  assert.equal(
    (await confirmFor("user-a", code, { confirm: "yes" })).code,
    "confirmation_required",
  );
  assert.equal((await confirmFor("user-a", code)).ok, true);
});

test("an unverified VynorAI email and a suspended account cannot link", async () => {
  const code = await startCode();
  await addUser("user-unverified", { verified: 0 });
  const viaHttp = await call(
    "POST",
    "/link/confirm",
    userToken("user-unverified"),
    { code, confirm: true },
  );
  assert.equal(viaHttp.status, 403);
  assert.equal(viaHttp.json.error.code, "email_not_verified");
  await addUser("user-suspended", { suspended: 1 });
  const suspended = await call(
    "POST",
    "/link/confirm",
    userToken("user-suspended"),
    { code, confirm: true },
  );
  assert.equal(suspended.status, 403);
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    0,
  );
  assert.equal((await confirmFor("user-a", code)).ok, true);
});

test("an identity linked to another account is never re-pointed", async () => {
  const code = await startCode();
  await adminLink(objectId, "user-b");
  const result = await confirmFor("user-a", code);
  assert.deepEqual(
    { ok: result.ok, code: result.code },
    { ok: false, code: "m365_linked_to_another_account" },
  );
  const owner = await dbm.dbGet<any>(
    "SELECT user_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
  assert.equal(owner.user_id, "user-b");
  // The code was not consumed by the refusal.
  assert.equal(
    (await dbm.dbGet<any>("SELECT consumed_at FROM m365_link_codes"))
      ?.consumed_at ?? null,
    null,
  );
});

test("a link an administrator disabled stays disabled", async () => {
  await adminLink(objectId, "user-a", 0);
  const start = await linking.startLinkCode({ tenantId, objectId });
  assert.deepEqual(
    { ok: start.ok, code: start.code },
    { ok: false, code: "m365_link_disabled" },
  );
  const code = "ABCD-EFGH";
  assert.equal((await confirmFor("user-a", code)).ok, false);
});

test("the seat limit holds and a refused link gives the code back", async () => {
  await adminLink(otherObjectId, "user-b");
  await setTenant({ seatLimit: 1 });
  const code = await startCode();
  const result = await confirmFor("user-a", code);
  assert.deepEqual(
    { ok: result.ok, code: result.code },
    { ok: false, code: "m365_seat_limit_reached" },
  );
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    1,
  );
  assert.equal(
    (await dbm.dbGet<any>("SELECT consumed_at FROM m365_link_codes"))
      ?.consumed_at ?? null,
    null,
  );
  // After the administrator adds a seat the same code works.
  await setTenant({ seatLimit: 2 });
  assert.equal((await confirmFor("user-a", code)).ok, true);
});

test("a switched-off organisation cannot be linked even with a live code", async () => {
  const code = await startCode();
  await setTenant({ status: "disabled" });
  assert.equal((await confirmFor("user-a", code)).code, "tenant_disabled");
});

test("one VynorAI account may serve only a few Microsoft identities", async () => {
  for (let i = 0; i < linking.MAX_IDENTITY_LINKS_PER_USER; i += 1)
    await adminLink(`aaaaaaaa-0000-4000-8000-00000000000${i}`, "user-a");
  await setTenant({ seatLimit: 10 });
  const code = await startCode();
  assert.equal((await confirmFor("user-a", code)).code, "m365_user_link_limit");
  assert.equal((await confirmFor("user-b", code)).ok, true);
});

test("two simultaneous confirmations link the identity exactly once", async () => {
  const code = await startCode();
  const results = await Promise.all([
    confirmFor("user-a", code),
    confirmFor("user-a", code),
    confirmFor("user-b", code),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const links = await dbm.dbAll<any>(
    "SELECT user_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
  assert.equal(links.length, 1);
});

// ── the person's own links ────────────────────────────────────────────────────────────────────

test("a person can list and remove their own link, nobody else's", async () => {
  const code = await startCode();
  assert.equal((await confirmFor("user-a", code)).ok, true);
  const mine = await call("GET", "/link/mine", userToken("user-a"));
  assert.equal(mine.status, 200);
  assert.equal(mine.json.links.length, 1);
  assert.equal(mine.json.links[0].linkedVia, "self");
  assert.equal(mine.json.links[0].tenantName, "SLTS");
  assert.equal(
    (await call("GET", "/link/mine", userToken("user-b"))).json.links.length,
    0,
  );

  const wrongOwner = await call("POST", "/link/unlink", userToken("user-b"), {
    tenantId,
    objectId,
  });
  assert.equal(wrongOwner.status, 404);
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    1,
  );

  const removed = await call("DELETE", "/link", userToken("user-a"), {
    tenantId,
    objectId,
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    0,
  );
  const audit = await dbm.dbAll<any>(
    "SELECT actor, details FROM security_audit_logs WHERE event_type = 'M365_IDENTITY_SELF_UNLINKED'",
  );
  assert.equal(audit.length, 1);
  assert.ok(!audit[0].details.includes(objectId));
  // The Microsoft account can ask for a fresh code afterwards.
  assert.equal((await linking.startLinkCode({ tenantId, objectId })).ok, true);
});

test("a person cannot remove a link an administrator disabled", async () => {
  await adminLink(objectId, "user-a", 0);
  const removed = await call("POST", "/link/unlink", userToken("user-a"), {
    tenantId,
    objectId,
  });
  assert.equal(removed.status, 404);
  assert.equal(
    (await dbm.dbGet<any>("SELECT COUNT(*) AS n FROM m365_identity_links"))?.n,
    1,
  );
});

test("administrator links keep working unchanged", async () => {
  await adminLink(objectId, "user-a");
  assert.equal(
    (await call("GET", "/excel/capabilities", entraToken())).status,
    200,
  );
  const row = await dbm.dbGet<any>(
    "SELECT linked_via FROM m365_identity_links",
  );
  assert.equal(row.linked_via, "admin");
});
