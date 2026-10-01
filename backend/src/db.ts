import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import { encryptCredential, encryptionAtRestConfigured, maskApiKey } from "./services/credentialVault.js";

const dbDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, "vynorai.db");
export const db = new sqlite3.Database(dbPath);

// Immediately activate foreign keys on connection
db.run("PRAGMA foreign_keys = ON;");

// ─── Query Helpers ────────────────────────────────────────────────────────────
export function dbGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err); else resolve(row as T);
    });
  });
}

export function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows as T[]);
    });
  });
}

export function dbRun(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
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
    console.error(`[DB Schema Error] Failed executing: ${sql.slice(0, 80)}... ->`, msg);
    throw err;
  }
}

/** Add column if it does not already exist in legacy schema */
async function addColumnIfNotExists(table: string, columnDef: string): Promise<void> {
  try {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err: any) {
    // Duplicate column / column already exists is safe to ignore
  }
}

// ─── Systematic Versioned Migration Engine ────────────────────────────────────
interface Migration {
  version: string;
  description: string;
  up: () => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: "001_core_schema",
    description: "Initial database tables with high-concurrency pragmas and legacy auto-migration",
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
      await addColumnIfNotExists("users", "is_suspended INTEGER NOT NULL DEFAULT 0");
      await addColumnIfNotExists("users", "allowed_ips TEXT DEFAULT ''");
      await addColumnIfNotExists("users", "email_verified INTEGER NOT NULL DEFAULT 0");

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
      await addColumnIfNotExists("subscriptions", "amount_minor INTEGER NOT NULL DEFAULT 0");
      await addColumnIfNotExists("subscriptions", "currency VARCHAR(10) DEFAULT 'LKR'");

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
      await addColumnIfNotExists("monthly_usage", "used_tokens INTEGER NOT NULL DEFAULT 0");
      await addColumnIfNotExists("monthly_usage", "used_requests INTEGER NOT NULL DEFAULT 0");
      await addColumnIfNotExists("monthly_usage", "period_start TEXT DEFAULT ''");
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
      await addColumnIfNotExists("usage_logs", "cached INTEGER NOT NULL DEFAULT 0");
      await addColumnIfNotExists("usage_logs", "prev_hash TEXT DEFAULT 'GENESIS'");
      await addColumnIfNotExists("usage_logs", "audit_hash TEXT DEFAULT ''");
    },
  },
  {
    version: "002_targeted_performance_indexes",
    description: "Indexes selected by query access patterns (order_id, period_end, user_model_created)",
    up: async () => {
      // 1. Subscriptions lookups by order_id and user_status
      await execSchema("CREATE INDEX IF NOT EXISTS idx_subscriptions_order_id ON subscriptions(order_id)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)");

      // 2. Usage log queries by user + model + created_at
      await execSchema("CREATE INDEX IF NOT EXISTS idx_usage_logs_user_model_created ON usage_logs(user_id, model, created_at DESC)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC)");

      // 3. Monthly usage cycle expiration lookups
      await execSchema("CREATE INDEX IF NOT EXISTS idx_monthly_usage_period_end ON monthly_usage(period_end)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_period ON monthly_usage(user_id, period_start, period_end)");

      // 4. User API key hash lookup
      await execSchema("CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)");
    },
  },
  {
    version: "003_security_and_verifications_hardening",
    description: "Security tables with attempts check constraints, hash-only verification, and expiry index",
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

      await execSchema("CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_logs(event_type)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_security_audit_target ON security_audit_logs(target)");

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

      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at)");

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
    description: "Automatic updated_at trigger and expired verification cleanup",
    up: async () => {
      await execSchema(`CREATE TRIGGER IF NOT EXISTS trg_monthly_usage_updated_at
      AFTER UPDATE ON monthly_usage
      FOR EACH ROW
      BEGIN
        UPDATE monthly_usage SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
      END`);

      // Cleanup any expired email verifications
      await dbRun("DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP").catch(() => {});
    },
  },
  {
    version: "005_hash_only_credentials_and_atomic_quota",
    description: "Enforce zero plaintext credentials, hash-only verification, and scheduled TTL cleanup",
    up: async () => {
      // 1. Backfill api_key_hash and api_key_masked for any legacy users
      const usersWithoutHash = await dbAll<{ id: string; api_key: string }>(
        "SELECT id, api_key FROM users WHERE api_key_hash IS NULL OR api_key_hash = ''"
      ).catch(() => []);

      const crypto = await import("crypto");
      for (const u of usersWithoutHash) {
        if (u.api_key) {
          const hash = crypto.createHash("sha256").update(u.api_key).digest("hex");
          const masked = `${u.api_key.slice(0, 14)}...${u.api_key.slice(-4)}`;
          await dbRun("UPDATE users SET api_key_hash = ?, api_key_masked = ? WHERE id = ?", [hash, masked, u.id]);
        }
      }

      // 2. Clear any legacy plaintext OTP / token from email_verifications
      await dbRun("UPDATE email_verifications SET otp_code = NULL, token = NULL").catch(() => {});

      // 3. Purge all expired verification tokens
      await dbRun("DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP").catch(() => {});

      // 4. Ensure non-null boolean checks
      await dbRun("UPDATE users SET is_suspended = 0 WHERE is_suspended IS NULL").catch(() => {});
      await dbRun("UPDATE users SET email_verified = 0 WHERE email_verified IS NULL").catch(() => {});
      await dbRun("UPDATE usage_logs SET cached = 0 WHERE cached IS NULL").catch(() => {});
    },
  },
  {
    version: "006_encrypted_recoverable_api_keys",
    description: "Encrypt recoverable API keys at rest while retaining hash-only authentication",
    up: async () => {
      await addColumnIfNotExists("users", "api_key_encrypted TEXT");
      if (!encryptionAtRestConfigured()) return;

      const legacyUsers = await dbAll<{ id: string; api_key: string; api_key_encrypted?: string }>(
        "SELECT id, api_key, api_key_encrypted FROM users WHERE api_key_encrypted IS NULL OR api_key_encrypted = ''",
      );
      for (const user of legacyUsers) {
        if (!user.api_key?.startsWith("vynor_live_")) continue;
        const encrypted = encryptCredential(user.api_key);
        if (!encrypted) continue;
        await dbRun(
          "UPDATE users SET api_key = ?, api_key_masked = ?, api_key_encrypted = ? WHERE id = ?",
          [`encrypted:${user.id}`, maskApiKey(user.api_key), encrypted, user.id],
        );
      }
    },
  },
  {
    version: "007_request_economics_ledger",
    description: "Authoritative provider cost, optimization, and per-request margin ledger",
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
      await execSchema("CREATE INDEX IF NOT EXISTS idx_request_economics_user_created ON request_economics(user_id, created_at DESC)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_request_economics_provider_created ON request_economics(provider, created_at DESC)");
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
    description: "Ensure otp_hash, token_hash, and attempts columns exist on email_verifications",
    up: async () => {
      await addColumnIfNotExists("email_verifications", "otp_hash VARCHAR(64)");
      await addColumnIfNotExists("email_verifications", "token_hash VARCHAR(64)");
      await addColumnIfNotExists("email_verifications", "attempts INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    version: "010_rebuild_email_verifications_schema",
    description: "Rebuild email_verifications table to eliminate legacy non-null constraints on deprecated columns",
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
      await execSchema("ALTER TABLE email_verifications_v2 RENAME TO email_verifications");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token_hash)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)");
      await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at)");
    },
  },
];

