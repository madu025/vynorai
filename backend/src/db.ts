import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

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

/** Execute a schema statement safely and throw on failure */
async function execSchema(sql: string): Promise<void> {
  try {
    await dbRun(sql);
  } catch (err: any) {
    // Ignore already existing column / index errors during alter migrations
    if (!err.message?.includes("duplicate column") && !err.message?.includes("already exists")) {
      console.error(`[DB Schema Error] Failed executing: ${sql.slice(0, 80)}... ->`, err.message);
      throw err;
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

  // ── 2. Users Table (With API Key Hash Support) ─────────────────────────────
  await execSchema(`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    api_key       TEXT UNIQUE NOT NULL,
    api_key_hash  TEXT,
    name          TEXT,
    is_suspended  INTEGER DEFAULT 0 CHECK(is_suspended IN (0, 1)),
    allowed_ips   TEXT DEFAULT '',
    email_verified INTEGER DEFAULT 0 CHECK(email_verified IN (0, 1)),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await execSchema("CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)");
  await execSchema("CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)");

  // ── 3. Subscriptions (With Integer Minor Currency Units & Constraints) ──────
  await execSchema(`CREATE TABLE IF NOT EXISTS subscriptions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    plan_name    VARCHAR(64) NOT NULL,
    status       VARCHAR(32) NOT NULL CHECK(status IN ('pending', 'active', 'cancelled', 'expired', 'failed')),
    order_id     VARCHAR(128) UNIQUE NOT NULL,
    payment_id   VARCHAR(128),
    amount_minor INTEGER NOT NULL DEFAULT 0, -- Minor units in cents (e.g. 185050 for 1850.50 LKR)
    amount       REAL,                      -- Legacy human-readable float representation
    currency     VARCHAR(10) NOT NULL CHECK(currency IN ('LKR', 'USD', 'EUR', 'GBP')),
    valid_until  DATETIME NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);
  await execSchema("CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)");

  // Safe migration for existing subscriptions table to add amount_minor
  try {
    const subCols = (await dbAll<any>("PRAGMA table_info(subscriptions)")).map((c: any) => c.name);
    if (!subCols.includes("amount_minor")) {
      await dbRun("ALTER TABLE subscriptions ADD COLUMN amount_minor INTEGER DEFAULT 0");
    }
  } catch (err) {
    // Ignore migration error if already present
  }

  // ── 4. Per-User Monthly Quota Ledger (Multi-Month Historical Cycle Support) ─
  await execSchema(`CREATE TABLE IF NOT EXISTS monthly_usage (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    plan_name       VARCHAR(64) NOT NULL,
    max_tokens      INTEGER NOT NULL,
    used_tokens     INTEGER DEFAULT 0,
    used_requests   INTEGER DEFAULT 0,
    period_start    TEXT NOT NULL,
    period_end      TEXT NOT NULL,
    last_reset_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (user_id, period_start)
  )`);
  await execSchema("CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_period ON monthly_usage(user_id, period_start, period_end)");

  // ── 5. Usage Logs (Granular Append Table with Merkle Hash & Composite Index) ─
  await execSchema(`CREATE TABLE IF NOT EXISTS usage_logs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    model         VARCHAR(128) NOT NULL,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    tokens_used   INTEGER DEFAULT 0,
    cached        INTEGER DEFAULT 0 CHECK(cached IN (0, 1)),
    prev_hash     TEXT DEFAULT 'GENESIS',
    audit_hash    TEXT DEFAULT '',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);
  await execSchema("CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC)");
  await execSchema("CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC)");

  // ── 6. Automatic updated_at Trigger for monthly_usage ─────────────────────
  await execSchema(`CREATE TRIGGER IF NOT EXISTS trg_monthly_usage_updated_at
  AFTER UPDATE ON monthly_usage
  FOR EACH ROW
  BEGIN
    UPDATE monthly_usage SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END`);
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
  await ensureSecurityTables();
}

/** Ensure security tables and user columns exist with bounded types */
export async function ensureSecurityTables(): Promise<void> {
  // 1. Audit logs table (With Bounded Types & Enum Check Constraint)
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
  await execSchema("CREATE INDEX IF NOT EXISTS idx_security_audit_actor ON security_audit_logs(actor)");

  // 2. Email verification OTP and token table (With Hashed Token/OTP & Attempt Limit)
  await execSchema(`CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    otp_hash VARCHAR(64),
    token VARCHAR(128) NOT NULL,
    token_hash VARCHAR(64),
    attempts INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);
  await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token)");
  await execSchema("CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)");

  // 3. Admin Staff table (With Role Check Constraint)
  await execSchema(`CREATE TABLE IF NOT EXISTS admin_staff (
    id TEXT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'support')),
    created_by VARCHAR(128),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 4. Safe user migrations for existing databases
  try {
    const userCols = (await dbAll<any>("PRAGMA table_info(users)")).map((c: any) => c.name);
    if (!userCols.includes("api_key_hash")) {
      await dbRun("ALTER TABLE users ADD COLUMN api_key_hash TEXT");
      await dbRun("CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash)");
    }
    if (!userCols.includes("is_suspended")) {
      await dbRun("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0");
    }
    if (!userCols.includes("allowed_ips")) {
      await dbRun("ALTER TABLE users ADD COLUMN allowed_ips TEXT DEFAULT ''");
    }
    if (!userCols.includes("email_verified")) {
      await dbRun("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
    }

    const usageCols = (await dbAll<any>("PRAGMA table_info(usage_logs)")).map((c: any) => c.name);
    if (!usageCols.includes("prev_hash")) {
      await dbRun("ALTER TABLE usage_logs ADD COLUMN prev_hash TEXT DEFAULT 'GENESIS'");
    }
    if (!usageCols.includes("audit_hash")) {
      await dbRun("ALTER TABLE usage_logs ADD COLUMN audit_hash TEXT DEFAULT ''");
    }
  } catch (err) {
    console.error("[DB] Security migration error:", err);
  }
}
