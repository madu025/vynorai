import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/** Phase 2-A: login/session behaviour, key-at-rest refusal and account deletion scrub. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-sec-2a-auth-"));
const originalCwd = process.cwd();
const PASSWORD = "OldPassword!123";
const NEW_PASSWORD = "NewPassword!456";
const SECRET = "security-2a-auth-test-secret-at-least-32-chars";
const EMAIL = "scrub.me@example.com";
const USER_ID = "auth-user-1";
const TENANT = "77777777-7777-4777-8777-777777777777";
const OBJECT_ID = "obj-scrub-0000-aaaa";

let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = SECRET;
  process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  dbm = await import("../src/db.js");
  await dbm.initDb();
  await dbm.dbRun(
    `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [
      USER_ID,
      EMAIL,
      await bcrypt.hash(PASSWORD, 4),
      "key-auth-user-1",
      crypto.createHash("sha256").update("key-auth-user-1").digest("hex"),
      "Auth User",
    ],
  );
  const express = (await import("express")).default;
  const { authRouter } = await import("../src/routes/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});

async function call(
  method: string,
  pathname: string,
  body?: unknown,
  token?: string,
) {
  const response = await fetch(`${baseUrl}/api/auth${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: (await response.json().catch(() => ({}))) as any };
}

test("a failed login for an unknown address keeps only a fingerprint, never the address", async () => {
  const raw = "victim.of.typo@example.org";
  const res = await call("POST", "/login", {
    email: raw,
    password: "whatever1",
  });
  assert.equal(res.response.status, 401);
  const rows = await dbm.dbAll<any>(
    "SELECT actor, details FROM security_audit_logs WHERE event_type = 'AUTH_LOGIN_FAILED'",
  );
  assert.ok(rows.length >= 1);
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(raw));
  assert.match(rows[0].actor, /^unknown:[a-f0-9]{16}$/);
});

test("login audit rows use the user id, not the e-mail", async () => {
  const res = await call("POST", "/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  assert.equal(res.response.status, 200);
  const rows = await dbm.dbAll<any>(
    "SELECT actor FROM security_audit_logs WHERE event_type = 'AUTH_LOGIN_SUCCESS'",
  );
  assert.deepEqual(
    rows.map((row) => row.actor),
    [USER_ID],
  );
});

test("a password change ends older sessions and hands back a fresh one", async () => {
  const login = await call("POST", "/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  const oldToken = login.body.token as string;
  assert.ok(oldToken);
  assert.equal(
    (await call("GET", "/me", undefined, oldToken)).response.status,
    200,
  );

  const changed = await call(
    "POST",
    "/change-password",
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    oldToken,
  );
  assert.equal(changed.response.status, 200);
  assert.ok(changed.body.token, "a fresh session token is returned");

  assert.equal(
    (await call("GET", "/me", undefined, oldToken)).response.status,
    401,
  );
  assert.equal(
    (await call("GET", "/me", undefined, changed.body.token)).response.status,
    200,
  );
  // The password hash is never attached to the request user or returned.
  const me = await call("GET", "/me", undefined, changed.body.token);
  assert.ok(!JSON.stringify(me.body).includes("password_hash"));
});

test("a token minted for another purpose with the same secret is not a user session", async () => {
  const background = jwt.sign(
    { taskId: "t-1", userId: USER_ID, scope: "background:model" },
    SECRET,
  );
  assert.equal(
    (await call("GET", "/me", undefined, background)).response.status,
    401,
  );
  const m365 = jwt.sign({ userId: USER_ID, kind: "m365_session" }, SECRET);
  assert.equal(
    (await call("GET", "/me", undefined, m365)).response.status,
    401,
  );
  // A pre-change token (raw secret, no kind) is still honoured during its 30 day life.
  const legacy = jwt.sign({ userId: USER_ID, email: EMAIL }, SECRET, {
    expiresIn: "30d",
  });
  assert.equal(
    (await call("GET", "/me", undefined, legacy)).response.status,
    200,
  );
});

test("key rotation refuses to store a plaintext key when encryption is unavailable", async () => {
  const login = await call("POST", "/login", {
    email: EMAIL,
    password: NEW_PASSWORD,
  });
  const token = login.body.token as string;
  const savedKey = process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DATA_ENCRYPTION_KEY;
  try {
    const before = await dbm.dbGet<any>(
      "SELECT api_key, api_key_hash FROM users WHERE id = ?",
      [USER_ID],
    );
    const res = await call("POST", "/rotate-key", {}, token);
    assert.equal(res.response.status, 503);
    assert.equal(res.body.code, "ENCRYPTION_UNAVAILABLE");
    const after = await dbm.dbGet<any>(
      "SELECT api_key, api_key_hash FROM users WHERE id = ?",
      [USER_ID],
    );
    assert.deepEqual(after, before, "nothing was written");
  } finally {
    process.env.DATA_ENCRYPTION_KEY = savedKey;
  }
  const ok = await call("POST", "/rotate-key", {}, token);
  assert.equal(ok.response.status, 200);
  const row = await dbm.dbGet<any>("SELECT api_key FROM users WHERE id = ?", [
    USER_ID,
  ]);
  assert.equal(row.api_key, `encrypted:${USER_ID}`);
});

test("deleting an account scrubs audit details and removes id-keyed rows", async () => {
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    [TENANT, OBJECT_ID, USER_ID],
  );
  await dbm.dbRun(
    "INSERT INTO m365_quota_reservations (id, tenant_id, object_id, user_id, tokens, requests, created_at) VALUES (?, ?, ?, ?, 10, 1, ?)",
    ["res-1", TENANT, OBJECT_ID, USER_ID, new Date().toISOString()],
  );
  await dbm.dbRun(
    "INSERT INTO quota_reservations (id, user_id, tokens, requests, created_at) VALUES (?, ?, 10, 1, ?)",
    ["res-2", USER_ID, new Date().toISOString()],
  );
  await dbm.dbRun(
    `INSERT INTO m365_tenant_usage (id, tenant_id, object_id, user_id, plan_name, max_tokens, period_start, period_end)
     VALUES ('use-1', ?, ?, ?, 'free', 1000, '2026-10-01', '2026-11-01')`,
    [TENANT, OBJECT_ID, USER_ID],
  );
  const { logSecurityEvent } = await import("../src/services/securityAudit.js");
  await logSecurityEvent({
    eventType: "M365_IDENTITY_LINKED",
    actor: "admin-secret",
    target: TENANT,
    details: JSON.stringify({ objectId: OBJECT_ID, userId: USER_ID }),
  });
  await logSecurityEvent({
    eventType: "SUPPORT_NOTE",
    actor: "admin-secret",
    details: `Contacted ${EMAIL} about billing`,
  });

  const login = await call("POST", "/login", {
    email: EMAIL,
    password: NEW_PASSWORD,
  });
  const deleted = await call(
    "POST",
    "/delete-account",
    { confirmEmail: EMAIL },
    login.body.token,
  );
  assert.equal(deleted.response.status, 200);

  const logs = JSON.stringify(
    await dbm.dbAll<any>(
      "SELECT actor, target, details FROM security_audit_logs",
    ),
  );
  assert.ok(!logs.includes(EMAIL), "the e-mail is gone from the audit log");
  assert.ok(!logs.includes(USER_ID), "the user id is gone from the audit log");
  assert.ok(
    !logs.includes(OBJECT_ID),
    "the Entra object id is gone from the audit log",
  );
  assert.equal(
    (
      await dbm.dbAll<any>(
        "SELECT 1 FROM quota_reservations WHERE user_id = ?",
        [USER_ID],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await dbm.dbAll<any>(
        "SELECT 1 FROM m365_quota_reservations WHERE user_id = ?",
        [USER_ID],
      )
    ).length,
    0,
  );
  const usage = await dbm.dbAll<any>(
    "SELECT user_id, used_tokens FROM m365_tenant_usage",
  );
  assert.equal(usage.length, 1, "usage counts are kept");
  assert.match(usage[0].user_id, /^deleted:[a-f0-9]{24}$/);
});
