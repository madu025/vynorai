import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import {
  encryptCredential,
  encryptionAtRestConfigured,
  maskApiKey,
} from "./services/credentialVault.js";

import {
  getPool,
  markPostgresReady,
  pgAll,
  pgGet,
  pgRun,
  postgresConfigured,
  postgresReady,
} from "./services/pgDriver.js";
import { applyPostgresMigrations } from "./services/postgresSchema.js";

/**
 * Production runs on PostgreSQL (DATABASE_URL). SQLite remains for local
 * development and the test suite, so every query must stay portable: use
 * `?` placeholders and ON CONFLICT upserts, never SQLite-only syntax.
 */
export const usingPostgres = postgresConfigured();

function openSqlite(): sqlite3.Database {
  const dbDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const sqlite = new sqlite3.Database(path.join(dbDir, "vynorai.db"));
  sqlite.run("PRAGMA foreign_keys = ON;");
  return sqlite;
}

/** SQLite handle; null when running on PostgreSQL. */
export const db: sqlite3.Database | null = usingPostgres ? null : openSqlite();

export function databaseStatus(): {
  driver: "postgres" | "sqlite";
  ready: boolean;
} {
  return usingPostgres
    ? { driver: "postgres", ready: postgresReady() }
    : { driver: "sqlite", ready: true };
}

