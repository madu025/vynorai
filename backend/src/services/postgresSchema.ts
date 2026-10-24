import type pg from "pg";

/**
 * PostgreSQL schema (production). This is the typed baseline: timestamps are TIMESTAMPTZ, money is
 * NUMERIC, ids are a constrained domain, enums/counters/hashes carry CHECK constraints and the
 * foreign keys cascade. SQLite (local development and most tests) keeps its own text-based schema
 * in db.ts; both engines are held in step by test/schemaParity.test.ts and the application sees the
 * same values on both (pgDriver.ts returns timestamptz as ISO-8601 strings).
 *
 * A database created by the earlier text-timestamp ladder (pg_001 ... 041) is never upgraded in
 * place: applyPostgresMigrations() refuses to start on it. Build a new database with this baseline
 * and move the few rows worth keeping with scripts/carryOver.ts (docs/DB_CUTOVER_RUNBOOK.md).
 * Add later changes as new entries after the baseline; never edit an applied one.
 */

export const PG_BASELINE_VERSION = "pg_baseline_2026_10_typed";

/** Versions written by the retired text-timestamp ladder. Seeing one means a legacy database. */
export const LEGACY_PG_VERSIONS: readonly string[] = [
  "pg_001_initial_schema",
  "pg_002_economics_estimates",
  "pg_003_routing_signals",
  "pg_004_privacy_consent",
  "pg_005_routing_feedback",
  "pg_006_error_reports",
  "pg_007_quota_reservations",
  "pg_008_background_agents",
  "pg_009_password_resets",
  "pg_010_tenant_cache",
  "pg_011_provider_api_keys",
  "024_enterprise_zk_compliance_ledger",
  "025_zk_audit_sequence",
  "026_task_outcomes",
  "027_task_outcome_reason",
  "028_scope_preflight_observability",
  "029_scope_outcome_evidence",
  "030_cloud_delivery_manifests",
  "031_cloud_artifact_attestation",
  "032_m365_identity_links",
  "033_m365_tenant_registry",
  "034_m365_approval_replay_guard",
  "035_m365_apply_result_receipt",
  "036_m365_tenant_ai_policy",
  "037_m365_sandbox_jobs",
  "038_m365_tenant_entitlements",
  "039_m365_tenant_quota_ledger",
  "040_security_hardening",
  "041_monthly_usage_conflict_target",
];

/** The newest SQLite migration whose effect is already part of the typed baseline. */
export const PG_BASELINE_COVERS_SQLITE_THROUGH =
  "041_monthly_usage_conflict_target";

export interface PgMigration {
  version: string;
  sql: string;
}

