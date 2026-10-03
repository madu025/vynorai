/**
 * One-time copy of an existing SQLite database into PostgreSQL.
 *
 *   DATABASE_URL=postgres://… SQLITE_PATH=data/vynorai.db node dist/scripts/migrateSqliteToPostgres.js
 *
 * Creates the PostgreSQL schema first, copies every table in foreign-key order
 * inside one transaction (all or nothing), skips rows that already exist, and
 * fails if any table ends up with fewer rows than SQLite. Safe to re-run.
 */
import sqlite3 from "sqlite3";
import { closePostgres, getPool } from "../services/pgDriver.js";
import { applyPostgresMigrations } from "../services/postgresSchema.js";

const TABLES = [
  "users",
  "subscriptions",
  "monthly_usage",
  "usage_logs",
  "request_economics",
  "security_audit_logs",
  "email_verifications",
  "admin_staff",
  "model_registry",
  "plan_overrides",
  "user_rules",
  "user_memory",
  "template_vault",
  "provider_credentials",
  "cache_entries",
];

const sqlitePath = process.env.SQLITE_PATH || "data/vynorai.db";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlite = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY);
const all = <T>(sql: string): Promise<T[]> =>
  new Promise((resolve, reject) =>
    sqlite.all(sql, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
  );

async function main() {
  const pool = getPool();
  await applyPostgresMigrations(pool);

  const existing = new Set(
    (
      await all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
    ).map((t) => t.name),
  );

  const client = await pool.connect();
  const report: Record<string, { sqlite: number; postgres: number }> = {};
  try {
    await client.query("BEGIN");
    for (const table of TABLES) {
      if (!existing.has(table)) continue;
      const pgColumns = new Set(
        (
          await client.query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
            [table],
          )
        ).rows.map((r) => r.column_name),
      );
      const rows = await all<Record<string, unknown>>(`SELECT * FROM ${table}`);
      for (const row of rows) {
        // Copy only columns both schemas have (legacy SQLite columns are dropped).
        const columns = Object.keys(row).filter((c) => pgColumns.has(c));
        if (!columns.length) continue;
        await client.query(
          `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})
           ON CONFLICT DO NOTHING`,
          columns.map((c) => row[c]),
        );
      }
      const pgCount = Number(
        (await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n,
      );
      report[table] = { sqlite: rows.length, postgres: pgCount };
      if (pgCount < rows.length) {
        throw new Error(
          `${table}: PostgreSQL has ${pgCount} rows, SQLite has ${rows.length}`,
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.table(report);
  console.log(
    "Migration complete. Set DATABASE_URL on the backend and restart it.",
  );
}

main()
  .catch((err) => {
    console.error(
      "Migration failed; PostgreSQL was left unchanged:",
      err.message,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    sqlite.close();
    await closePostgres();
  });