// ─── Query Helpers ────────────────────────────────────────────────────────────
export function dbGet<T = any>(
  sql: string,
  params: any[] = [],
): Promise<T | undefined> {
  if (usingPostgres) return pgGet<T>(sql, params);
  return new Promise((resolve, reject) => {
    db!.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
}

export function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (usingPostgres) return pgAll<T>(sql, params);
  return new Promise((resolve, reject) => {
    db!.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function dbRun(
  sql: string,
  params: any[] = [],
): Promise<{ lastID: number; changes: number }> {
  if (usingPostgres) return pgRun(sql, params);
  return new Promise((resolve, reject) => {
    db!.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/** Execute a schema statement safely */
async function execSchema(sql: string): Promise<void> {
  try {
    await dbRun(sql);
  } catch (err: any) {
    const msg = err.message || "";
    if (
      msg.includes("duplicate column") ||
      msg.includes("already exists") ||
      msg.includes("no such column")
    ) {
      console.warn(`[DB Schema Non-Fatal] ${sql.slice(0, 60)}: ${msg}`);
      return;
    }
    console.error(
      `[DB Schema Error] Failed executing: ${sql.slice(0, 80)}... ->`,
      msg,
    );
    throw err;
  }
}

/** Add column if it does not already exist in legacy schema */
async function addColumnIfNotExists(
  table: string,
  columnDef: string,
): Promise<void> {
  try {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err: any) {
    // Duplicate column / column already exists is safe to ignore
  }
}

const SUBSCRIPTION_STATUSES =
  "'pending', 'active', 'cancelled', 'expired', 'failed', 'credited', 'superseded', 'chargedback'";

// ─── Systematic Versioned Migration Engine ────────────────────────────────────
interface Migration {
  version: string;
  description: string;
  up: () => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: "001_core_schema",
    description:
      "Initial database tables with high-concurrency pragmas and legacy auto-migration",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS users (
        id             TEXT PRIMARY KEY,
        email          VARCHAR(255) UNIQUE NOT NULL,
        password_hash  VARCHAR(255) NOT NULL,
        api_key        VARCHAR(128) UNIQUE NOT NULL,
        api_key_hash   VARCHAR(64),
        api_key_masked VARCHAR(32),
        name           VARCHAR(128),
        is_suspended   INTEGER NOT NULL DEFAULT 0 CHECK(is_suspended IN (0, 1)),
        allowed_ips    TEXT DEFAULT '',
        email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0, 1)),
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Safe column backfill if users table already existed in earlier VPS builds
      await addColumnIfNotExists("users", "api_key_hash VARCHAR(64)");
      await addColumnIfNotExists("users", "api_key_masked VARCHAR(32)");
      await addColumnIfNotExists(
        "users",
        "is_suspended INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists("users", "allowed_ips TEXT DEFAULT ''");
      await addColumnIfNotExists(
        "users",
        "email_verified INTEGER NOT NULL DEFAULT 0",
      );

      await execSchema(`CREATE TABLE IF NOT EXISTS subscriptions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        plan_name    VARCHAR(64) NOT NULL,
        status       VARCHAR(32) NOT NULL CHECK(status IN ('pending', 'active', 'cancelled', 'expired', 'failed')),
        order_id     VARCHAR(128) UNIQUE NOT NULL,
        payment_id   VARCHAR(128),
        amount_minor INTEGER NOT NULL DEFAULT 0,
        amount       REAL,
        currency     VARCHAR(10) NOT NULL CHECK(currency IN ('LKR', 'USD', 'EUR', 'GBP')),
        valid_until  DATETIME NOT NULL,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`);

      // Safe column backfill for subscriptions
      await addColumnIfNotExists("subscriptions", "order_id VARCHAR(128)");
      await addColumnIfNotExists("subscriptions", "payment_id VARCHAR(128)");
      await addColumnIfNotExists(
        "subscriptions",
        "amount_minor INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists(
        "subscriptions",
        "currency VARCHAR(10) DEFAULT 'LKR'",
      );

      await execSchema(`CREATE TABLE IF NOT EXISTS monthly_usage (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        plan_name       VARCHAR(64) NOT NULL,
        max_tokens      INTEGER NOT NULL,
        used_tokens     INTEGER NOT NULL DEFAULT 0,
        used_requests   INTEGER NOT NULL DEFAULT 0,
        period_start    TEXT NOT NULL,
        period_end      TEXT NOT NULL,
        last_reset_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE (user_id, period_start)
      )`);

      // Safe column backfill for monthly_usage
      await addColumnIfNotExists(
        "monthly_usage",
        "used_tokens INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists(
        "monthly_usage",
        "used_requests INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists(
        "monthly_usage",
        "period_start TEXT DEFAULT ''",
      );
      await addColumnIfNotExists("monthly_usage", "period_end TEXT DEFAULT ''");

      await execSchema(`CREATE TABLE IF NOT EXISTS usage_logs (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        model         VARCHAR(128) NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        tokens_used   INTEGER NOT NULL DEFAULT 0,
        cached        INTEGER NOT NULL DEFAULT 0 CHECK(cached IN (0, 1)),
        prev_hash     TEXT DEFAULT 'GENESIS',
        audit_hash    TEXT DEFAULT '',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`);

      // Safe column backfill for usage_logs
      await addColumnIfNotExists(
        "usage_logs",
        "cached INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists(
        "usage_logs",
        "prev_hash TEXT DEFAULT 'GENESIS'",
      );
      await addColumnIfNotExists("usage_logs", "audit_hash TEXT DEFAULT ''");
    },
  },
  {
    version: "002_targeted_performance_indexes",
    description:
      "Indexes selected by query access patterns (order_id, period_end, user_model_created)",
    up: async () => {
      // 1. Subscriptions lookups by order_id and user_status
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_subscriptions_order_id ON subscriptions(order_id)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)",
      );

      // 2. Usage log queries by user + model + created_at
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_usage_logs_user_model_created ON usage_logs(user_id, model, created_at DESC)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC)",
      );

      // 3. Monthly usage cycle expiration lookups
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_monthly_usage_period_end ON monthly_usage(period_end)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_period ON monthly_usage(user_id, period_start, period_end)",
      );

      // 4. User API key hash lookup
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)",
      );
    },
  },
  {
    version: "003_security_and_verifications_hardening",
    description:
      "Security tables with attempts check constraints, hash-only verification, and expiry index",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS security_audit_logs (
        id TEXT PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        severity VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
        actor VARCHAR(128),
        target VARCHAR(128),
        details TEXT,
        ip_address VARCHAR(45),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_logs(event_type)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_security_audit_target ON security_audit_logs(target)",
      );

      await execSchema(`CREATE TABLE IF NOT EXISTS email_verifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(64) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        otp_code VARCHAR(10),
        token VARCHAR(128),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`);

      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at)",
      );

      await execSchema(`CREATE TABLE IF NOT EXISTS admin_staff (
        id TEXT PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'support')),
        created_by VARCHAR(128),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    },
  },
  {
    version: "004_triggers_and_cleanup",
    description:
      "Automatic updated_at trigger and expired verification cleanup",
    up: async () => {
      await execSchema(`CREATE TRIGGER IF NOT EXISTS trg_monthly_usage_updated_at
      AFTER UPDATE ON monthly_usage
      FOR EACH ROW
      BEGIN
        UPDATE monthly_usage SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
      END`);

      // Cleanup any expired email verifications
      await dbRun(
        "DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP",
      ).catch(() => {});
    },
  },
  {
    version: "005_hash_only_credentials_and_atomic_quota",
    description:
      "Enforce zero plaintext credentials, hash-only verification, and scheduled TTL cleanup",
    up: async () => {
      // 1. Backfill api_key_hash and api_key_masked for any legacy users
      const usersWithoutHash = await dbAll<{ id: string; api_key: string }>(
        "SELECT id, api_key FROM users WHERE api_key_hash IS NULL OR api_key_hash = ''",
      ).catch(() => []);

      const crypto = await import("crypto");
      for (const u of usersWithoutHash) {
        if (u.api_key) {
          const hash = crypto
            .createHash("sha256")
            .update(u.api_key)
            .digest("hex");
          const masked = `${u.api_key.slice(0, 14)}...${u.api_key.slice(-4)}`;
          await dbRun(
            "UPDATE users SET api_key_hash = ?, api_key_masked = ? WHERE id = ?",
            [hash, masked, u.id],
          );
        }
      }

      // 2. Clear any legacy plaintext OTP / token from email_verifications
      await dbRun(
        "UPDATE email_verifications SET otp_code = NULL, token = NULL",
      ).catch(() => {});

      // 3. Purge all expired verification tokens
      await dbRun(
        "DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP",
      ).catch(() => {});

      // 4. Ensure non-null boolean checks
      await dbRun(
        "UPDATE users SET is_suspended = 0 WHERE is_suspended IS NULL",
      ).catch(() => {});
      await dbRun(
        "UPDATE users SET email_verified = 0 WHERE email_verified IS NULL",
      ).catch(() => {});
      await dbRun(
        "UPDATE usage_logs SET cached = 0 WHERE cached IS NULL",
      ).catch(() => {});
    },
  },
  {
    version: "006_encrypted_recoverable_api_keys",
    description:
      "Encrypt recoverable API keys at rest while retaining hash-only authentication",
    up: async () => {
      await addColumnIfNotExists("users", "api_key_encrypted TEXT");
      if (!encryptionAtRestConfigured()) return;

      const legacyUsers = await dbAll<{
        id: string;
        api_key: string;
        api_key_encrypted?: string;
      }>(
        "SELECT id, api_key, api_key_encrypted FROM users WHERE api_key_encrypted IS NULL OR api_key_encrypted = ''",
      );
      for (const user of legacyUsers) {
        if (!user.api_key?.startsWith("vynor_live_")) continue;
        const encrypted = encryptCredential(user.api_key);
        if (!encrypted) continue;
        await dbRun(
          "UPDATE users SET api_key = ?, api_key_masked = ?, api_key_encrypted = ? WHERE id = ?",
          [
            `encrypted:${user.id}`,
            maskApiKey(user.api_key),
            encrypted,
            user.id,
          ],
        );
      }
    },
  },
  {
    version: "007_request_economics_ledger",
    description:
      "Authoritative provider cost, optimization, and per-request margin ledger",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS request_economics (
        id                     TEXT PRIMARY KEY,
        request_id             TEXT UNIQUE NOT NULL,
        usage_log_id           TEXT,
        user_id                TEXT NOT NULL,
        plan_id                VARCHAR(64) NOT NULL,
        requested_model        VARCHAR(128) NOT NULL,
        resolved_model         VARCHAR(128),
        provider               VARCHAR(32),
        input_tokens           INTEGER NOT NULL DEFAULT 0,
        output_tokens          INTEGER NOT NULL DEFAULT 0,
        provider_cost_usd      REAL,
        cost_source            VARCHAR(20) NOT NULL CHECK(cost_source IN ('provider', 'local-zero', 'unknown')),
        allocated_revenue_usd  REAL NOT NULL DEFAULT 0,
        gross_margin_usd       REAL,
        cache_status           VARCHAR(16) NOT NULL DEFAULT 'bypass' CHECK(cache_status IN ('hit', 'miss', 'bypass')),
        optimization_mode      VARCHAR(20) NOT NULL DEFAULT 'safe',
        template_id            VARCHAR(128),
        estimated_tokens_saved INTEGER NOT NULL DEFAULT 0,
        latency_ms             INTEGER,
        outcome                VARCHAR(16) NOT NULL DEFAULT 'success' CHECK(outcome IN ('success', 'failed')),
        created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (usage_log_id) REFERENCES usage_logs (id) ON DELETE SET NULL
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_request_economics_user_created ON request_economics(user_id, created_at DESC)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_request_economics_provider_created ON request_economics(provider, created_at DESC)",
      );
    },
  },
  {
    version: "008_economics_outcome",
    description: "Separate failed upstream requests from billable economics",
    up: async () => {
      await addColumnIfNotExists(
        "request_economics",
        "outcome VARCHAR(16) NOT NULL DEFAULT 'success' CHECK(outcome IN ('success', 'failed'))",
      );
    },
  },
  {
    version: "009_email_verifications_missing_columns",
    description:
      "Ensure otp_hash, token_hash, and attempts columns exist on email_verifications",
    up: async () => {
      await addColumnIfNotExists("email_verifications", "otp_hash VARCHAR(64)");
      await addColumnIfNotExists(
        "email_verifications",
        "token_hash VARCHAR(64)",
      );
      await addColumnIfNotExists(
        "email_verifications",
        "attempts INTEGER NOT NULL DEFAULT 0",
      );
    },
  },
  {
    version: "010_rebuild_email_verifications_schema",
    description:
      "Rebuild email_verifications table to eliminate legacy non-null constraints on deprecated columns",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS email_verifications_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(64) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        otp_code VARCHAR(10) DEFAULT '',
        token VARCHAR(128) DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )`);
      try {
        await execSchema(`INSERT OR IGNORE INTO email_verifications_v2 (id, user_id, email, otp_hash, token_hash, otp_code, token, attempts, expires_at, created_at)
          SELECT id, user_id, email, COALESCE(otp_hash, ''), COALESCE(token_hash, ''), '', '', COALESCE(attempts, 0), expires_at, created_at FROM email_verifications`);
      } catch (_) {}
      await execSchema("DROP TABLE IF EXISTS email_verifications");
      await execSchema(
        "ALTER TABLE email_verifications_v2 RENAME TO email_verifications",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at)",
      );
    },
  },
  {
    version: "011_monthly_usage_unique_period",
    description:
      "Ensure unique index on monthly_usage(user_id, period_start) for conflict-safe inserts",
    up: async () => {
      await execSchema(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_usage_user_period ON monthly_usage(user_id, period_start)",
      );
    },
  },
  {
    version: "012_topup_credits_ledger",
    description:
      "Track top-up credits per cycle and stop top-up orders acting as subscription tiers",
    up: async () => {
      await addColumnIfNotExists(
        "monthly_usage",
        "bonus_tokens INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists(
        "monthly_usage",
        "bonus_requests INTEGER NOT NULL DEFAULT 0",
      );

      // SQLite cannot alter a CHECK constraint, so rebuild subscriptions to allow
      // the credited/superseded/chargedback order states.
      await dbRun("BEGIN IMMEDIATE");
      try {
        await dbRun(`CREATE TABLE subscriptions_v2 (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          plan_name    VARCHAR(64) NOT NULL,
          status       VARCHAR(32) NOT NULL CHECK(status IN (${SUBSCRIPTION_STATUSES})),
          order_id     VARCHAR(128) UNIQUE NOT NULL,
          payment_id   VARCHAR(128),
          amount_minor INTEGER NOT NULL DEFAULT 0,
          amount       REAL,
          currency     VARCHAR(10) NOT NULL CHECK(currency IN ('LKR', 'USD', 'EUR', 'GBP')),
          valid_until  DATETIME NOT NULL,
          created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`);
        // Legacy IPN stored paid top-ups as 'active' subscriptions, which made
        // "topup5m" the user's plan. Demote them so the real tier applies again.
        await dbRun(`INSERT INTO subscriptions_v2
          (id, user_id, plan_name, status, order_id, payment_id, amount_minor, amount, currency, valid_until, created_at)
          SELECT id, user_id, plan_name,
                 CASE WHEN plan_name LIKE 'topup%' AND status = 'active' THEN 'credited'
                      WHEN status IN (${SUBSCRIPTION_STATUSES}) THEN status
                      ELSE 'cancelled' END,
                 COALESCE(order_id, 'legacy_' || id), payment_id, COALESCE(amount_minor, 0), amount,
                 COALESCE(currency, 'LKR'), valid_until, created_at
          FROM subscriptions`);
        await dbRun("DROP TABLE subscriptions");
        await dbRun("ALTER TABLE subscriptions_v2 RENAME TO subscriptions");
        await dbRun(
          "CREATE INDEX IF NOT EXISTS idx_subscriptions_order_id ON subscriptions(order_id)",
        );
        await dbRun(
          "CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)",
        );
        await dbRun("COMMIT");
      } catch (err) {
        await dbRun("ROLLBACK").catch(() => {});
        throw err;
      }
    },
  },
  {
    version: "013_provider_prefix_cache_metrics",
    description:
      "Record provider prefix-cache hits per request to measure real input cost",
    up: async () => {
      await addColumnIfNotExists(
        "request_economics",
        "cached_input_tokens INTEGER NOT NULL DEFAULT 0",
      );
    },
  },
  {
    version: "014_provider_credentials",
    description:
      "Provider API keys managed from the admin portal, encrypted at rest",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS provider_credentials (
        provider      VARCHAR(32) PRIMARY KEY,
        key_encrypted TEXT NOT NULL,
        key_masked    VARCHAR(32) NOT NULL,
        updated_by    VARCHAR(128),
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    },
  },
  {
    version: "015_economics_estimates",
    description:
      "Cost computed from published prices when the provider reports none, credits charged, off-peak flag",
    up: async () => {
      await addColumnIfNotExists(
        "request_economics",
        "estimated_cost_usd REAL",
      );
      await addColumnIfNotExists(
        "request_economics",
        "credits_charged INTEGER",
      );
      await addColumnIfNotExists(
        "request_economics",
        "off_peak INTEGER NOT NULL DEFAULT 0",
      );
    },
  },
  {
    version: "016_routing_signals",
    description:
      "Router tier, auto flag, keyed prompt hash and tool follow-up flag per request",
    up: async () => {
      await addColumnIfNotExists("request_economics", "route_tier VARCHAR(16)");
      await addColumnIfNotExists(
        "request_economics",
        "route_auto INTEGER NOT NULL DEFAULT 0",
      );
      await addColumnIfNotExists("request_economics", "prompt_fp VARCHAR(32)");
      await addColumnIfNotExists(
        "request_economics",
        "tool_followup INTEGER NOT NULL DEFAULT 0",
      );
    },
  },
  {
    version: "017_privacy_consent",
    description: "When and which privacy policy version a user accepted",
    up: async () => {
      await addColumnIfNotExists("users", "privacy_accepted_at DATETIME");
      await addColumnIfNotExists("users", "privacy_version VARCHAR(16)");
    },
  },
  {
    version: "018_routing_feedback",
    description: "Helpful / unhelpful signals per prompt fingerprint (no text)",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS routing_feedback (
        id          VARCHAR(36) PRIMARY KEY,
        user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prompt_fp   VARCHAR(32),
        signal      VARCHAR(16) NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    },
  },
  {
    version: "019_error_reports",
    description: "Opt-in client error reports (message and stack only)",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS error_reports (
        id          VARCHAR(36) PRIMARY KEY,
        user_id     VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
        source      VARCHAR(32) NOT NULL,
        message     TEXT NOT NULL,
        stack       TEXT,
        client      VARCHAR(64),
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    },
  },
  {
    version: "020_quota_reservations",
    description: "Durable quota holds, so a restart cannot strand them",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS quota_reservations (
        id          VARCHAR(36) PRIMARY KEY,
        user_id     VARCHAR(36) NOT NULL,
        tokens      INTEGER NOT NULL,
        requests    INTEGER NOT NULL,
        created_at  VARCHAR(32) NOT NULL
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_quota_reservations_created ON quota_reservations (created_at)",
      );
    },
  },
  {
    version: "021_background_agents",
    description:
      "Background agent tasks, events, artifacts, billing, and consent",
    up: async () => {
      for (const column of [
        "background_enabled INTEGER",
        "background_tasks_per_month INTEGER",
        "background_max_concurrency INTEGER",
        "background_priority VARCHAR(16)",
      ])
        await addColumnIfNotExists("plan_overrides", column);
      await addColumnIfNotExists(
        "quota_reservations",
        "owner_type VARCHAR(32)",
      );
      await addColumnIfNotExists("quota_reservations", "owner_id TEXT");

      await execSchema(`CREATE TABLE IF NOT EXISTS background_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(32) NOT NULL CHECK (status IN ('awaiting_upload','queued','running','cancel_requested','completed','failed','canceled','purged')),
        prompt TEXT, language VARCHAR(16) NOT NULL DEFAULT 'en',
        project_fingerprint VARCHAR(64) NOT NULL, manifest_digest VARCHAR(64) NOT NULL,
        estimate_credits INTEGER NOT NULL, cap_credits INTEGER NOT NULL,
        used_credits INTEGER NOT NULL DEFAULT 0, model_credits INTEGER NOT NULL DEFAULT 0,
        compute_credits INTEGER NOT NULL DEFAULT 0, refund_credits INTEGER NOT NULL DEFAULT 0,
        quota_reservation_id TEXT, quote_id TEXT NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, worker_id TEXT, lease_id TEXT, heartbeat_at DATETIME,
        queued_at DATETIME, started_at DATETIME, ended_at DATETIME, failure_reason VARCHAR(128),
        proof TEXT, upload_artifact_id TEXT, patch_artifact_id TEXT, proof_artifact_id TEXT,
        workspace_deleted_at DATETIME, deleted_at DATETIME, purge_after DATETIME, purged_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, idempotency_key)
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_tasks_user_created ON background_tasks(user_id, created_at DESC)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_tasks_dispatch ON background_tasks(status, priority, queued_at)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_tasks_heartbeat ON background_tasks(heartbeat_at)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_tasks_purge ON background_tasks(purge_after)",
      );
      await execSchema(`CREATE TABLE IF NOT EXISTS background_task_events (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL, event_type VARCHAR(64) NOT NULL, message TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(task_id, sequence)
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_events_task_sequence ON background_task_events(task_id, sequence)",
      );
      await execSchema(`CREATE TABLE IF NOT EXISTS background_artifacts (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
        artifact_type VARCHAR(32) NOT NULL, storage_path TEXT NOT NULL, sha256 VARCHAR(64) NOT NULL,
        bytes INTEGER NOT NULL, key_version VARCHAR(32) NOT NULL, expires_at DATETIME NOT NULL,
        deleted_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_artifacts_expiry ON background_artifacts(expires_at, deleted_at)",
      );
      await execSchema(`CREATE TABLE IF NOT EXISTS background_billing_ledger (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL,
        event_type VARCHAR(32) NOT NULL, credits INTEGER NOT NULL,
        idempotency_key VARCHAR(160) NOT NULL UNIQUE, metadata TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_background_ledger_task ON background_billing_ledger(task_id, created_at)",
      );
      await execSchema(`CREATE TABLE IF NOT EXISTS background_consent (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        policy_version VARCHAR(32) NOT NULL, client VARCHAR(64) NOT NULL, ip_digest VARCHAR(64) NOT NULL,
        accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, policy_version)
      )`);
      await execSchema(`CREATE TABLE IF NOT EXISTS web_push_subscriptions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint_digest VARCHAR(64) NOT NULL,
        endpoint_ciphertext TEXT NOT NULL, p256dh_ciphertext TEXT NOT NULL, auth_ciphertext TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at DATETIME, revoked_at DATETIME
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id, revoked_at)",
      );
      await execSchema(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_web_push_endpoint ON web_push_subscriptions(user_id, endpoint_digest)",
      );
    },
  },
  {
    version: "022_password_resets",
    description: "Single-use, expiring password reset tokens",
    up: async () => {
      await execSchema(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC)",
      );
      await execSchema(
        "CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at, used_at)",
      );
    },
  },
];

async function applyMigrations(): Promise<void> {
  await execSchema(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const appliedRows = await dbAll<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      console.log(
        `[DB Migration] Applying ${migration.version}: ${migration.description}...`,
      );
      await migration.up();
      await dbRun("INSERT INTO schema_migrations (version) VALUES (?)", [
        migration.version,
      ]);
      console.log(
        `[DB Migration] ✅ ${migration.version} successfully applied.`,
      );
    }
  }
}

/** Initialize all database tables, foreign keys, constraints, and performance indexes */
export async function initDb(): Promise<void> {
  if (usingPostgres) {
    const applied = await applyPostgresMigrations(getPool());
    for (const version of applied)
      console.log(`[DB Migration] ✅ ${version} applied (PostgreSQL).`);
    markPostgresReady(true);
    startVerificationCleanup();
    return;
  }

  // ── 1. High-Concurrency PRAGMAs (WAL Mode & Foreign Keys) ─────────────────
  await execSchema("PRAGMA foreign_keys = ON;");
  await execSchema("PRAGMA journal_mode = WAL;");
  await execSchema("PRAGMA synchronous = NORMAL;");
  await execSchema("PRAGMA busy_timeout = 10000;");
  await execSchema("PRAGMA cache_size = -64000;");
  await execSchema("PRAGMA temp_store = MEMORY;");

  // ── 2. Run Systematic Versioned Migrations ─────────────────────────────────
  await applyMigrations();

  startVerificationCleanup();
}

/** Hourly purge of expired authentication tokens. */
function startVerificationCleanup(): void {
  setInterval(async () => {
    try {
      await dbRun(
        "DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP",
      );
      await dbRun(
        "DELETE FROM password_reset_tokens WHERE expires_at < CURRENT_TIMESTAMP OR used_at IS NOT NULL",
      );
    } catch (e) {}
  }, 3600_000).unref();
}

/** Run after initDb to create model registry + plan override tables */
export async function initModelRegistry(): Promise<void> {
  const { ensureModelRegistryTable, getAllModels, syncDefaultModels } =
    await import("./services/modelRegistry.js");
  const { initPlanManager } = await import("./services/planManager.js");
  const { ensureMemoryTables } = await import("./services/memoryEngine.js");
  await ensureModelRegistryTable();
  await syncDefaultModels();
  await getAllModels(true);
  await initPlanManager();
  await ensureMemoryTables();
}

export async function ensureSecurityTables(): Promise<void> {
  // Handled systematically in migration 003_security_and_verifications_hardening
}