const BASELINE_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vynor_id') THEN
    -- Application-minted identifiers (user, task, row ids): short, URL-safe, never free text.
    CREATE DOMAIN vynor_id AS VARCHAR(128) CHECK (VALUE ~ '^[A-Za-z0-9_.:-]{1,128}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vynor_touch_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS admin_staff (
  id vynor_id NOT NULL,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(32) DEFAULT 'admin' NOT NULL,
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT admin_staff_role_check CHECK (role IN ('super_admin', 'admin', 'support')),
  PRIMARY KEY (id),
  UNIQUE (email)
);
CREATE TABLE IF NOT EXISTS users (
  id vynor_id NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  api_key VARCHAR(128) NOT NULL,
  api_key_hash VARCHAR(64),
  api_key_masked VARCHAR(32),
  api_key_encrypted TEXT,
  name VARCHAR(128),
  is_suspended INTEGER DEFAULT 0 NOT NULL,
  allowed_ips TEXT DEFAULT '',
  email_verified INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  privacy_accepted_at TIMESTAMPTZ,
  privacy_version VARCHAR(16),
  CONSTRAINT users_email_verified_check CHECK (email_verified IN (0, 1)),
  CONSTRAINT users_is_suspended_check CHECK (is_suspended IN (0, 1)),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  PRIMARY KEY (id),
  UNIQUE (api_key),
  UNIQUE (email)
);
CREATE TABLE IF NOT EXISTS background_tasks (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  status VARCHAR(32) NOT NULL,
  prompt TEXT,
  language VARCHAR(16) DEFAULT 'en' NOT NULL,
  project_fingerprint VARCHAR(64) NOT NULL,
  manifest_digest VARCHAR(64) NOT NULL,
  estimate_credits BIGINT NOT NULL,
  cap_credits BIGINT NOT NULL,
  used_credits BIGINT DEFAULT 0 NOT NULL,
  model_credits BIGINT DEFAULT 0 NOT NULL,
  compute_credits BIGINT DEFAULT 0 NOT NULL,
  refund_credits BIGINT DEFAULT 0 NOT NULL,
  quota_reservation_id VARCHAR(128),
  quote_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  priority SMALLINT DEFAULT 0 NOT NULL,
  worker_id VARCHAR(160),
  lease_id VARCHAR(200),
  heartbeat_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  failure_reason VARCHAR(128),
  proof TEXT,
  upload_artifact_id VARCHAR(128),
  patch_artifact_id VARCHAR(128),
  proof_artifact_id VARCHAR(128),
  workspace_deleted_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  purge_after TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT background_tasks_status_check CHECK (status IN ('awaiting_upload', 'queued', 'running', 'cancel_requested', 'completed', 'failed', 'canceled', 'purged')),
  CONSTRAINT background_tasks_estimate_credits_nonneg CHECK (estimate_credits >= 0),
  CONSTRAINT background_tasks_cap_credits_nonneg CHECK (cap_credits >= 0),
  CONSTRAINT background_tasks_used_credits_nonneg CHECK (used_credits >= 0),
  CONSTRAINT background_tasks_model_credits_nonneg CHECK (model_credits >= 0),
  CONSTRAINT background_tasks_compute_credits_nonneg CHECK (compute_credits >= 0),
  CONSTRAINT background_tasks_refund_credits_nonneg CHECK (refund_credits >= 0),
  PRIMARY KEY (id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS background_artifacts (
  id vynor_id NOT NULL,
  task_id vynor_id NOT NULL,
  artifact_type VARCHAR(32) NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  bytes BIGINT NOT NULL,
  key_version VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT background_artifacts_bytes_nonneg CHECK (bytes >= 0),
  PRIMARY KEY (id),
  FOREIGN KEY (task_id) REFERENCES background_tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS background_billing_ledger (
  id vynor_id NOT NULL,
  task_id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  credits BIGINT NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  metadata TEXT DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (idempotency_key)
);
CREATE TABLE IF NOT EXISTS background_consent (
  user_id vynor_id NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  client VARCHAR(64) NOT NULL,
  ip_digest VARCHAR(64) NOT NULL,
  accepted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, policy_version),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS background_task_events (
  id vynor_id NOT NULL,
  task_id vynor_id NOT NULL,
  sequence BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  data TEXT DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (task_id, sequence),
  FOREIGN KEY (task_id) REFERENCES background_tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key VARCHAR(256) NOT NULL,
  user_id vynor_id,
  project_id VARCHAR(128),
  response_data TEXT NOT NULL,
  response_bytes BIGINT DEFAULT 0 NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT cache_entries_response_bytes_nonneg CHECK (response_bytes >= 0),
  PRIMARY KEY (cache_key)
);
CREATE TABLE IF NOT EXISTS cloud_delivery_manifests (
  run_id VARCHAR(36) NOT NULL,
  task_id VARCHAR(256) NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  repository_owner VARCHAR(100) NOT NULL,
  repository_name VARCHAR(100) NOT NULL,
  base_branch VARCHAR(191) NOT NULL,
  head_branch VARCHAR(191) NOT NULL,
  base_sha VARCHAR(64) NOT NULL,
  head_sha VARCHAR(64) NOT NULL,
  rollback_sha VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  state VARCHAR(32) NOT NULL,
  verification_digest VARCHAR(64) NOT NULL,
  capability_digest VARCHAR(64) NOT NULL,
  approval_actor VARCHAR(160),
  approval_scope VARCHAR(500),
  approval_at TIMESTAMPTZ,
  approval_receipt_digest VARCHAR(64),
  artifact_digest VARCHAR(64),
  artifact_attestation_digest VARCHAR(64),
  deployment_target VARCHAR(128),
  health_digest VARCHAR(64),
  transitions TEXT DEFAULT '[]' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (run_id)
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  otp_code VARCHAR(10) DEFAULT '',
  token VARCHAR(128) DEFAULT '',
  attempts INTEGER DEFAULT 0 NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT email_verifications_attempts_check CHECK (((attempts >= 0) AND (attempts <= 5))),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS error_reports (
  id vynor_id NOT NULL,
  user_id vynor_id,
  source VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  client VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS m365_approval_uses (
  jti VARCHAR(128) NOT NULL,
  plan_id VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  consumed_at TIMESTAMPTZ DEFAULT now(),
  result_reported_at TIMESTAMPTZ,
  result_status VARCHAR(32),
  source_unchanged SMALLINT,
  action_count INTEGER DEFAULT 0 NOT NULL,
  failure_count INTEGER DEFAULT 0 NOT NULL,
  CONSTRAINT m365_approval_uses_source_unchanged_check CHECK (source_unchanged IN (0, 1)),
  PRIMARY KEY (jti)
);
CREATE TABLE IF NOT EXISTS m365_identity_links (
  tenant_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  user_id vynor_id NOT NULL,
  enabled SMALLINT DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT m365_identity_links_enabled_check CHECK (enabled IN (0, 1)),
  PRIMARY KEY (tenant_id, object_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS m365_quota_reservations (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  user_id vynor_id NOT NULL,
  tokens BIGINT NOT NULL,
  requests INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  period_start DATE,
  CONSTRAINT chk_m365_quota_reservations_nonneg CHECK (((tokens >= 0) AND (requests >= 0))),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS m365_sandbox_jobs (
  job_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  user_id vynor_id NOT NULL,
  state VARCHAR(24) NOT NULL,
  input_fingerprint VARCHAR(64) NOT NULL,
  row_count INTEGER NOT NULL,
  column_count INTEGER NOT NULL,
  masked_cells INTEGER DEFAULT 0 NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  error_code VARCHAR(40),
  result_json TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  CONSTRAINT m365_sandbox_jobs_state_check CHECK (state IN ('queued', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed', 'expired')),
  PRIMARY KEY (job_id)
);
CREATE TABLE IF NOT EXISTS m365_tenant_usage (
  id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  user_id vynor_id NOT NULL,
  plan_name VARCHAR(64) NOT NULL,
  plan_source VARCHAR(16) DEFAULT 'free' NOT NULL,
  max_tokens BIGINT NOT NULL,
  used_tokens BIGINT DEFAULT 0 NOT NULL,
  used_requests BIGINT DEFAULT 0 NOT NULL,
  bonus_tokens BIGINT DEFAULT 0 NOT NULL,
  bonus_requests BIGINT DEFAULT 0 NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT chk_m365_tenant_usage_nonneg CHECK (((max_tokens >= 0) AND (used_tokens >= 0) AND (used_requests >= 0) AND (bonus_tokens >= 0) AND (bonus_requests >= 0))),
  CONSTRAINT m365_tenant_usage_period_order CHECK (period_end >= period_start),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, object_id, period_start)
);
CREATE TABLE IF NOT EXISTS m365_tenants (
  tenant_id VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  display_name VARCHAR(256),
  allowed_scopes VARCHAR(512) NOT NULL,
  consented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ai_enabled SMALLINT DEFAULT 1 NOT NULL,
  plan_id VARCHAR(64),
  seat_limit INTEGER DEFAULT 1 NOT NULL,
  subscription_valid_until TIMESTAMPTZ,
  CONSTRAINT chk_m365_tenants_seat_limit CHECK ((seat_limit >= 1)),
  CONSTRAINT m365_tenants_status_check CHECK (status IN ('enabled', 'disabled')),
  CONSTRAINT m365_tenants_ai_enabled_flag CHECK (ai_enabled IN (0, 1)),
  PRIMARY KEY (tenant_id)
);
CREATE TABLE IF NOT EXISTS model_registry (
  id VARCHAR(200) NOT NULL,
  openrouter_id VARCHAR(200) NOT NULL,
  display_name VARCHAR(256) NOT NULL,
  context_window INTEGER DEFAULT 32000 NOT NULL,
  min_plan VARCHAR(64) DEFAULT 'free' NOT NULL,
  is_default_chat INTEGER DEFAULT 0,
  is_default_autocomplete INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT model_registry_is_default_chat_flag CHECK (is_default_chat IN (0, 1)),
  CONSTRAINT model_registry_is_default_autocomplete_flag CHECK (is_default_autocomplete IN (0, 1)),
  CONSTRAINT model_registry_enabled_flag CHECK (enabled IN (0, 1)),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS monthly_usage (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  plan_name VARCHAR(64) NOT NULL,
  max_tokens BIGINT NOT NULL,
  used_tokens BIGINT DEFAULT 0 NOT NULL,
  used_requests BIGINT DEFAULT 0 NOT NULL,
  bonus_tokens BIGINT DEFAULT 0 NOT NULL,
  bonus_requests BIGINT DEFAULT 0 NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  last_reset_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT monthly_usage_max_tokens_nonneg CHECK (max_tokens >= 0),
  CONSTRAINT monthly_usage_used_tokens_nonneg CHECK (used_tokens >= 0),
  CONSTRAINT monthly_usage_used_requests_nonneg CHECK (used_requests >= 0),
  CONSTRAINT monthly_usage_bonus_tokens_nonneg CHECK (bonus_tokens >= 0),
  CONSTRAINT monthly_usage_bonus_requests_nonneg CHECK (bonus_requests >= 0),
  CONSTRAINT monthly_usage_period_order CHECK (period_end >= period_start),
  PRIMARY KEY (id),
  UNIQUE (user_id, period_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (token_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plan_overrides (
  plan_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(128),
  monthly_tokens BIGINT,
  monthly_requests BIGINT,
  price_lkr NUMERIC(14,2),
  price_usd NUMERIC(14,2),
  discount_pct INTEGER DEFAULT 0,
  context_window INTEGER,
  default_chat_model VARCHAR(200),
  default_autocomplete_model VARCHAR(200),
  allowed_models TEXT,
  features TEXT,
  payhere_item_id VARCHAR(128),
  upgrade_url VARCHAR(2048),
  is_active INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  background_enabled SMALLINT,
  background_tasks_per_month INTEGER,
  background_max_concurrency INTEGER,
  background_priority VARCHAR(16),
  CONSTRAINT plan_overrides_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT plan_overrides_background_enabled_flag CHECK (background_enabled IN (0, 1)),
  PRIMARY KEY (plan_id)
);
CREATE TABLE IF NOT EXISTS provider_api_keys (
  id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  label VARCHAR(128) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(32) NOT NULL,
  is_active SMALLINT DEFAULT 1 NOT NULL,
  balance_usd NUMERIC(18,6),
  balance_currency VARCHAR(16) DEFAULT 'USD',
  balance_details TEXT,
  last_checked_at TIMESTAMPTZ,
  updated_by VARCHAR(128),
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT provider_api_keys_is_active_flag CHECK (is_active IN (0, 1)),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS provider_credentials (
  provider VARCHAR(32) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_masked VARCHAR(32) NOT NULL,
  updated_by VARCHAR(128),
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (provider)
);
CREATE TABLE IF NOT EXISTS quota_reservations (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  tokens BIGINT NOT NULL,
  requests INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  owner_type VARCHAR(32),
  owner_id VARCHAR(128),
  period_start DATE,
  CONSTRAINT quota_reservations_tokens_nonneg CHECK (tokens >= 0),
  CONSTRAINT quota_reservations_requests_nonneg CHECK (requests >= 0),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS usage_logs (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  model VARCHAR(128) NOT NULL,
  input_tokens BIGINT DEFAULT 0 NOT NULL,
  output_tokens BIGINT DEFAULT 0 NOT NULL,
  tokens_used BIGINT DEFAULT 0 NOT NULL,
  cached INTEGER DEFAULT 0 NOT NULL,
  prev_hash TEXT DEFAULT 'GENESIS',
  audit_hash TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT usage_logs_cached_check CHECK (cached IN (0, 1)),
  CONSTRAINT usage_logs_input_tokens_nonneg CHECK (input_tokens >= 0),
  CONSTRAINT usage_logs_output_tokens_nonneg CHECK (output_tokens >= 0),
  CONSTRAINT usage_logs_tokens_used_nonneg CHECK (tokens_used >= 0),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS request_economics (
  id vynor_id NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  usage_log_id vynor_id,
  user_id vynor_id NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  requested_model VARCHAR(128) NOT NULL,
  resolved_model VARCHAR(128),
  provider VARCHAR(32),
  input_tokens BIGINT DEFAULT 0 NOT NULL,
  output_tokens BIGINT DEFAULT 0 NOT NULL,
  cached_input_tokens BIGINT DEFAULT 0 NOT NULL,
  provider_cost_usd NUMERIC(18,8),
  cost_source VARCHAR(20) NOT NULL,
  allocated_revenue_usd NUMERIC(18,8) DEFAULT 0 NOT NULL,
  gross_margin_usd NUMERIC(18,8),
  cache_status VARCHAR(16) DEFAULT 'bypass' NOT NULL,
  optimization_mode VARCHAR(20) DEFAULT 'safe' NOT NULL,
  template_id VARCHAR(128),
  estimated_tokens_saved BIGINT DEFAULT 0 NOT NULL,
  latency_ms INTEGER,
  outcome VARCHAR(16) DEFAULT 'success' NOT NULL,
  request_kind VARCHAR(32) DEFAULT 'chat' NOT NULL,
  cache_policy VARCHAR(16) DEFAULT 'standard' NOT NULL,
  cache_bypass_reason VARCHAR(64),
  task_scope VARCHAR(16),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  estimated_cost_usd NUMERIC(18,8),
  credits_charged BIGINT,
  off_peak SMALLINT DEFAULT 0 NOT NULL,
  route_tier VARCHAR(16),
  route_auto SMALLINT DEFAULT 0 NOT NULL,
  prompt_fp VARCHAR(32),
  tool_followup SMALLINT DEFAULT 0 NOT NULL,
  CONSTRAINT request_economics_cache_status_check CHECK (cache_status IN ('hit', 'miss', 'bypass')),
  CONSTRAINT request_economics_cost_source_check CHECK (cost_source IN ('provider', 'local-zero', 'unknown')),
  CONSTRAINT request_economics_outcome_check CHECK (outcome IN ('success', 'failed')),
  CONSTRAINT request_economics_input_tokens_nonneg CHECK (input_tokens >= 0),
  CONSTRAINT request_economics_output_tokens_nonneg CHECK (output_tokens >= 0),
  CONSTRAINT request_economics_cached_input_tokens_nonneg CHECK (cached_input_tokens >= 0),
  CONSTRAINT request_economics_estimated_tokens_saved_nonneg CHECK (estimated_tokens_saved >= 0),
  CONSTRAINT request_economics_off_peak_flag CHECK (off_peak IN (0, 1)),
  CONSTRAINT request_economics_route_auto_flag CHECK (route_auto IN (0, 1)),
  CONSTRAINT request_economics_tool_followup_flag CHECK (tool_followup IN (0, 1)),
  PRIMARY KEY (id),
  UNIQUE (request_id),
  FOREIGN KEY (usage_log_id) REFERENCES usage_logs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS routing_feedback (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  prompt_fp VARCHAR(32),
  signal VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS security_audit_logs (
  id vynor_id NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(10) DEFAULT 'INFO' NOT NULL,
  actor VARCHAR(128),
  target VARCHAR(128),
  details TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT security_audit_logs_severity_check CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  plan_name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  order_id VARCHAR(128) NOT NULL,
  payment_id VARCHAR(128),
  amount_minor INTEGER DEFAULT 0 NOT NULL,
  amount NUMERIC(14,2),
  currency VARCHAR(10) NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT subscriptions_currency_check CHECK (currency IN ('LKR', 'USD', 'EUR', 'GBP')),
  CONSTRAINT subscriptions_status_check CHECK (status IN ('pending', 'active', 'cancelled', 'expired', 'failed', 'credited', 'superseded', 'chargedback')),
  CONSTRAINT subscriptions_amount_minor_nonneg CHECK (amount_minor >= 0),
  PRIMARY KEY (id),
  UNIQUE (order_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_outcomes (
  id VARCHAR(36) NOT NULL,
  user_id vynor_id,
  outcome VARCHAR(24) NOT NULL,
  mode VARCHAR(16),
  rounds INTEGER,
  credits INTEGER,
  edited SMALLINT DEFAULT 0 NOT NULL,
  verified SMALLINT DEFAULT 0 NOT NULL,
  scope VARCHAR(16),
  client VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  reason VARCHAR(24),
  repairs INTEGER,
  gates INTEGER,
  CONSTRAINT task_outcomes_edited_flag CHECK (edited IN (0, 1)),
  CONSTRAINT task_outcomes_verified_flag CHECK (verified IN (0, 1)),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS template_vault (
  id VARCHAR(128) NOT NULL,
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
  usage_count INTEGER DEFAULT 0 NOT NULL,
  auto_correction_count INTEGER DEFAULT 0 NOT NULL,
  last_corrected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS user_memory (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  key VARCHAR(128) NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_rules (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  scope VARCHAR(32) DEFAULT 'global' NOT NULL,
  rule TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT user_rules_enabled_flag CHECK (enabled IN (0, 1)),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id vynor_id NOT NULL,
  user_id vynor_id NOT NULL,
  endpoint_digest VARCHAR(64) NOT NULL,
  endpoint_ciphertext TEXT NOT NULL,
  p256dh_ciphertext TEXT NOT NULL,
  auth_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS zk_compliance_audit_logs (
  id VARCHAR(64) NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  seq BIGSERIAL NOT NULL,
  CONSTRAINT zk_compliance_audit_logs_zero_retention_verified_flag CHECK (zero_retention_verified IN (0, 1)),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_background_artifacts_expiry ON background_artifacts(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_background_events_task_sequence ON background_task_events(task_id, sequence);
CREATE INDEX IF NOT EXISTS idx_background_ledger_task ON background_billing_ledger(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_background_tasks_dispatch ON background_tasks(status, priority DESC, queued_at);
CREATE INDEX IF NOT EXISTS idx_background_tasks_heartbeat ON background_tasks(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_background_tasks_purge ON background_tasks(purge_after);
CREATE INDEX IF NOT EXISTS idx_background_tasks_user_created ON background_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cache_created ON cache_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_user ON cache_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_delivery_repository ON cloud_delivery_manifests(repository_owner, repository_name, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_delivery_state_updated ON cloud_delivery_manifests(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_m365_approval_expiry ON m365_approval_uses(expires_at_ms);
CREATE INDEX IF NOT EXISTS idx_m365_identity_user ON m365_identity_links(user_id);
CREATE INDEX IF NOT EXISTS idx_m365_quota_reservations_created ON m365_quota_reservations(created_at);
CREATE INDEX IF NOT EXISTS idx_m365_quota_reservations_user ON m365_quota_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_m365_sandbox_owner ON m365_sandbox_jobs(tenant_id, object_id, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_m365_sandbox_state ON m365_sandbox_jobs(state, expires_at_ms);
CREATE INDEX IF NOT EXISTS idx_m365_sandbox_user ON m365_sandbox_jobs(user_id, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_m365_tenant_status ON m365_tenants(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_m365_tenant_usage_period ON m365_tenant_usage(tenant_id, object_id, period_end);
CREATE INDEX IF NOT EXISTS idx_m365_tenant_usage_user ON m365_tenant_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_period_end ON monthly_usage(period_end);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_api_keys(provider, is_active);
CREATE INDEX IF NOT EXISTS idx_quota_reservations_created ON quota_reservations(created_at);
CREATE INDEX IF NOT EXISTS idx_quota_reservations_user ON quota_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_request_economics_kind_created ON request_economics(request_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_economics_prompt_fp ON request_economics(user_id, prompt_fp) WHERE (prompt_fp IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_request_economics_provider_created ON request_economics(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_economics_scope_created ON request_economics(task_scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_economics_user_created ON request_economics(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_feedback_user_fp ON routing_feedback(user_id, prompt_fp);
CREATE INDEX IF NOT EXISTS idx_security_audit_actor ON security_audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_target ON security_audit_logs(target);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_task_outcomes_created ON task_outcomes(created_at);
CREATE INDEX IF NOT EXISTS idx_task_outcomes_scope_created ON task_outcomes(scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_model_created ON usage_logs(user_id, model, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_push_endpoint ON web_push_subscriptions(user_id, endpoint_digest);
CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_zk_audit_diff_hash ON zk_compliance_audit_logs(diff_fingerprint);
CREATE INDEX IF NOT EXISTS idx_zk_audit_seq ON zk_compliance_audit_logs(seq);
CREATE INDEX IF NOT EXISTS idx_zk_audit_surrogate ON zk_compliance_audit_logs(user_surrogate_id, created_at DESC);

-- Uniqueness the application relies on (API-key lookups and one order per PayHere payment).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash_unique ON users(api_key_hash) WHERE api_key_hash IS NOT NULL AND api_key_hash <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_payment_id_unique ON subscriptions(payment_id) WHERE payment_id ~ '^[0-9]+$';

DROP TRIGGER IF EXISTS trg_monthly_usage_updated_at ON monthly_usage;
CREATE TRIGGER trg_monthly_usage_updated_at BEFORE UPDATE ON monthly_usage
  FOR EACH ROW EXECUTE FUNCTION vynor_touch_updated_at();
`;

export const PG_MIGRATIONS: PgMigration[] = [
  { version: PG_BASELINE_VERSION, sql: BASELINE_SQL },
];

/** Thrown when the connected database was built by the retired text-timestamp schema. */
export class LegacyPostgresSchemaError extends Error {
  readonly code = "PG_LEGACY_SCHEMA";
  constructor(detail: string) {
    super(
      `Legacy PostgreSQL schema detected (${detail}). The backend will not start on it and will not ` +
        "modify it. Create a new database (the typed baseline is applied automatically on an empty " +
        "one), move the rows you need with backend/scripts/carryOver.ts, then point DATABASE_URL at the " +
        "new database. See docs/DB_CUTOVER_RUNBOOK.md.",
    );
    this.name = "LegacyPostgresSchemaError";
  }
}

/** Throws when the database holds application tables that are not from the typed baseline. */
async function assertNotLegacy(client: pg.PoolClient): Promise<void> {
  const reg = await client.query<{
    migrations: string | null;
    users: string | null;
  }>(
    "SELECT to_regclass('public.schema_migrations') AS migrations, to_regclass('public.users') AS users",
  );
  const { migrations, users } = reg.rows[0];
  if (migrations) {
    const versions = (
      await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations",
      )
    ).rows.map((r) => r.version);
    if (versions.includes(PG_BASELINE_VERSION)) return;
    if (versions.some((v) => LEGACY_PG_VERSIONS.includes(v)))
      throw new LegacyPostgresSchemaError(
        "schema_migrations lists the retired migration ladder",
      );
  }
  if (users)
    throw new LegacyPostgresSchemaError(
      "application tables exist without the typed baseline version",
    );
}

/** Applies pending PostgreSQL migrations, each in its own transaction. */
export async function applyPostgresMigrations(
  pool: pg.Pool,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // One backend instance migrates at a time.
    await client.query("SELECT pg_advisory_lock(727151)");
    await assertNotLegacy(client);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
