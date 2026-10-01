import pg from "pg";
import { dbAll as sqliteAll, dbGet as sqliteGet, dbRun as sqliteRun } from "../db.js";

const { Pool } = pg;
const BILLING_TABLES = ["users", "subscriptions", "monthly_usage", "usage_logs", "request_economics"];
let pool: pg.Pool | null = null;
let ready = false;

export function postgresBillingConfigured(): boolean {
  return process.env.BILLING_DB_MODE === "postgres" && Boolean(process.env.DATABASE_URL);
}

export function billingDbStatus(): { mode: "sqlite" | "postgres"; ready: boolean } {
  return { mode: postgresBillingConfigured() ? "postgres" : "sqlite", ready: postgresBillingConfigured() ? ready : true };
}

function isBillingSql(sql: string): boolean {
  return BILLING_TABLES.some((table) => new RegExp(`\\b${table}\\b`, "i").test(sql));
}

function postgresSql(sql: string): string {
  let index = 0;
  return sql
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO")
    .replace(/date\('now',\s*'-7 days'\)/gi, "CURRENT_DATE - INTERVAL '7 days'")
    .replace(/MAX\(0,\s*([^\)]+)\)/gi, "GREATEST(0, $1)")
    .replace(/\?/g, () => `$${++index}`);
}

async function pgPool(): Promise<pg.Pool> {
  if (!pool) throw new Error("PostgreSQL billing pool is not initialized");
  return pool;
}

async function createSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
      api_key VARCHAR(128) UNIQUE NOT NULL, api_key_hash VARCHAR(64), api_key_masked VARCHAR(32),
      api_key_encrypted TEXT, name VARCHAR(128), is_suspended INTEGER NOT NULL DEFAULT 0,
      allowed_ips TEXT DEFAULT '', email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pg_users_api_key_hash ON users(api_key_hash);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_name VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, order_id VARCHAR(128) UNIQUE NOT NULL,
      payment_id VARCHAR(128), amount_minor INTEGER NOT NULL DEFAULT 0, amount DOUBLE PRECISION,
      currency VARCHAR(10) NOT NULL, valid_until TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pg_subscriptions_user_status ON subscriptions(user_id, status);

    CREATE TABLE IF NOT EXISTS monthly_usage (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_name VARCHAR(64) NOT NULL, max_tokens BIGINT NOT NULL, used_tokens BIGINT NOT NULL DEFAULT 0,
      used_requests BIGINT NOT NULL DEFAULT 0, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      last_reset_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_start)
    );
    CREATE INDEX IF NOT EXISTS idx_pg_monthly_usage_active ON monthly_usage(user_id, period_end);

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model VARCHAR(128) NOT NULL, input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0, tokens_used BIGINT NOT NULL DEFAULT 0,
      cached INTEGER NOT NULL DEFAULT 0, prev_hash TEXT DEFAULT 'GENESIS', audit_hash TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pg_usage_logs_user_created ON usage_logs(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS request_economics (
      id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, usage_log_id TEXT REFERENCES usage_logs(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan_id VARCHAR(64) NOT NULL,
      requested_model VARCHAR(128) NOT NULL, resolved_model VARCHAR(128), provider VARCHAR(32),
      input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
      provider_cost_usd DOUBLE PRECISION, cost_source VARCHAR(20) NOT NULL,
      allocated_revenue_usd DOUBLE PRECISION NOT NULL DEFAULT 0, gross_margin_usd DOUBLE PRECISION,
      cache_status VARCHAR(16) NOT NULL DEFAULT 'bypass', optimization_mode VARCHAR(20) NOT NULL DEFAULT 'safe',
      template_id VARCHAR(128), estimated_tokens_saved BIGINT NOT NULL DEFAULT 0, latency_ms INTEGER,
      outcome VARCHAR(16) NOT NULL DEFAULT 'success', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pg_economics_user_created ON request_economics(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS billing_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, details JSONB
    );
  `);
}

async function backfillTable(client: pg.PoolClient, table: string): Promise<number> {
  const rows = await sqliteAll<Record<string, unknown>>(`SELECT * FROM ${table}`);
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    const quoted = columns.map((column) => `"${column}"`).join(", ");
    const values = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updates = columns.filter((column) => column !== "id")
      .map((column) => `"${column}" = EXCLUDED."${column}"`).join(", ");
    await client.query(
      `INSERT INTO ${table} (${quoted}) VALUES (${values}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
      columns.map((column) => row[column]),
    );
  }
  return rows.length;
}

export async function initBillingDb(): Promise<void> {
  if (!postgresBillingConfigured()) { ready = true; return; }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 20),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ssl: process.env.PG_SSL === "require" ? { rejectUnauthorized: true } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await createSchema(client);
    const migrated = await client.query("SELECT 1 FROM billing_migrations WHERE version = $1", ["001_sqlite_backfill"]);
    if (migrated.rowCount === 0) {
      const counts: Record<string, number> = {};
      for (const table of BILLING_TABLES) counts[table] = await backfillTable(client, table);
      await client.query(
        "INSERT INTO billing_migrations(version, details) VALUES ($1, $2::jsonb)",
        ["001_sqlite_backfill", JSON.stringify(counts)],
      );
    }
    await client.query("COMMIT");
    ready = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    ready = false;
    throw error;
  } finally {
    client.release();
  }
}

export async function billingGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  if (!postgresBillingConfigured() || !isBillingSql(sql)) return sqliteGet<T>(sql, params);
  if (!ready) throw new Error("PostgreSQL billing store is unavailable");
  const result = await (await pgPool()).query(postgresSql(sql), params);
  return result.rows[0] as T | undefined;
}

export async function billingAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (!postgresBillingConfigured() || !isBillingSql(sql)) return sqliteAll<T>(sql, params);
  if (!ready) throw new Error("PostgreSQL billing store is unavailable");
  const result = await (await pgPool()).query(postgresSql(sql), params);
  return result.rows as T[];
}

export async function billingRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  if (!postgresBillingConfigured() || !isBillingSql(sql)) return sqliteRun(sql, params);
  if (!ready) throw new Error("PostgreSQL billing store is unavailable");
  const result = await (await pgPool()).query(postgresSql(sql), params);
  // SQLite remains a rollback mirror. PostgreSQL is authoritative and succeeds first.
  await sqliteRun(sql, params).catch((error) => console.error("[BillingDB] SQLite mirror write failed:", error));
  return { lastID: 0, changes: result.rowCount ?? 0 };
}

export async function billingParity(): Promise<Record<string, { sqlite: number; postgres: number; match: boolean }>> {
  if (!postgresBillingConfigured() || !ready) return {};
  const result: Record<string, { sqlite: number; postgres: number; match: boolean }> = {};
  for (const table of BILLING_TABLES) {
    const sqlite = (await sqliteGet<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`))?.count ?? 0;
    const pgResult = await (await pgPool()).query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    const postgres = Number(pgResult.rows[0]?.count ?? 0);
    result[table] = { sqlite, postgres, match: sqlite === postgres };
  }
  return result;
}
