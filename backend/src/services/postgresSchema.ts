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
  user_id TEXT,
  project_id TEXT,
  response_data TEXT NOT NULL,
  response_bytes BIGINT NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_cache_created ON cache_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_user ON cache_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);

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
  {
    version: "pg_002_economics_estimates",
    sql: `
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS estimated_cost_usd DOUBLE PRECISION;
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS credits_charged BIGINT;
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS off_peak SMALLINT NOT NULL DEFAULT 0;
`,
  },
  {
    version: "pg_003_routing_signals",
    sql: `
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS route_tier VARCHAR(16);
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS route_auto SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS prompt_fp VARCHAR(32);
ALTER TABLE request_economics ADD COLUMN IF NOT EXISTS tool_followup SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_request_economics_prompt_fp ON request_economics (user_id, prompt_fp) WHERE prompt_fp IS NOT NULL;
`,
  },
  {
    version: "pg_004_privacy_consent",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version VARCHAR(16);
`,
  },
  {
    version: "pg_005_routing_feedback",
    sql: `
CREATE TABLE IF NOT EXISTS routing_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_fp VARCHAR(32),
  signal VARCHAR(16) NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_routing_feedback_user_fp ON routing_feedback (user_id, prompt_fp);
`,
  },
  {
    version: "pg_006_error_reports",
    sql: `
CREATE TABLE IF NOT EXISTS error_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  source VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  client VARCHAR(64),
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports (created_at);
`,
  },
  {
    version: "pg_007_quota_reservations",
    sql: `
CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tokens BIGINT NOT NULL,
  requests INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota_reservations_created ON quota_reservations (created_at);
`,
  },
  {
    version: "pg_008_background_agents",
    sql: `
ALTER TABLE plan_overrides ADD COLUMN IF NOT EXISTS background_enabled SMALLINT;
ALTER TABLE plan_overrides ADD COLUMN IF NOT EXISTS background_tasks_per_month INTEGER;
ALTER TABLE plan_overrides ADD COLUMN IF NOT EXISTS background_max_concurrency INTEGER;
ALTER TABLE plan_overrides ADD COLUMN IF NOT EXISTS background_priority VARCHAR(16);
ALTER TABLE quota_reservations ADD COLUMN IF NOT EXISTS owner_type VARCHAR(32);
ALTER TABLE quota_reservations ADD COLUMN IF NOT EXISTS owner_id TEXT;

CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL CHECK (status IN ('awaiting_upload','queued','running','cancel_requested','completed','failed','canceled','purged')),
  prompt TEXT,
  language VARCHAR(16) NOT NULL DEFAULT 'en',
  project_fingerprint VARCHAR(64) NOT NULL,
  manifest_digest VARCHAR(64) NOT NULL,
  estimate_credits BIGINT NOT NULL,
  cap_credits BIGINT NOT NULL,
  used_credits BIGINT NOT NULL DEFAULT 0,
  model_credits BIGINT NOT NULL DEFAULT 0,
  compute_credits BIGINT NOT NULL DEFAULT 0,
  refund_credits BIGINT NOT NULL DEFAULT 0,
  quota_reservation_id TEXT,
  quote_id TEXT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_id TEXT,
  heartbeat_at TEXT,
  queued_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  failure_reason VARCHAR(128),
  proof TEXT,
  upload_artifact_id TEXT,
  patch_artifact_id TEXT,
  proof_artifact_id TEXT,
  workspace_deleted_at TEXT,
  deleted_at TEXT,
  purge_after TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_background_tasks_user_created ON background_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_background_tasks_dispatch ON background_tasks(status, priority DESC, queued_at);
CREATE INDEX IF NOT EXISTS idx_background_tasks_heartbeat ON background_tasks(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_background_tasks_purge ON background_tasks(purge_after);

CREATE TABLE IF NOT EXISTS background_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(task_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_background_events_task_sequence ON background_task_events(task_id, sequence);

CREATE TABLE IF NOT EXISTS background_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
  artifact_type VARCHAR(32) NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  bytes BIGINT NOT NULL,
  key_version VARCHAR(32) NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_background_artifacts_expiry ON background_artifacts(expires_at, deleted_at);

CREATE TABLE IF NOT EXISTS background_billing_ledger (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  credits BIGINT NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_background_ledger_task ON background_billing_ledger(task_id, created_at);

CREATE TABLE IF NOT EXISTS background_consent (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version VARCHAR(32) NOT NULL,
  client VARCHAR(64) NOT NULL,
  ip_digest VARCHAR(64) NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY(user_id, policy_version)
);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_digest VARCHAR(64) NOT NULL,
  endpoint_ciphertext TEXT NOT NULL,
  p256dh_ciphertext TEXT NOT NULL,
  auth_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_push_endpoint ON web_push_subscriptions(user_id, endpoint_digest);
`,
  },
  {
    version: "pg_009_password_resets",
    sql: `
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at, used_at);
`,
  },
  {
    version: "pg_010_tenant_cache",
    sql: `
ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS response_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_cache_user ON cache_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);
`,
  },
  {
    version: "pg_011_provider_api_keys",
    sql: `
CREATE TABLE IF NOT EXISTS provider_api_keys (
  id VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  label VARCHAR(128) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(32) NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  balance_usd DOUBLE PRECISION,
  balance_currency VARCHAR(16) DEFAULT 'USD',
  balance_details TEXT,
  last_checked_at TEXT,
  updated_by VARCHAR(128),
  updated_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_api_keys(provider, is_active);
`,
  },
  {
    version: "024_enterprise_zk_compliance_ledger",
    sql: `
CREATE TABLE IF NOT EXISTS zk_compliance_audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_surrogate_id VARCHAR(64) NOT NULL,
  request_type VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  diff_fingerprint VARCHAR(64),
  prompt_fingerprint VARCHAR(64),
  files_count INTEGER DEFAULT 0,
  lines_added INTEGER DEFAULT 0,
  lines_deleted INTEGER DEFAULT 0,
  zero_retention_verified INTEGER DEFAULT 1,
  merkle_prev_hash VARCHAR(64) NOT NULL,
  merkle_hash VARCHAR(64) NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_zk_audit_surrogate ON zk_compliance_audit_logs(user_surrogate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zk_audit_diff_hash ON zk_compliance_audit_logs(diff_fingerprint);
`,
  },
  {
    // The ledger is a hash chain, so its order is part of its meaning. SQLite
    // orders by rowid; PostgreSQL has no rowid, so rows get an explicit
    // insertion sequence (existing rows are numbered in storage order).
    version: "025_zk_audit_sequence",
    sql: `
ALTER TABLE zk_compliance_audit_logs ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
CREATE INDEX IF NOT EXISTS idx_zk_audit_seq ON zk_compliance_audit_logs(seq);
`,
  },
  {
    version: "026_task_outcomes",
    sql: `
CREATE TABLE IF NOT EXISTS task_outcomes (
  id VARCHAR(36) PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  outcome VARCHAR(24) NOT NULL,
  mode VARCHAR(16),
  rounds INTEGER,
  credits INTEGER,
  edited SMALLINT NOT NULL DEFAULT 0,
  verified SMALLINT NOT NULL DEFAULT 0,
  client VARCHAR(64),
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_task_outcomes_created ON task_outcomes (created_at);
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
