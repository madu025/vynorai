/**
 * Account deletion must reach every table that stores a user id. A table is covered when its
 * user_id has a foreign key to users with ON DELETE CASCADE, or when POST /delete-account deletes or
 * anonymises its rows by name. Anything else needs a reviewed reason below, so a new table with a
 * user_id column cannot quietly keep a deleted person's identity.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// These tests inspect the SQLite schema, so they stay on SQLite even when DATABASE_URL points at
// PostgreSQL (the PostgreSQL run of the whole suite uses that variable).
process.env.DB_DRIVER = "sqlite";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-delete-coverage-"));
let dbm: typeof import("../src/db.js");
let counter = 0;

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
});

/** Reviewed exceptions: table -> why a deleted person's id may remain. */
const REVIEWED_EXCEPTIONS: Record<string, string> = {
  // Add an entry here only with a reason that matches the privacy policy.
};

function deleteAccountSource(): string {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/routes/auth.ts"),
    "utf8",
  );
  const start = source.indexOf('"/delete-account"');
  assert.ok(start > 0, "the delete-account route exists");
  return source.slice(start, start + 9000);
}

async function tablesWithUserId(): Promise<string[]> {
  const tables = await dbm.dbAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const found: string[] = [];
  for (const { name } of tables) {
    const columns = await dbm.dbAll<{ name: string }>(
      `PRAGMA table_info("${name}")`,
    );
    if (columns.some((column) => column.name === "user_id")) found.push(name);
  }
  return found;
}

test("every table with a user_id is cascaded by foreign key, handled by delete-account, or reviewed", async () => {
  const source = deleteAccountSource();
  const uncovered: string[] = [];
  for (const table of await tablesWithUserId()) {
    const fks = await dbm.dbAll<any>(`PRAGMA foreign_key_list("${table}")`);
    const cascaded = fks.some(
      (fk) =>
        fk.table === "users" &&
        fk.from === "user_id" &&
        String(fk.on_delete).toUpperCase() === "CASCADE",
    );
    const handled = new RegExp(`(DELETE FROM|UPDATE)\\s+${table}\\b`, "i").test(
      source,
    );
    if (!cascaded && !handled && !REVIEWED_EXCEPTIONS[table])
      uncovered.push(table);
  }
  assert.deepEqual(
    uncovered,
    [],
    `these tables keep a deleted user's id: ${uncovered.join(", ")}. Cascade them, delete or anonymise them in /delete-account, or review them in this test.`,
  );
});

test("deleting a user removes the rows that cascade from it", async () => {
  const id = `u-${++counter}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
  );
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount, currency, valid_until)
     VALUES (?, ?, 'pro', 'active', ?, 'ADMIN_MANUAL_GRANT', 0, 'LKR', '2099-01-01T00:00:00.000Z')`,
    [`s-${id}`, id, `o-${id}`],
  );
  await dbm.dbRun(
    "INSERT INTO monthly_usage (id, user_id, plan_name, max_tokens, period_start, period_end) VALUES (?, ?, 'pro', 10, '2026-10-01', '2026-11-01')",
    [`m-${id}`, id],
  );
  await dbm.dbRun(
    "INSERT INTO usage_logs (id, user_id, model) VALUES (?, ?, 'm')",
    [`l-${id}`, id],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id) VALUES ('t-del', ?, ?)",
    [`obj-${id}`, id],
  );
  for (const [table, key] of [
    ["subscriptions", "user_id"],
    ["monthly_usage", "user_id"],
    ["usage_logs", "user_id"],
    ["m365_identity_links", "user_id"],
  ] as const)
    assert.equal(
      (
        await dbm.dbGet<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${key} = ?`,
          [id],
        )
      )?.n,
      1,
      `${table} has the row before deletion`,
    );
  await dbm.dbRun("DELETE FROM users WHERE id = ?", [id]);
  for (const table of [
    "subscriptions",
    "monthly_usage",
    "usage_logs",
    "m365_identity_links",
  ])
    assert.equal(
      (
        await dbm.dbGet<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`,
          [id],
        )
      )?.n,
      0,
      `${table} is empty after deletion`,
    );
});

test("delete-account names the hold, job and usage-ledger tables that have no foreign key", async () => {
  const id = `u-${++counter}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
  );
  await dbm.dbRun(
    "INSERT INTO m365_quota_reservations (id, tenant_id, object_id, user_id, tokens, requests, created_at) VALUES (?, 't', 'o', ?, 1, 1, '2026-10-24T00:00:00Z')",
    [`r-${id}`, id],
  );
  await dbm.dbRun(
    "INSERT INTO quota_reservations (id, user_id, tokens, requests, created_at) VALUES (?, ?, 1, 1, '2026-10-24T00:00:00Z')",
    [`q-${id}`, id],
  );
  const source = deleteAccountSource();
  // The route deletes both hold tables and anonymises the usage ledger by name.
  assert.match(source, /DELETE FROM quota_reservations WHERE user_id/);
  assert.match(source, /DELETE FROM m365_quota_reservations WHERE user_id/);
  assert.match(source, /UPDATE m365_tenant_usage SET user_id/);
  assert.match(source, /DELETE FROM m365_sandbox_jobs WHERE user_id/);
});
