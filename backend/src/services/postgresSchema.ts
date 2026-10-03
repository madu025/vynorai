import type pg from "pg";
import { PG_NOW_TEXT } from "./pgDriver.js";

/**
 * PostgreSQL schema, matching the final state of the SQLite migrations in
 * db.ts (001-014). Date/time columns are TEXT in SQLite's UTC
 * "YYYY-MM-DD HH:MM:SS" format so string comparisons and parsing behave the
 * same on both engines. Add new changes as new versions; never edit applied ones.
 */

const NOW = `(${PG_NOW_TEXT})`;
const SUBSCRIPTION_STATUSES =
  "'pending', 'active', 'cancelled', 'expired', 'failed', 'credited', 'superseded', 'chargedback'";

interface PgMigration {
  version: string;
  sql: string;
}

const PG_MIGRATIONS: PgMigration[] = [
  {
    version: "pg_001_initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  api_key VARCHAR(128) UNIQUE NOT NULL,
  api_key_hash VARCHAR(64),
  api_key_masked VARCHAR(32),
  api_key_encrypted TEXT,
  name VARCHAR(128),
  is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1)),
  allowed_ips TEXT DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN (${SUBSCRIPTION_STATUSES})),
  order_id VARCHAR(128) UNIQUE NOT NULL,
  payment_id VARCHAR(128),
  amount_minor INTEGER NOT NULL DEFAULT 0,
  amount DOUBLE PRECISION,
  currency VARCHAR(10) NOT NULL CHECK (currency IN ('LKR', 'USD', 'EUR', 'GBP')),
  valid_until TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS monthly_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name VARCHAR(64) NOT NULL,
  max_tokens BIGINT NOT NULL,
  used_tokens BIGINT NOT NULL DEFAULT 0,
  used_requests BIGINT NOT NULL DEFAULT 0,
  bonus_tokens BIGINT NOT NULL DEFAULT 0,
  bonus_requests BIGINT NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  last_reset_at TEXT DEFAULT ${NOW},
  updated_at TEXT DEFAULT ${NOW},
  UNIQUE (user_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_period_end ON monthly_usage(period_end);

CREATE OR REPLACE FUNCTION vynor_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := ${PG_NOW_TEXT};
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_monthly_usage_updated_at ON monthly_usage;
CREATE TRIGGER trg_monthly_usage_updated_at BEFORE UPDATE ON monthly_usage
  FOR EACH ROW EXECUTE FUNCTION vynor_touch_updated_at();

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model VARCHAR(128) NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
  prev_hash TEXT DEFAULT 'GENESIS',
  audit_hash TEXT DEFAULT '',
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_model_created ON usage_logs(user_id, model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS request_economics (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  usage_log_id TEXT REFERENCES usage_logs(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR(64) NOT NULL,
  requested_model VARCHAR(128) NOT NULL,
  resolved_model VARCHAR(128),
  provider VARCHAR(32),
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cached_input_tokens BIGINT NOT NULL DEFAULT 0,
  provider_cost_usd DOUBLE PRECISION,
  cost_source VARCHAR(20) NOT NULL CHECK (cost_source IN ('provider', 'local-zero', 'unknown')),
  allocated_revenue_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  gross_margin_usd DOUBLE PRECISION,
  cache_status VARCHAR(16) NOT NULL DEFAULT 'bypass' CHECK (cache_status IN ('hit', 'miss', 'bypass')),
  optimization_mode VARCHAR(20) NOT NULL DEFAULT 'safe',
  template_id VARCHAR(128),
  estimated_tokens_saved BIGINT NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  outcome VARCHAR(16) NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failed')),
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_request_economics_user_created ON request_economics(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_economics_provider_created ON request_economics(provider, created_at DESC);

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id TEXT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
  actor VARCHAR(128),
  target VARCHAR(128),
  details TEXT,
  ip_address VARCHAR(45),
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_target ON security_audit_logs(target);

CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  otp_code VARCHAR(10) DEFAULT '',
  token VARCHAR(128) DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at);

CREATE TABLE IF NOT EXISTS admin_staff (
  id TEXT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'support')),
  created_by VARCHAR(128),
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  openrouter_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 32000,
  min_plan TEXT NOT NULL DEFAULT 'free',
  is_default_chat INTEGER DEFAULT 0,
  is_default_autocomplete INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT ${NOW},
  updated_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS plan_overrides (
  plan_id TEXT PRIMARY KEY,
  display_name TEXT,
  monthly_tokens BIGINT,
  monthly_requests BIGINT,
  price_lkr DOUBLE PRECISION,
  price_usd DOUBLE PRECISION,
  discount_pct INTEGER DEFAULT 0,
  context_window INTEGER,
  default_chat_model TEXT,
  default_autocomplete_model TEXT,
  allowed_models TEXT,
  features TEXT,
  payhere_item_id TEXT,
  upgrade_url TEXT,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key TEXT PRIMARY KEY,
  response_data TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_cache_created ON cache_entries(created_at);

CREATE TABLE IF NOT EXISTS user_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'global',
  rule TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS user_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT DEFAULT ${NOW},
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS template_vault (
  id VARCHAR(128) PRIMARY KEY,
  version VARCHAR(32) NOT NULL,
  category VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  languages TEXT NOT NULL,
  keywords TEXT NOT NULL,
  dependencies TEXT NOT NULL,
  required_env TEXT NOT NULL,
  security_level VARCHAR(32) NOT NULL,
  code TEXT NOT NULL,
  usage_snippet TEXT NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  auto_correction_count INTEGER NOT NULL DEFAULT 0,
  last_corrected_at TEXT,
  created_at TEXT DEFAULT ${NOW},
  updated_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  provider VARCHAR(32) PRIMARY KEY,
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(32) NOT NULL,
  updated_by VARCHAR(128),
  updated_at TEXT DEFAULT ${NOW}
);
`,
  },
];

/** Applies pending PostgreSQL migrations, each in its own transaction. */
export async function applyPostgresMigrations(
  pool: pg.Pool,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // One backend instance migrates at a time.
    await client.query("SELECT pg_advisory_lock(727151)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TEXT DEFAULT ${NOW}
    )`);
    const done = new Set(
      (
        await client.query<{ version: string }>(
          "SELECT version FROM schema_migrations",
        )
      ).rows.map((r) => r.version),
    );
    for (const migration of PG_MIGRATIONS) {
      if (done.has(migration.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [migration.version],
        );
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727151)").catch(() => {});
    client.release();
  }
  return applied;
}
