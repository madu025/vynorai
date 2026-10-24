import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";

/**
 * Phase 2 hardening of the Microsoft 365 backend: suspended users, session lifetime, fail-closed
 * entitlements, atomic seat linking, server-side PII masking and the background model token.
 */

const tenantId = "aaaaaaaa-1111-4111-8111-111111111111";
const objectId = "bbbbbbbb-2222-4222-8222-222222222222";
const apiClientId = "cccccccc-3333-4333-8333-333333333333";
const callerClientId = "dddddddd-4444-4444-8444-444444444444";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-sec-"));
const originalCwd = process.cwd();
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

let dbm: typeof import("../src/db.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let entitlements: typeof import("../src/services/m365Entitlements.js");
let policy: typeof import("../src/services/m365Policy.js");
let analysis: typeof import("../src/services/m365Analysis.js");
let agent: typeof import("../src/services/m365Agent.js");
let appServer: http.Server;
let jwksServer: http.Server;
let baseUrl = "";
let jwtSecret = "";

function entraToken(oid = objectId) {
  return jwt.sign(
    {
      ver: "2.0",
      tid: tenantId,
      oid,
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

async function call(
  method: "GET" | "POST",
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
  return { status: response.status, json };
}

async function addUser(id: string, suspended = 0) {
  await dbm.dbRun(
    "INSERT OR REPLACE INTO users (id, email, password_hash, api_key, api_key_hash, is_suspended) VALUES (?, ?, 'x', ?, ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`, suspended],
  );
}

async function link(oid: string, userId: string, createdAt: string) {
  await dbm.dbRun(
    "INSERT OR REPLACE INTO m365_identity_links (tenant_id, object_id, user_id, enabled, created_at) VALUES (?, ?, ?, 1, ?)",
    [tenantId, oid, userId, createdAt],
  );
}

before(async () => {
  process.chdir(tempDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_DRIVER: "sqlite",
    M365_ENTRA_TENANT_ID: tenantId,
    M365_ENTRA_API_CLIENT_ID: apiClientId,
    M365_ENTRA_ALLOWED_CLIENT_IDS: callerClientId,
  });
  delete process.env.DATABASE_URL;
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
  entitlements = await import("../src/services/m365Entitlements.js");
  policy = await import("../src/services/m365Policy.js");
  analysis = await import("../src/services/m365Analysis.js");
  agent = await import("../src/services/m365Agent.js");
  jwtSecret = (await import("../src/config.js")).config.jwtSecret;
  const express = (await import("express")).default;
  const { m365Router } = await import("../src/routes/m365.js");
  const app = express();
  app.use(express.json());
  app.use("/v1/m365", m365Router);
  appServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(appServer.address() as any).port}`;
});

beforeEach(async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await dbm.dbRun("DELETE FROM users");
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
    aiEnabled: true,
    planId: null,
    seatLimit: 5,
    subscriptionValidUntil: null,
  });
  await addUser("user-sec");
  await link(objectId, "user-sec", "2026-10-01 00:00:00");
});

after(async () => {
  analysis?.setM365AgentRunnerForTests();
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

// ── 1. suspended users ────────────────────────────────────────────────────────────────────────

test("a suspended user is refused on the Entra path, the session path and in diagnostics", async () => {
  const ok = await call("GET", "/excel/capabilities", entraToken());
  assert.equal(ok.status, 200);
  const session = await call("POST", "/session", entraToken());
  assert.equal(session.status, 200);
  const sessionToken = session.json.sessionToken as string;
  assert.equal(
    (await call("GET", "/excel/capabilities", sessionToken)).status,
    200,
  );

  await dbm.dbRun("UPDATE users SET is_suspended = 1 WHERE id = ?", [
    "user-sec",
  ]);
  for (const bearer of [entraToken(), sessionToken]) {
    const blocked = await call("GET", "/excel/capabilities", bearer);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, "M365_USER_SUSPENDED");
  }
  // Renewing a session is refused too, so a suspended person cannot mint a fresh 30 days.
  const renew = await call("POST", "/session", sessionToken);
  assert.equal(renew.status, 403);
  assert.equal(renew.json.error.code, "M365_USER_SUSPENDED");

  const diagnostics = await call("GET", "/diagnostics", entraToken());
  const identity = diagnostics.json.stages.find(
    (stage: any) => stage.name === "identity",
  );
  assert.equal(identity.ok, false);
  assert.equal(identity.code, "M365_USER_SUSPENDED");
  assert.equal(diagnostics.json.ready.read, false);
  assert.equal(diagnostics.json.ready.write, false);

  const entitlement = await entitlements.resolveM365Entitlement(
    tenantId,
    objectId,
  );
  assert.equal(entitlement.active, false);
  assert.equal(entitlement.blockedReason, "user_suspended");

  await dbm.dbRun("UPDATE users SET is_suspended = 0 WHERE id = ?", [
    "user-sec",
  ]);
  assert.equal(
    (await call("GET", "/excel/capabilities", entraToken())).status,
    200,
  );
});

test("a disabled link and a disabled tenant also fail closed", async () => {
  await dbm.dbRun("UPDATE m365_identity_links SET enabled = 0");
  const unlinked = await call("GET", "/excel/capabilities", entraToken());
  assert.equal(unlinked.status, 403);
  assert.equal(unlinked.json.error.code, "M365_IDENTITY_NOT_LINKED");
  await dbm.dbRun("UPDATE m365_identity_links SET enabled = 1");
  await dbm.dbRun("UPDATE m365_tenants SET status = 'disabled'");
  const off = await call("GET", "/excel/capabilities", entraToken());
  assert.equal(off.status, 403);
  assert.equal(off.json.error.code, "tenant_disabled");
});

// ── 2. session lifetime ───────────────────────────────────────────────────────────────────────

test("renewing a session keeps the original sign-in time and never extends it past 30 days", async () => {
  const first = await call("POST", "/session", entraToken());
  const original = jwt.decode(first.json.sessionToken) as any;
  assert.equal(typeof original.auth_iat, "number");
  assert.equal(original.kind, "m365_session");
  assert.ok(original.jti);

  const renewed = await call("POST", "/session", first.json.sessionToken);
  assert.equal(renewed.status, 200);
  const next = jwt.decode(renewed.json.sessionToken) as any;
  assert.equal(next.auth_iat, original.auth_iat);
  assert.ok(next.exp <= original.auth_iat + 30 * 86_400);
  assert.notEqual(next.jti, original.jti);
});

test("a session older than 30 days since its Entra sign-in is refused even when its own exp is still ahead", async () => {
  const now = Math.floor(Date.now() / 1000);
  const stale = jwt.sign(
    {
      kind: "m365_session",
      tid: tenantId,
      oid: objectId,
      scp: "m365.excel.read",
      ver: "vynorai-session",
      auth_iat: now - 31 * 86_400,
    },
    jwtSecret,
    { algorithm: "HS256", expiresIn: 86_400, jwtid: crypto.randomUUID() },
  );
  const refused = await call("POST", "/session", stale);
  assert.equal(refused.status, 401);
  assert.equal(refused.json.error.code, "m365_session_expired");
  assert.throws(
    () => policy.verifyM365SessionToken(stale),
    /m365_session_expired/,
  );
  assert.throws(
    () =>
      policy.createM365SessionToken({
        tenantId,
        objectId,
        scopes: ["m365.excel.read"],
        authIat: now - 31 * 86_400,
      }),
    /m365_session_expired/,
  );
  // A fresh Entra token always starts a new window.
  assert.equal((await call("POST", "/session", entraToken())).status, 200);
});

test("session tokens are purpose-bound: wrong kind, missing jti and legacy tokens", () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    tid: tenantId,
    oid: objectId,
    scp: "m365.excel.read",
    ver: "vynorai-session",
  };
  const sign = (claims: Record<string, unknown>, jti: string | undefined) =>
    jwt.sign(claims, jwtSecret, {
      algorithm: "HS256",
      expiresIn: 3600,
      ...(jti ? { jwtid: jti } : {}),
    });
  assert.throws(
    () =>
      policy.verifyM365SessionToken(
        sign({ ...base, kind: "m365_excel_approval" }, "a"),
      ),
    /invalid_m365_session/,
  );
  assert.throws(
    () =>
      policy.verifyM365SessionToken(
        sign({ ...base, kind: "m365_session" }, undefined),
      ),
    /invalid_m365_session/,
  );
  assert.throws(
    () =>
      policy.verifyM365SessionToken(
        sign({ ...base, kind: "m365_session", ver: "other" }, "a"),
      ),
    /invalid_m365_session/,
  );
  // A token issued before auth_iat existed counts from its own issue time.
  const legacy = policy.verifyM365SessionToken(
    sign({ ...base, kind: "m365_session" }, "legacy-1"),
    now,
  );
  assert.ok(legacy.authIat && Math.abs(legacy.authIat - now) < 5);
  assert.throws(
    () =>
      policy.verifyM365SessionToken(
        sign({ ...base, kind: "m365_session" }, "legacy-2"),
        now + 31 * 86_400,
      ),
    /m365_session_expired|jwt expired/,
  );
});

// ── 3. entitlements fail closed ───────────────────────────────────────────────────────────────

test("a garbage plan expiry date falls back instead of keeping the tenant plan", async () => {
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    planId: "pro",
    seatLimit: 5,
    subscriptionValidUntil: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(
    (await entitlements.resolveM365Entitlement(tenantId, objectId)).source,
    "tenant",
  );
  for (const garbage of ["not-a-date", "2026-13-45", "undefined", "NaN"]) {
    await dbm.dbRun(
      "UPDATE m365_tenants SET subscription_valid_until = ? WHERE tenant_id = ?",
      [garbage, tenantId],
    );
    const result = await entitlements.resolveM365Entitlement(
      tenantId,
      objectId,
    );
    assert.notEqual(result.source, "tenant", garbage);
    assert.equal(result.planId, "free", garbage);
  }
  await dbm.dbRun(
    "UPDATE m365_tenants SET subscription_valid_until = ? WHERE tenant_id = ?",
    ["2000-01-01T00:00:00.000Z", tenantId],
  );
  assert.notEqual(
    (await entitlements.resolveM365Entitlement(tenantId, objectId)).source,
    "tenant",
  );
});

test("a zero, negative or garbage seat limit is never unlimited", async () => {
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read"],
    planId: "pro",
    seatLimit: 1,
    subscriptionValidUntil: "2999-01-01T00:00:00.000Z",
  });
  // The existing seat is the only one allowed; a second identity must be refused for every bad value.
  for (const bad of [0, -3, "abc", null]) {
    await dbm
      .dbRun("UPDATE m365_tenants SET seat_limit = ? WHERE tenant_id = ?", [
        bad,
        tenantId,
      ])
      .catch(() => undefined);
    const tenant = await registry.getM365Tenant(tenantId);
    assert.ok(tenant && tenant.seatLimit >= 1, String(bad));
    assert.equal(tenant!.seatLimit, 1, String(bad));
    await assert.rejects(
      entitlements.assertM365SeatAvailable(tenantId, "new-object"),
      /m365_seat_limit_reached/,
      String(bad),
    );
  }
});

// ── 4. seat limit: atomic link and request-time ordering ──────────────────────────────────────

test("linkIdentityWithSeatCheck: simultaneous links cannot exceed the seat limit", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read"],
    seatLimit: 2,
  });
  for (const id of ["u1", "u2", "u3", "u4"]) await addUser(id);
  const results = await Promise.all(
    ["u1", "u2", "u3", "u4"].map((id) =>
      entitlements.linkIdentityWithSeatCheck({
        tenantId,
        objectId: `obj-${id}`,
        userId: id,
        enabled: true,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(
    results.filter((r) => r.code === "m365_seat_limit_reached").length,
    2,
  );
  const count = await dbm.dbGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
    [tenantId],
  );
  assert.equal(Number(count!.count), 2);
});

test("linkIdentityWithSeatCheck reports the previous owner, allows re-pointing at the limit and honours disable", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read"],
    seatLimit: 1,
  });
  await addUser("owner-a");
  await addUser("owner-b");
  const first = await entitlements.linkIdentityWithSeatCheck({
    tenantId,
    objectId: "obj-1",
    userId: "owner-a",
    enabled: true,
  });
  assert.deepEqual(first, { ok: true });
  // The only seat can be re-pointed (not a new seat), and the old owner is reported for the audit.
  const moved = await entitlements.linkIdentityWithSeatCheck({
    tenantId,
    objectId: "obj-1",
    userId: "owner-b",
    enabled: true,
  });
  assert.deepEqual(moved, { ok: true, previousUserId: "owner-a" });
  const second = await entitlements.linkIdentityWithSeatCheck({
    tenantId,
    objectId: "obj-2",
    userId: "owner-a",
    enabled: true,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "m365_seat_limit_reached");
  const off = await entitlements.linkIdentityWithSeatCheck({
    tenantId,
    objectId: "obj-1",
    userId: "owner-b",
    enabled: false,
  });
  assert.equal(off.ok, true);
  await registry.upsertM365Tenant({
    tenantId,
    status: "disabled",
    allowedScopes: ["m365.excel.read"],
    seatLimit: 1,
  });
  const disabled = await entitlements.linkIdentityWithSeatCheck({
    tenantId,
    objectId: "obj-3",
    userId: "owner-a",
    enabled: true,
  });
  assert.deepEqual(disabled, { ok: false, code: "tenant_disabled" });
});

test("lowering the seat limit refuses the newest seats at request time, oldest seats keep access", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    planId: "pro",
    seatLimit: 3,
    subscriptionValidUntil: "2999-01-01T00:00:00.000Z",
  });
  for (const id of ["s1", "s2", "s3"]) await addUser(id);
  await link("seat-1", "s1", "2026-10-01 00:00:00");
  await link("seat-2", "s2", "2026-10-02 00:00:00");
  await link("seat-3", "s3", "2026-10-03 00:00:00");
  for (const oid of ["seat-1", "seat-2", "seat-3"])
    assert.equal(
      (await entitlements.resolveM365Entitlement(tenantId, oid)).active,
      true,
    );
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    planId: "pro",
    seatLimit: 2,
    subscriptionValidUntil: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(
    (await entitlements.resolveM365Entitlement(tenantId, "seat-1")).active,
    true,
  );
  assert.equal(
    (await entitlements.resolveM365Entitlement(tenantId, "seat-2")).active,
    true,
  );
  const beyond = await entitlements.resolveM365Entitlement(tenantId, "seat-3");
  assert.equal(beyond.active, false);
  assert.equal(beyond.blockedReason, "seat_limit_exceeded");
});

// ── 5. server-side PII masking ────────────────────────────────────────────────────────────────

const EMAIL = "kamal.perera@example.com";
const PHONE = "0771234567";

test("text assist masks personal data before the provider and restores it in the reply", async () => {
  const assist = await import("../src/services/m365TextAssist.js");
  let seen = "";
  assist.setTextAssistRunnerForTests(async (_user, messages) => {
    seen = messages.map((m) => m.content).join("\n");
    const placeholder = /__PII_EMAIL_\d+__/.exec(seen)![0];
    return JSON.stringify({
      text: `Reply to ${placeholder} soon`,
      notes: [placeholder],
    });
  });
  try {
    const result = await assist.assistText(
      { id: "user-sec" } as any,
      {
        host: "word",
        task: "rewrite",
        text: `Please write to ${EMAIL} or call ${PHONE}.`,
        consent: true,
      } as any,
    );
    assert.ok(!seen.includes(EMAIL), "email reached the provider");
    assert.ok(!seen.includes(PHONE), "phone reached the provider");
    assert.match(seen, /__PII_EMAIL_1__/);
    assert.match(seen, /__PII_PHONE_1__/);
    assert.equal(result.text, `Reply to ${EMAIL} soon`);
    assert.deepEqual(result.notes, [EMAIL]);
  } finally {
    assist.setTextAssistRunnerForTests();
  }
});

test("document drafts mask the title, brief and memo header and restore the draft", async () => {
  const draft = await import("../src/services/m365DocDraft.js");
  let seen = "";
  draft.setDraftRunnerForTests(async (_user, messages) => {
    seen = messages.map((m) => m.content).join("\n");
    return JSON.stringify({
      title: "Update for __PII_EMAIL_1__",
      blocks: [
        {
          type: "paragraph",
          runs: [{ text: "Call __PII_PHONE_1__ about the plan." }],
        },
      ],
    });
  });
  try {
    const result = await draft.draftDocument(
      { id: "user-sec" } as any,
      {
        kind: "report",
        title: `Note to ${EMAIL}`,
        brief: `Contact ${PHONE} about the quarterly plan.`,
        length: "short",
        language: "en",
        consent: true,
      } as any,
    );
    assert.ok(!seen.includes(EMAIL) && !seen.includes(PHONE));
    assert.equal(result.title, `Update for ${EMAIL}`);
    assert.equal(
      (result.blocks[0] as any).runs[0].text,
      `Call ${PHONE} about the plan.`,
    );
  } finally {
    draft.setDraftRunnerForTests();
  }
});

test("agent turns mask every message and tool argument server-side and restore the reply", async () => {
  agent.resetAgentRateLimitForTests();
  let sent: any[] = [];
  analysis.setM365AgentRunnerForTests(async (_user, messages) => {
    sent = messages as any[];
    return {
      content: "I will write to __PII_EMAIL_1__.",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: agent.AGENT_TOOL_NAMES[0],
            arguments: JSON.stringify({ note: "__PII_PHONE_1__" }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    } as any;
  });
  const reply = await agent.agentTurn(
    {
      id: "user-sec",
      subscriptionPlan: "free",
      m365Quota: { tenantId, objectId, planSource: "free" },
    } as any,
    {
      consent: true,
      language: "en",
      messages: [
        { role: "user", content: `Email ${EMAIL} the totals, phone ${PHONE}` },
      ],
    },
  );
  const wire = JSON.stringify(sent);
  assert.ok(
    !wire.includes(EMAIL) && !wire.includes(PHONE),
    "PII reached the provider",
  );
  // The fixed system prompt (the cache prefix) is untouched by masking.
  assert.equal(sent[0].content, agent.AGENT_SYSTEM_PROMPT);
  assert.equal(reply.content, `I will write to ${EMAIL}.`);
  assert.ok(reply.tool_calls[0].function.arguments.includes(PHONE));
});

test("masking never collides with placeholders the client already used", () => {
  const { messages, map } = agent.maskAgentMessages([
    {
      role: "user",
      content: `Already masked __PII_EMAIL_1__ and raw ${EMAIL}`,
    },
  ]);
  const text = (messages[0] as any).content as string;
  assert.ok(!text.includes(EMAIL));
  assert.match(text, /__PII_EMAIL_2__/);
  // Only the server's own placeholder is restored; the client's token is left for the client.
  assert.equal(
    map.restore("__PII_EMAIL_1__ __PII_EMAIL_2__"),
    `__PII_EMAIL_1__ ${EMAIL}`,
  );
});

// ── 6. sandbox ────────────────────────────────────────────────────────────────────────────────

test("sandbox routes reject a suspended user before any approval or dispatch", async () => {
  await dbm.dbRun("UPDATE users SET is_suspended = 1 WHERE id = ?", [
    "user-sec",
  ]);
  const preview = await call("POST", "/sandbox/preview", entraToken(), {});
  assert.equal(preview.status, 403);
  assert.equal(preview.json.error.code, "M365_USER_SUSPENDED");
  const submit = await call("POST", "/sandbox/jobs", entraToken(), {});
  assert.equal(submit.status, 403);
  const jobs = await dbm.dbGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM m365_sandbox_jobs",
  );
  assert.equal(Number(jobs!.count), 0);
});

test("the sandbox sweep deletes terminal jobs past retention and keeps recent ones", async () => {
  const sandbox = await import("../src/services/m365Sandbox.js");
  const now = Date.now();
  const insert = (id: string, state: string, expires: number) =>
    dbm.dbRun(
      `INSERT INTO m365_sandbox_jobs (job_id, tenant_id, object_id, user_id, state, input_fingerprint, row_count, column_count, timeout_seconds, created_at_ms, updated_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, 'fp', 1, 1, 30, ?, ?, ?)`,
      [
        id,
        tenantId,
        objectId,
        "user-sec",
        state,
        expires - 900_000,
        expires - 900_000,
        expires,
      ],
    );
  await insert("old-done", "succeeded", now - 8 * 86_400_000);
  await insert("old-failed", "failed", now - 9 * 86_400_000);
  await insert("recent-done", "succeeded", now - 3_600_000);
  const swept = await sandbox.sweepSandboxJobs(now);
  assert.equal(swept.deleted, 2);
  const left = await dbm.dbAll<{ job_id: string }>(
    "SELECT job_id FROM m365_sandbox_jobs",
  );
  assert.deepEqual(
    left.map((row) => row.job_id),
    ["recent-done"],
  );
});

// ── 7. background model token ─────────────────────────────────────────────────────────────────

test("a scoped background model token stops working once the user is suspended or the task is cancelled", async () => {
  process.env.BG_MODEL_TOKEN_SECRET = "test-bg-secret-test-bg-secret-test-bg";
  const { mintBackgroundModelToken } = await import(
    "../src/services/backgroundModelToken.js"
  );
  const express = (await import("express")).default;
  const { backgroundInternalRouter } = await import(
    "../src/routes/backgroundInternal.js"
  );
  const app = express();
  app.use(express.json());
  app.use("/internal", backgroundInternalRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/internal/model/v1/chat/completions`;
  const post = async (bearer: string) => {
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      // ignore
    }
    return { status: response.status, json };
  };
  try {
    const token = mintBackgroundModelToken("task-1", "user-sec");
    // Garbage and forged tokens stay a 401.
    assert.equal((await post("not-a-token")).status, 401);
    // No such running task: a 409 (the token itself is fine for an active user).
    const unknownTask = await post(token);
    assert.equal(unknownTask.status, 409);
    assert.equal(unknownTask.json.error.code, "BACKGROUND_TASK_NOT_RUNNING");
    // Tokens of cancelled, cancel-requested and finished tasks never reach the model.
    for (const status of [
      "cancel_requested",
      "canceled",
      "completed",
      "failed",
      "purged",
    ]) {
      const taskId = `task-${status}`;
      await dbm.dbRun(
        `INSERT INTO background_tasks (id, user_id, status, project_fingerprint, manifest_digest, estimate_credits, cap_credits, quote_id, idempotency_key)
         VALUES (?, ?, ?, 'fp', 'md', 10, 100, ?, ?)`,
        [taskId, "user-sec", status, `quote-${status}`, `idem-${status}`],
      );
      const done = await post(mintBackgroundModelToken(taskId, "user-sec"));
      assert.equal(done.status, 409, status);
      assert.equal(done.json.error.code, "BACKGROUND_TASK_NOT_RUNNING", status);
    }
    // A suspended user is refused before any task or quota lookup.
    await dbm.dbRun("UPDATE users SET is_suspended = 1 WHERE id = ?", [
      "user-sec",
    ]);
    const suspended = await post(token);
    assert.equal(suspended.status, 403);
    assert.equal(suspended.json.error.code, "BACKGROUND_USER_SUSPENDED");
    // A deleted user is refused the same way.
    const ghost = await post(
      mintBackgroundModelToken("task-2", "no-such-user"),
    );
    assert.equal(ghost.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
