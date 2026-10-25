// Must be the first import: it patches Express 4 before any router in this file is created.
import "../src/services/asyncRoutes.js";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * Code review 2026-10-25 (R1/R4 auth findings): regression tests for the behavioural fixes.
 * Runs on SQLite; the PostgreSQL run of the suite covers the same SQL through the other test files.
 */

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "vynor-code-review-auth-"),
);
const originalCwd = process.cwd();
const SECRET = "code-review-auth-secret-at-least-32-characters";
const PASSWORD = "CorrectHorse!123";
const TENANT = "aaaaaaaa-1111-4111-8111-111111111111";
const API_CLIENT = "cccccccc-3333-4333-8333-333333333333";
const CALLER_CLIENT = "dddddddd-4444-4444-8444-444444444444";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

let baseUrl = "";
let server: http.Server;
let jwksServer: http.Server;
let dbm: typeof import("../src/db.js");
let security: typeof import("../src/middleware/security.js");
let accountSecurity: typeof import("../src/services/accountSecurity.js");
let linking: typeof import("../src/services/m365Linking.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let passwordHash = "";

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

function entraToken(oid: string, scopes = "m365.excel.read m365.excel.write") {
  return jwt.sign(
    {
      ver: "2.0",
      tid: TENANT,
      oid,
      name: "Test Person",
      preferred_username: "test.person@example.org",
      scp: scopes,
      azp: CALLER_CLIENT,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: "test-key",
      audience: API_CLIENT,
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      expiresIn: "5m",
    },
  );
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  token?: string,
  prefix = "/api/auth",
) {
  const response = await fetch(`${baseUrl}${prefix}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as any,
  };
}

async function addUser(
  id: string,
  options: { verified?: number; suspended?: number; email?: string } = {},
) {
  await dbm.dbRun("DELETE FROM users WHERE id = ?", [id]);
  const apiKey = `vynor_live_${id.replace(/[^a-z0-9]/gi, "")}`;
  await dbm.dbRun(
    `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name, email_verified, is_suspended)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      options.email ?? `${id}@example.com`,
      passwordHash,
      `key-${id}`,
      sha256(apiKey),
      id,
      options.verified ?? 1,
      options.suspended ?? 0,
    ],
  );
  return apiKey;
}

