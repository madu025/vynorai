// Must be the first import: it patches Express 4 before any router in this file is created.
import "../src/services/asyncRoutes.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, mock, test } from "node:test";
import bcrypt from "bcryptjs";

/**
 * SQLite stores CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" (UTC, no zone). Comparing such a column
 * in SQL with an ISO parameter ("YYYY-MM-DDTHH:MM:SS.sssZ") is wrong on the same calendar day,
 * because a space sorts before "T". Every test here seeds a CURRENT_TIMESTAMP-style value and a
 * cutoff on the SAME day, so the old ISO comparison gives the wrong answer; the clock is fixed
 * (a `now` parameter or a mocked Date) wherever the code allows it.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-time-compare-"));
const originalCwd = process.cwd();
const SECRET = "time-compare-secret-at-least-32-characters-long";
const PASSWORD = "CorrectHorse!123";

let dbm: typeof import("../src/db.js");
let server: import("node:http").Server;
let baseUrl = "";
let passwordHash = "";

/** The text SQLite's CURRENT_TIMESTAMP would store for this instant. */
const sqliteTs = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function addUser(id: string) {
  await dbm.dbRun(
    `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, `${id}@example.com`, passwordHash, `key-${id}`, `hash-${id}`, id],
  );
}

async function addTask(id: string, userId: string, createdAtMs: number) {
  await dbm.dbRun(
    `INSERT INTO background_tasks
       (id, user_id, status, project_fingerprint, manifest_digest, estimate_credits,
        cap_credits, quote_id, idempotency_key, created_at)
     VALUES (?, ?, 'awaiting_upload', 'f', 'm', 1, 1, ?, ?, ?)`,
    [id, userId, `quote-${id}`, `idempotency-${id}`, sqliteTs(createdAtMs)],
  );
}

before(async () => {
  process.chdir(tmpDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: SECRET,
    DB_DRIVER: "sqlite",
    BG_QUOTE_SECRET: "q".repeat(48),
    BG_MODEL_TOKEN_SECRET: "m".repeat(48),
  });
  delete process.env.DATABASE_URL;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const id of ["u-bg", "u-month", "u-orders", "u-export", "u-memory"])
    await addUser(id);

  const express = (await import("express")).default;
  const { authRouter } = await import("../src/routes/auth.js");
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/admin", adminRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  mock.timers.reset();
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

test("dbTimestampParam formats an instant like SQLite's CURRENT_TIMESTAMP", () => {
  const ms = Date.UTC(2026, 10, 1, 9, 30, 15, 999);
  assert.equal(dbm.dbTimestampParam(ms), "2026-11-01 09:30:15");
  assert.equal(dbm.dbTimestampParam(new Date(ms)), "2026-11-01 09:30:15");
});

test("an upload created minutes ago is not expired, an older one is (same calendar day)", async () => {
  const { reconcileExpiredBackgroundUploads } = await import(
    "../src/services/backgroundTasks.js"
  );
  const now = Date.UTC(2026, 10, 1, 10, 10, 0);
  await addTask("t-fresh", "u-bg", Date.UTC(2026, 10, 1, 10, 0, 0));
  await addTask("t-stale", "u-bg", Date.UTC(2026, 10, 1, 9, 0, 0));
  const released = await reconcileExpiredBackgroundUploads(now);
  const rows = await dbm.dbAll<{ id: string; status: string }>(
    "SELECT id, status FROM background_tasks WHERE user_id = 'u-bg'",
  );
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(status["t-fresh"], "awaiting_upload");
  assert.equal(status["t-stale"], "failed");
  assert.equal(released, 1);
});

test("a task created on the 1st of the month counts toward that month's allowance", async () => {
  const { getBackgroundEntitlement } = await import(
    "../src/services/backgroundTasks.js"
  );
  await addTask("t-first", "u-month", Date.UTC(2026, 10, 1, 10, 0, 0));
  await addTask("t-prev", "u-month", Date.UTC(2026, 9, 31, 23, 59, 0));
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 15, 12, 0, 0) });
  const entitlement = await getBackgroundEntitlement("u-month");
  assert.equal(entitlement.usedThisMonth, 1);
});

test("a pending order older than the TTL fails and a newer one stays pending (same calendar day)", async () => {
  const { reapStalePendingOrders, PENDING_ORDER_TTL_MS } = await import(
    "../src/services/monthlyQuota.js"
  );
  const now = Date.UTC(2026, 10, 10, 12, 0, 0);
  const insert = (id: string, createdMs: number) =>
    dbm.dbRun(
      `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, amount, currency, valid_until, created_at)
       VALUES (?, 'u-orders', 'starter', 'pending', ?, 1, 'LKR', ?, ?)`,
      [id, `order-${id}`, new Date(now).toISOString(), sqliteTs(createdMs)],
    );
  // Same calendar day as the cutoff (2026-11-09 12:00:00): one just inside, one just outside.
  await insert("o-inside", now - PENDING_ORDER_TTL_MS + 60_000);
  await insert("o-outside", now - PENDING_ORDER_TTL_MS - 60_000);
  await reapStalePendingOrders(new Date(now));
  const rows = await dbm.dbAll<{ id: string; status: string }>(
    "SELECT id, status FROM subscriptions WHERE user_id = 'u-orders'",
  );
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  assert.equal(status["o-inside"], "pending");
  assert.equal(status["o-outside"], "failed");
});

test("the admission snapshot counts requests of the last minute, five minutes and hour", async () => {
  const { getAdmissionSnapshot } = await import(
    "../src/services/admissionControl.js"
  );
  const now = Date.UTC(2026, 10, 1, 10, 0, 0);
  const log = (id: string, agoMs: number) =>
    dbm.dbRun(
      `INSERT INTO usage_logs (id, user_id, model, tokens_used, created_at)
       VALUES (?, 'u-bg', 'm', 10, ?)`,
      [id, sqliteTs(now - agoMs)],
    );
  await log("l-30s", 30_000);
  await log("l-3m", 3 * 60_000);
  await log("l-30m", 30 * 60_000);
  mock.timers.enable({ apis: ["Date"], now });
  const snapshot: any = await getAdmissionSnapshot();
  const text = JSON.stringify(snapshot);
  assert.match(text, /"rpm":1[,}]/);
  assert.match(text, /"requests5m":2[,}]/);
  assert.match(text, /"requests1h":3[,}]/);
});

test("an expired memory entry is hidden even on its expiry day", async () => {
  const { getUserMemory, ensureMemoryTables } = await import(
    "../src/services/memoryEngine.js"
  );
  await ensureMemoryTables();
  const at = (deltaMs: number) => new Date(Date.now() + deltaMs).toISOString();
  const put = (id: string, key: string, expires: string) =>
    dbm.dbRun(
      "INSERT INTO user_memory (id, user_id, key, value, expires_at) VALUES (?, 'u-memory', ?, 'v', ?)",
      [id, key, expires],
    );
  await put("m-expired", "expired", at(-60_000));
  await put("m-live", "live", at(60 * 60_000));
  const memory = await getUserMemory("u-memory");
  assert.equal(memory.live, "v");
  assert.equal(memory.expired, undefined);
});

test("admin stats count requests from the last 24 hours, including the cutoff's own day", async () => {
  const cutoffMs = Date.now() - 24 * 3600_000;
  // One second after the cutoff, in SQLite's CURRENT_TIMESTAMP format.
  await dbm.dbRun(
    `INSERT INTO usage_logs (id, user_id, model, tokens_used, created_at)
     VALUES ('l-24h', 'u-bg', 'stats-model', 5, ?)`,
    [sqliteTs(cutoffMs + 1000)],
  );
  const res = await fetch(`${baseUrl}/admin/stats`, {
    headers: { "cf-access-authenticated-user-email": "admin@vynor.lk" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    body.topModels24h.some((row: any) => row.model === "stats-model"),
    JSON.stringify(body.topModels24h),
  );
});

test("the data export includes economics rows from the start of its 365-day window", async () => {
  const cutoffMs = Date.now() - 365 * 86400_000;
  await dbm.dbRun(
    `INSERT INTO request_economics (id, request_id, user_id, plan_id, requested_model, provider,
        input_tokens, output_tokens, cost_source, cache_status, outcome, created_at)
     VALUES ('e-edge', 'r-edge', 'u-export', 'pro', 'edge-model', 'p', 1, 1, 'unknown', 'miss', 'success', ?)`,
    [sqliteTs(cutoffMs + 1000)],
  );
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "u-export@example.com", password: PASSWORD }),
  });
  const { token } = (await login.json()) as any;
  assert.ok(token);
  const res = await fetch(`${baseUrl}/api/auth/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(
    JSON.stringify(body.usage).includes("edge-model"),
    JSON.stringify(body.usage),
  );
});
