import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";


const dbDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, "vynorai.db");
export const db = new sqlite3.Database(dbPath);

/** Initialize all database tables */
export function initDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // ── High-Concurrency PRAGMAs (Supports 1000+ Concurrent Requests) ────
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA busy_timeout = 10000;"); // 10s wait on contention, zero SQLITE_BUSY crashes
      db.run("PRAGMA cache_size = -64000;");  // 64MB memory page cache
      db.run("PRAGMA temp_store = MEMORY;");

      // ── Users ───────────────────────────────────────────────────────────
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        api_key       TEXT UNIQUE NOT NULL,
        name          TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // ── Subscriptions ───────────────────────────────────────────────────
      db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        plan_name  TEXT NOT NULL,
        status     TEXT NOT NULL,           -- active | cancelled | expired
        order_id   TEXT UNIQUE NOT NULL,
        payment_id TEXT,
        amount     REAL NOT NULL,
        currency   TEXT NOT NULL,
        valid_until DATETIME NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`);

      // ── Per-User Monthly Quota Ledger ───────────────────────────────────
      // One row per user per billing month. Resets automatically.
      db.run(`CREATE TABLE IF NOT EXISTS monthly_usage (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL UNIQUE,  -- one active row per user
        plan_name       TEXT NOT NULL,
        max_tokens      INTEGER NOT NULL,       -- plan's monthly limit
        used_tokens     INTEGER DEFAULT 0,      -- accumulates all month
        used_requests   INTEGER DEFAULT 0,
        period_start    TEXT NOT NULL,          -- YYYY-MM-DD of billing cycle start
        period_end      TEXT NOT NULL,          -- YYYY-MM-DD of billing cycle end
        last_reset_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`);

      // ── Granular Usage Log (for admin analytics) ────────────────────────
      db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        model        TEXT NOT NULL,
        input_tokens  INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        tokens_used   INTEGER DEFAULT 0,   -- total = input + output
        cached        INTEGER DEFAULT 0,   -- 1 = served from cache (0 tokens billed)
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`);

      // ── High-Performance Concurrency Indexes (Eliminates Table Scans & RAM Spikes) ──
      db.run(`CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
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

/** Ensure security tables and user columns (suspension, allowed IPs, email verification, admin staff) exist */
export async function ensureSecurityTables(): Promise<void> {
  // 1. Audit logs table (With Bounded Types & Enum Check Constraint)
  await dbRun(`CREATE TABLE IF NOT EXISTS security_audit_logs (
    id TEXT PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
    actor VARCHAR(128),
    target VARCHAR(128),
    details TEXT,
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Indexes on security audit logs (Fast lookup by time, event, actor without full table scan)
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_logs(created_at DESC)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_logs(event_type)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_security_audit_actor ON security_audit_logs(actor)`);

  // 2. Email verification OTP and token table
  await dbRun(`CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    token VARCHAR(128) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_email_verif_token ON email_verifications(token)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id)`);

  // 3. Admin Staff table (Only authorized team members added by Super Admin)
  await dbRun(`CREATE TABLE IF NOT EXISTS admin_staff (
    id TEXT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'admin', -- 'super_admin' | 'admin' | 'support'
    created_by VARCHAR(128),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 4. Safe user column migrations
  try {
    const userCols = (await dbAll<any>("PRAGMA table_info(users)")).map((c: any) => c.name);
    if (!userCols.includes("is_suspended")) {
      await dbRun("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0");
    }
    if (!userCols.includes("allowed_ips")) {
      await dbRun("ALTER TABLE users ADD COLUMN allowed_ips TEXT DEFAULT ''");
    }
    if (!userCols.includes("email_verified")) {
      await dbRun("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
    }

    // 5. Merkle Hash Audit Chain migration for usage_logs
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