async function login(email: string): Promise<string> {
  const res = await call("POST", "/login", { email, password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
}

before(async () => {
  process.chdir(tmpDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: SECRET,
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
    DB_DRIVER: "sqlite",
    M365_ENTRA_TENANT_ID: TENANT,
    M365_ENTRA_API_CLIENT_ID: API_CLIENT,
    M365_ENTRA_ALLOWED_CLIENT_IDS: CALLER_CLIENT,
  });
  delete process.env.DATABASE_URL;
  delete process.env.M365_ENTRA_MULTI_TENANT;
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
  process.env.M365_ENTRA_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/keys`;

  dbm = await import("../src/db.js");
  await dbm.initDb();
  security = await import("../src/middleware/security.js");
  accountSecurity = await import("../src/services/accountSecurity.js");
  linking = await import("../src/services/m365Linking.js");
  registry = await import("../src/services/m365TenantRegistry.js");
  passwordHash = await bcrypt.hash(PASSWORD, 4);

  const express = (await import("express")).default;
  const { authRouter } = await import("../src/routes/auth.js");
  const { m365Router } = await import("../src/routes/m365.js");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/v1/m365", m365Router);
  // R1#1 / R4#1: an async handler that rejects.
  app.get("/boom", async () => {
    throw new Error("database blip");
  });
  app.get("/alive", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(
    (
      err: Error,
      _req: import("express").Request,
      res: import("express").Response,
      _next: import("express").NextFunction,
    ) => {
      res.status(500).json({ error: "Internal server error" });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  security.resetRateLimitMemoryStore();
  accountSecurity.resetWindowsForTests();
  linking.resetLinkFailureCounters();
  await dbm.dbRun("DELETE FROM email_verifications");
  await dbm.dbRun("DELETE FROM password_reset_tokens");
});

after(async () => {
  server?.close();
  jwksServer?.close();
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});

// ── R1#1 / R4#1 ────────────────────────────────────────────────────────────────────────────────

test("a rejected async handler answers 500 and the process keeps serving (no crash)", async () => {
  const boom = await fetch(`${baseUrl}/boom`);
  assert.equal(boom.status, 500);
  const alive = await fetch(`${baseUrl}/alive`);
  assert.equal(alive.status, 200);
  assert.ok(
    process.listenerCount("unhandledRejection") >= 1,
    "a logging backstop is installed",
  );
});

// ── R1#2: pre-account takeover ─────────────────────────────────────────────────────────────────

test("Google sign-in on an UNVERIFIED account resets the registrant's password, key and codes", async () => {
  const { findOrCreateGoogleUser } = await import(
    "../src/routes/googleAuth.js"
  );
  const email = "victim@example.com";
  const attackerKey = await addUser("takeover-1", { verified: 0, email });
  await dbm.dbRun(
    "INSERT INTO email_verifications (id, user_id, email, otp_hash, token_hash, otp_code, token, attempts, expires_at) VALUES ('ev1', 'takeover-1', ?, 'a', 'b', '', '', 0, ?)",
    [email, new Date(Date.now() + 3600_000).toISOString()],
  );
  await dbm.dbRun(
    "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ('pr1', 'takeover-1', 'c', ?)",
    [new Date(Date.now() + 3600_000).toISOString()],
  );
  const before = await dbm.dbGet<any>(
    "SELECT password_hash, api_key_hash FROM users WHERE id = 'takeover-1'",
  );

  const result = await findOrCreateGoogleUser(email, "Victim");
  assert.equal(result.id, "takeover-1");
  assert.equal(result.created, false);

  const after = await dbm.dbGet<any>(
    "SELECT password_hash, api_key_hash, email_verified FROM users WHERE id = 'takeover-1'",
  );
  assert.equal(after.email_verified, 1);
  assert.notEqual(after.password_hash, before.password_hash);
  assert.notEqual(after.api_key_hash, before.api_key_hash);
  assert.notEqual(
    after.api_key_hash,
    sha256(attackerKey),
    "the registrant's key is revoked",
  );
  assert.equal(
    await bcrypt.compare(PASSWORD, after.password_hash),
    false,
    "the registrant's password no longer works",
  );
  assert.equal(
    result.passwordHash,
    after.password_hash,
    "the new session is bound to the new hash",
  );
  assert.equal(
    (
      await dbm.dbAll<any>(
        "SELECT 1 FROM email_verifications WHERE user_id = 'takeover-1'",
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await dbm.dbAll<any>(
        "SELECT 1 FROM password_reset_tokens WHERE user_id = 'takeover-1'",
      )
    ).length,
    0,
  );
});

test("Google sign-in on an already VERIFIED account leaves its password and key alone", async () => {
  const { findOrCreateGoogleUser } = await import(
    "../src/routes/googleAuth.js"
  );
  await addUser("verified-1", { verified: 1, email: "owner@example.com" });
  const before = await dbm.dbGet<any>(
    "SELECT password_hash, api_key_hash FROM users WHERE id = 'verified-1'",
  );
  await findOrCreateGoogleUser("owner@example.com", "Owner");
  const after = await dbm.dbGet<any>(
    "SELECT password_hash, api_key_hash FROM users WHERE id = 'verified-1'",
  );
  assert.deepEqual(after, before);
});

test("a completed password reset also rotates the API key", async () => {
  const key = await addUser("reset-1", { email: "reset@example.com" });
  const token = crypto.randomBytes(32).toString("hex");
  await dbm.dbRun(
    "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ('prt', 'reset-1', ?, ?)",
    [sha256(token), new Date(Date.now() + 600_000).toISOString()],
  );
  const res = await call("POST", "/reset-password", {
    token,
    newPassword: "BrandNewPassw0rd!",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = await dbm.dbGet<any>(
    "SELECT api_key_hash FROM users WHERE id = 'reset-1'",
  );
  assert.notEqual(row.api_key_hash, sha256(key));
});

// ── R1#6: DB error must not look like a bad token ──────────────────────────────────────────────

test("a database failure during session lookup is a 5xx, an invalid token is a 401", async () => {
  await addUser("db-fail-1");
  const token = await login("db-fail-1@example.com");
  await dbm.dbRun(
    "ALTER TABLE users RENAME COLUMN api_key_masked TO api_key_masked_x",
  );
  try {
    const down = await call("GET", "/me", undefined, token);
    assert.equal(
      down.status,
      503,
      "the stored session must not be treated as invalid",
    );
  } finally {
    await dbm.dbRun(
      "ALTER TABLE users RENAME COLUMN api_key_masked_x TO api_key_masked",
    );
  }
  const bad = await call("GET", "/me", undefined, "not.a.jwt");
  assert.equal(bad.status, 401);
  const ok = await call("GET", "/me", undefined, token);
  assert.equal(ok.status, 200);
});

// ── R1#8: login ────────────────────────────────────────────────────────────────────────────────

test("suspension is revealed only after the correct password; unknown and wrong-password look alike", async () => {
  await addUser("susp-1", { suspended: 1 });
  const wrong = await call("POST", "/login", {
    email: "susp-1@example.com",
    password: "wrongwrong1",
  });
  assert.equal(
    wrong.status,
    401,
    "wrong password on a suspended account is a plain 401",
  );
  const unknown = await call("POST", "/login", {
    email: "nobody-here@example.com",
    password: "wrongwrong1",
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(
    wrong.body,
    unknown.body,
    "same answer for a known and an unknown address",
  );
  const right = await call("POST", "/login", {
    email: "susp-1@example.com",
    password: PASSWORD,
  });
  assert.equal(right.status, 403);
});

// ── R1#9: verification codes ───────────────────────────────────────────────────────────────────

test("send-verification has a one-minute cooldown, a daily cap, and keeps spent guesses", async () => {
  await addUser("verify-1", { verified: 0 });
  const token = await login("verify-1@example.com");

  const first = await call("POST", "/send-verification", {}, token);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await call("POST", "/send-verification", {}, token);
  assert.equal(second.status, 429);
  assert.equal(second.body.code, "VERIFICATION_COOLDOWN");

  // A still-valid code that already absorbed wrong guesses keeps them across a resend.
  await dbm.dbRun(
    "UPDATE email_verifications SET attempts = 3, created_at = ? WHERE user_id = 'verify-1'",
    [new Date(Date.now() - 5 * 60_000).toISOString()],
  );
  const third = await call("POST", "/send-verification", {}, token);
  assert.equal(third.status, 200, JSON.stringify(third.body));
  const row = await dbm.dbGet<any>(
    "SELECT attempts FROM email_verifications WHERE user_id = 'verify-1'",
  );
  assert.equal(
    Number(row.attempts),
    3,
    "asking for a new code does not reset the guess counter",
  );

  // Daily cap: pretend the cooldown has passed every time.
  accountSecurity.resetWindowsForTests();
  for (let i = 0; i < 5; i += 1)
    await accountSecurity.windowHit("verify:send:verify-1", 86_400_000);
  await dbm.dbRun(
    "UPDATE email_verifications SET created_at = ? WHERE user_id = 'verify-1'",
    [new Date(Date.now() - 5 * 60_000).toISOString()],
  );
  const capped = await call("POST", "/send-verification", {}, token);
  assert.equal(capped.status, 429);
  assert.equal(capped.body.code, "VERIFICATION_DAILY_CAP");
});

test("verify-email locks an account out after the daily guess budget, even across fresh codes", async () => {
  await addUser("verify-2", { verified: 0 });
  const token = await login("verify-2@example.com");
  await dbm.dbRun(
    "INSERT INTO email_verifications (id, user_id, email, otp_hash, token_hash, otp_code, token, attempts, expires_at) VALUES ('ev2', 'verify-2', 'verify-2@example.com', ?, 'b', '', '', 0, ?)",
    [sha256("123456"), new Date(Date.now() + 3600_000).toISOString()],
  );
  for (let i = 0; i < 15; i += 1)
    await accountSecurity.windowHit("verify:fail:verify-2", 86_400_000);
  const right = await call("POST", "/verify-email", { otp: "123456" }, token);
  assert.equal(
    right.status,
    429,
    "even the right code is refused once the daily budget is spent",
  );
  assert.equal(right.body.code, "VERIFICATION_LOCKED");
});

// ── R1#13 / R1#14: session-only actions ────────────────────────────────────────────────────────

test("an API key cannot change the password or rotate itself, a web session can", async () => {
  const apiKey = await addUser("keyuser-1");
  const rotateWithKey = await call("POST", "/rotate-key", {}, apiKey);
  assert.equal(rotateWithKey.status, 403);
  const changeWithKey = await call(
    "POST",
    "/change-password",
    { currentPassword: PASSWORD, newPassword: "AnotherPassw0rd!" },
    apiKey,
  );
  assert.equal(changeWithKey.status, 403);

  const token = await login("keyuser-1@example.com");
  const rotated = await call("POST", "/rotate-key", {}, token);
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
  assert.match(rotated.body.apiKey, /^vynor_live_/);
});

test("change-password hashes with cost 12", async () => {
  await addUser("cost-1");
  const token = await login("cost-1@example.com");
  const res = await call(
    "POST",
    "/change-password",
    { currentPassword: PASSWORD, newPassword: "CostTwelvePassw0rd!" },
    token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = await dbm.dbGet<any>(
    "SELECT password_hash FROM users WHERE id = 'cost-1'",
  );
  assert.equal(bcrypt.getRounds(row.password_hash), 12);
});

// ── R1#7: delete-account ───────────────────────────────────────────────────────────────────────

test("delete-account needs the current password: a stolen session alone cannot delete", async () => {
  await addUser("del-1", { email: "del-1@example.com" });
  const token = await login("del-1@example.com");

  const missing = await call(
    "POST",
    "/delete-account",
    { confirmEmail: "del-1@example.com" },
    token,
  );
  assert.equal(missing.status, 400, "the password field is required");

  const wrong = await call(
    "POST",
    "/delete-account",
    { confirmEmail: "del-1@example.com", password: "not-the-password" },
    token,
  );
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, "PASSWORD_REQUIRED");
  assert.ok(
    await dbm.dbGet("SELECT id FROM users WHERE id = 'del-1'"),
    "the account is untouched",
  );

  const right = await call(
    "POST",
    "/delete-account",
    { confirmEmail: "del-1@example.com", password: PASSWORD },
    token,
  );
  assert.equal(right.status, 200, JSON.stringify(right.body));
  assert.equal(
    await dbm.dbGet("SELECT id FROM users WHERE id = 'del-1'"),
    undefined,
  );
});

// ── R1#12: rate-limit key ──────────────────────────────────────────────────────────────────────

test("the proxy rate limiter never uses the raw credential as a key", async () => {
  const header = "Bearer vynor_live_super_secret_credential_value";
  const req: any = {
    headers: { authorization: header },
    ip: "127.0.0.1",
    socket: {},
  };
  const res: any = {
    setHeader() {},
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  await new Promise<void>((resolve) =>
    security.proxyRateLimiter(req, res, () => resolve()),
  );
  const hashed = `proxy_token_${sha256(header).slice(0, 32)}`;
  assert.ok(
    security.getRateLimitMemoryRecord(hashed),
    "the fingerprint key is used",
  );
  assert.equal(
    security.getRateLimitMemoryRecord(`proxy_token_${header}`),
    undefined,
  );
});

// ── R1#11: Cloudflare Access key refetch ───────────────────────────────────────────────────────

test("forged assertions with random key ids cannot trigger a refetch per request", async () => {
  const cf = await import("../src/services/cfAccess.js");
  let fetches = 0;
  cf.setCfAccessJwksFetcherForTests(async () => {
    fetches += 1;
    return { keys: [{ kty: "RSA", kid: "real", n: "AQAB", e: "AQAB" }] };
  });
  const config = { teamDomain: "team.example.com", audience: "aud" };
  for (let i = 0; i < 5; i += 1) {
    const forged = jwt.sign({ email: "a@b.c" }, "secret", {
      header: { alg: "HS256", kid: `random-${i}` },
    } as any);
    const result = await cf.verifyCfAccessAssertion(forged, "a@b.c", config);
    assert.equal(result.ok, false);
  }
  assert.ok(
    fetches <= 2,
    `expected at most one load and one forced refetch, saw ${fetches}`,
  );
  cf.setCfAccessJwksFetcherForTests(undefined);
});

// ── R1#3 / R1#17: linking seats and the per-account cap ─────────────────────────────────────────

async function setTenant(seatLimit: number, planId: "starter" | null) {
  await registry.upsertM365Tenant({
    tenantId: TENANT,
    displayName: "SLTS",
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
    aiEnabled: true,
    planId,
    seatLimit,
    subscriptionValidUntil: null,
  });
}

async function linkVia(userId: string, objectId: string) {
  const started = await linking.startLinkCode({
    tenantId: TENANT,
    objectId,
    label: "Test (t***@example.org)",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  return linking.confirmLinkCode({
    userId,
    emailVerified: true,
    ip: "203.0.113.9",
    rawCode: started.linkCode,
    confirm: true,
  });
}

test("a tenant WITHOUT a plan does not apply its default seat limit to self-service links", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await setTenant(1, null);
  await addUser("seat-a");
  await addUser("seat-b");
  const first = await linkVia("seat-a", "oid-seat-a");
  const second = await linkVia("seat-b", "oid-seat-b");
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(
    second.ok,
    true,
    "the second person is not blocked by the placeholder seat limit",
  );
});

test("a tenant WITH a plan still enforces its seats at link time", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await setTenant(1, "starter");
  await addUser("seat-c");
  await addUser("seat-d");
  assert.equal((await linkVia("seat-c", "oid-seat-c")).ok, true);
  const second = await linkVia("seat-d", "oid-seat-d");
  assert.equal(second.ok, false);
  assert.equal(second.code, "m365_seat_limit_reached");
});

test("the three-identities-per-account cap holds under simultaneous confirmations", async () => {
  await dbm.dbRun("DELETE FROM m365_identity_links");
  await setTenant(50, null);
  await addUser("cap-1");
  const codes: Array<{ oid: string; code: string }> = [];
  for (let i = 0; i < 5; i += 1) {
    const oid = `oid-cap-${i}`;
    const started = await linking.startLinkCode({
      tenantId: TENANT,
      objectId: oid,
      label: "x",
    });
    codes.push({ oid, code: started.linkCode as string });
  }
  const results = await Promise.all(
    codes.map((entry) =>
      linking.confirmLinkCode({
        userId: "cap-1",
        emailVerified: true,
        ip: "203.0.113.10",
        rawCode: entry.code,
        confirm: true,
      }),
    ),
  );
  const ok = results.filter((r) => r.ok).length;
  const owned = await dbm.dbGet<any>(
    "SELECT COUNT(*) AS count FROM m365_identity_links WHERE user_id = 'cap-1' AND enabled = 1",
  );
  assert.equal(Number(owned.count), 3);
  assert.equal(ok, 3);
  assert.ok(results.some((r) => r.code === "m365_user_link_limit"));
});

// ── R1#4 / R1#18: link routes ───────────────────────────────────────────────────────────────────

test("a missing scope is not reported as a recorded tenant-enable request", async () => {
  await setTenant(5, null);
  const res = await call(
    "POST",
    "/link/start",
    undefined,
    entraToken("oid-scope", "m365.excel.write"),
    "/v1/m365",
  );
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.ok(res.body.error.code);
  assert.equal(res.body.error.action, undefined);
  assert.equal(res.body.error.requestRecorded, undefined);
});

test("link status polling is not limited by the shared 60-per-10-minutes bucket", async () => {
  await setTenant(5, null);
  const token = entraToken("oid-poll");
  let lastStatus = 0;
  for (let i = 0; i < 90; i += 1) {
    const res = await call("GET", "/link/status", undefined, token, "/v1/m365");
    lastStatus = res.status;
    if (res.status !== 200) break;
  }
  assert.equal(lastStatus, 200, "90 polls (3 minutes at 2 s) all succeed");
});