async function applyMigrations(): Promise<void> {
  await execSchema(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const appliedRows = await dbAll<{ version: string }>("SELECT version FROM schema_migrations");
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      console.log(`[DB Migration] Applying ${migration.version}: ${migration.description}...`);
      await migration.up();
      await dbRun("INSERT INTO schema_migrations (version) VALUES (?)", [migration.version]);
      console.log(`[DB Migration] ✅ ${migration.version} successfully applied.`);
    }
  }
}

/** Initialize all database tables, foreign keys, constraints, and performance indexes */
export async function initDb(): Promise<void> {
  // ── 1. High-Concurrency PRAGMAs (WAL Mode & Foreign Keys) ─────────────────
  await execSchema("PRAGMA foreign_keys = ON;");
  await execSchema("PRAGMA journal_mode = WAL;");
  await execSchema("PRAGMA synchronous = NORMAL;");
  await execSchema("PRAGMA busy_timeout = 10000;");
  await execSchema("PRAGMA cache_size = -64000;");
  await execSchema("PRAGMA temp_store = MEMORY;");

  // ── 2. Run Systematic Versioned Migrations ─────────────────────────────────
  await applyMigrations();

  // ── 3. Start automated periodic expired token cleanup (every 1 hour) ───────
  setInterval(async () => {
    try {
      await dbRun("DELETE FROM email_verifications WHERE expires_at < CURRENT_TIMESTAMP");
    } catch (e) {}
  }, 3600_000).unref();
}

/** Run after initDb to create model registry + plan override tables */
export async function initModelRegistry(): Promise<void> {
  const { ensureModelRegistryTable, getAllModels } = await import("./services/modelRegistry.js");
  const { initPlanManager } = await import("./services/planManager.js");
  const { ensureMemoryTables } = await import("./services/memoryEngine.js");
  await ensureModelRegistryTable();
  await getAllModels(true);
  await initPlanManager();
  await ensureMemoryTables();
}

export async function ensureSecurityTables(): Promise<void> {
  // Handled systematically in migration 003_security_and_verifications_hardening
}
