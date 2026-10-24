/**
 * Migration 040 (security hardening) and the migration runner: the guards it adds must hold, it
 * must never block an existing database that has duplicate data, and the runner must not record a
 * migration whose schema change failed.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// These tests inspect the SQLite schema, so they stay on SQLite even when DATABASE_URL points at
// PostgreSQL (the PostgreSQL run of the whole suite uses that variable).
process.env.DB_DRIVER = "sqlite";

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "vynor-migration-safety-"),
);
let dbm: typeof import("../src/db.js");
let counter = 0;

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
});

async function newUser(apiKeyHash?: string): Promise<string> {
  const id = `u-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, apiKeyHash ?? `hash-${id}`],
  );
  return id;
}

async function insertSubscription(
  userId: string,
  paymentId: string | null,
): Promise<void> {
  const id = `s-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount, currency, valid_until)
     VALUES (?, ?, 'pro', 'active', ?, ?, 0, 'LKR', '2099-01-01T00:00:00.000Z')`,
    [id, userId, `o-${id}`, paymentId],
  );
}

async function rejects(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return String((error as Error).message);
  }
  assert.fail("the statement was accepted but must be rejected");
}

test("negative M365 ledger counters, hold amounts and seat limits are rejected by the database", async () => {
  await dbm.dbRun(
    "INSERT INTO m365_tenant_usage (id, tenant_id, object_id, user_id, plan_name, max_tokens, period_start, period_end) VALUES ('ok-1', 't1', 'o1', 'u', 'free', 100, '2026-10-01', '2026-11-01')",
  );
  for (const column of [
    "used_tokens",
    "used_requests",
    "bonus_tokens",
    "bonus_requests",
    "max_tokens",
  ])
    assert.match(
      await rejects(() =>
        dbm.dbRun(
          `UPDATE m365_tenant_usage SET ${column} = -1 WHERE id = 'ok-1'`,
        ),
      ),
      /must not be negative/,
      column,
    );
  assert.match(
    await rejects(() =>
      dbm.dbRun(
        "INSERT INTO m365_tenant_usage (id, tenant_id, object_id, user_id, plan_name, max_tokens, used_tokens, period_start, period_end) VALUES ('bad-1', 't1', 'o1', 'u', 'free', 100, -5, '2026-12-01', '2027-01-01')",
      ),
    ),
    /must not be negative/,
  );
  assert.match(
    await rejects(() =>
      dbm.dbRun(
        "INSERT INTO m365_quota_reservations (id, tenant_id, object_id, user_id, tokens, requests, created_at) VALUES ('r-bad', 't1', 'o1', 'u', -1, 1, '2026-10-24T00:00:00Z')",
      ),
    ),
    /must not be negative/,
  );
  await dbm.dbRun(
    "INSERT INTO m365_quota_reservations (id, tenant_id, object_id, user_id, tokens, requests, created_at) VALUES ('r-ok', 't1', 'o1', 'u', 5, 1, '2026-10-24T00:00:00Z')",
  );
  assert.match(
    await rejects(() =>
      dbm.dbRun(
        "UPDATE m365_quota_reservations SET tokens = -1 WHERE id = 'r-ok'",
      ),
    ),
    /must not be negative/,
  );
  // The application's own refund shape (MAX(0, x - y)) stays legal.
  await dbm.dbRun(
    "UPDATE m365_quota_reservations SET tokens = MAX(0, tokens - 99) WHERE id = 'r-ok'",
  );
  await dbm.dbRun(
    "INSERT INTO m365_tenants (tenant_id, status, allowed_scopes) VALUES ('tenant-seat', 'enabled', 'x')",
  );
  assert.match(
    await rejects(() =>
      dbm.dbRun(
        "UPDATE m365_tenants SET seat_limit = 0 WHERE tenant_id = 'tenant-seat'",
      ),
    ),
    /seat_limit/,
  );
  assert.match(
    await rejects(() =>
      dbm.dbRun(
        "INSERT INTO m365_tenants (tenant_id, status, allowed_scopes, seat_limit) VALUES ('tenant-zero', 'enabled', 'x', 0)",
      ),
    ),
    /seat_limit/,
  );
});

test("an API-key hash can belong to one user only, and a PayHere payment id to one order only", async () => {
  const first = await newUser("shared-hash-1");
  assert.match(await rejects(() => newUser("shared-hash-1")), /UNIQUE/);
  // Real PayHere payment ids are digits: a second order with the same id is a replay.
  await insertSubscription(first, "320032123456");
  assert.match(
    await rejects(() => insertSubscription(first, "320032123456")),
    /UNIQUE/,
  );
  // Fixed labels used by admin grants and test activations stay repeatable.
  await insertSubscription(first, "ADMIN_MANUAL_GRANT");
  await insertSubscription(first, "ADMIN_MANUAL_GRANT");
  await insertSubscription(first, null);
  await insertSubscription(first, null);
});

test("migration 040 is skipped, not fatal, when duplicate data already exists, and applies once it is fixed", async () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    await dbm.dbRun("DROP INDEX IF EXISTS idx_users_api_key_hash_unique");
    await dbm.dbRun("DROP INDEX IF EXISTS idx_subscriptions_payment_id_unique");
    const a = await newUser("dup-hash-A");
    // Legacy duplicates: the index is gone, so these inserts succeed.
    const b = `u-dup-${Math.random().toString(36).slice(2, 8)}`;
    await dbm.dbRun(
      "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, 'dup-hash-A')",
      [b, `${b}@example.com`, `key-${b}`],
    );
    await insertSubscription(a, "999000111");
    await insertSubscription(a, "999000111");

    await dbm.dbRun(
      "DELETE FROM schema_migrations WHERE version = '040_security_hardening'",
    );
    await dbm.initDb(); // must not throw
    const indexes = (
      await dbm.dbAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index'",
      )
    ).map((row) => row.name);
    assert.ok(!indexes.includes("idx_users_api_key_hash_unique"));
    assert.ok(!indexes.includes("idx_subscriptions_payment_id_unique"));
    assert.ok(
      warnings.some((line) =>
        /idx_users_api_key_hash_unique skipped/.test(line),
      ),
    );
    // The warning names the index and a count, never the duplicate values themselves.
    assert.ok(!warnings.join("\n").includes("dup-hash-A"));
    assert.ok(!warnings.join("\n").includes("999000111"));

    await dbm.dbRun("DELETE FROM users WHERE id = ?", [b]);
    await dbm.dbRun("DELETE FROM subscriptions WHERE payment_id = '999000111'");
    await dbm.dbRun(
      "DELETE FROM schema_migrations WHERE version = '040_security_hardening'",
    );
    await dbm.initDb();
    const after = (
      await dbm.dbAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index'",
      )
    ).map((row) => row.name);
    assert.ok(after.includes("idx_users_api_key_hash_unique"));
    assert.ok(after.includes("idx_subscriptions_payment_id_unique"));
  } finally {
    console.warn = warn;
  }
});

test("migration 040 adds the nullable hold-cycle columns and lookup indexes without touching old rows", async () => {
  for (const table of ["quota_reservations", "m365_quota_reservations"]) {
    const columns = await dbm.dbAll<{ name: string; notnull: number }>(
      `PRAGMA table_info(${table})`,
    );
    const column = columns.find((c) => c.name === "period_start");
    assert.ok(column, `${table}.period_start exists`);
    assert.equal(column!.notnull, 0, "nullable, so older code keeps working");
  }
  const indexes = (
    await dbm.dbAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index'",
    )
  ).map((row) => row.name);
  for (const name of [
    "idx_quota_reservations_user",
    "idx_m365_quota_reservations_user",
    "idx_m365_tenant_usage_user",
    "idx_security_audit_actor",
  ])
    assert.ok(indexes.includes(name), name);
});

test("a failed migration step is not recorded as applied (the runner rolls the step back)", async () => {
  // A migration step that fails half way must leave neither its tables nor a schema_migrations row.
  // The runner wraps each step in one transaction; prove the primitive it relies on behaves so.
  await dbm.dbRun("BEGIN IMMEDIATE");
  try {
    await dbm.dbRun("CREATE TABLE IF NOT EXISTS half_done (id TEXT)");
    await dbm.dbRun(
      "INSERT INTO schema_migrations (version) VALUES ('999_half')",
    );
    throw new Error("simulated failure");
  } catch {
    await dbm.dbRun("ROLLBACK");
  }
  const table = await dbm.dbGet(
    "SELECT name FROM sqlite_master WHERE name = 'half_done'",
  );
  const row = await dbm.dbGet(
    "SELECT version FROM schema_migrations WHERE version = '999_half'",
  );
  assert.equal(table, undefined);
  assert.equal(row, undefined);
});

test("the SQLite runner wraps each step in a transaction and only skips 'already there' errors", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/db.ts"),
    "utf8",
  );
  const runner = source.slice(source.indexOf("async function applyMigrations"));
  assert.match(runner, /BEGIN IMMEDIATE[\s\S]*COMMIT[\s\S]*ROLLBACK/);
  // The one migration that opens its own transaction is flagged so it is not nested.
  assert.match(source, /ownTransaction: true/);
  // Neither schema helper may swallow an arbitrary error (a locked or full database).
  assert.doesNotMatch(source, /no such column/);
  const helpers = source.slice(
    source.indexOf("async function execSchema"),
    source.indexOf("interface Migration"),
  );
  assert.match(helpers, /throw err/);
  assert.doesNotMatch(helpers, /catch \(err: any\) \{\s*\/\/[^\n]*\n\s*\}/);
});
