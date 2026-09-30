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
      )`, (err) => {
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
  // 1. Audit logs table
  await dbRun(`CREATE TABLE IF NOT EXISTS security_audit_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO',
    actor TEXT,
    target TEXT,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 2. Email verification OTP and token table
  await dbRun(`CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 3. Admin Staff table (Only authorized team members added by Super Admin)
  await dbRun(`CREATE TABLE IF NOT EXISTS admin_staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin', -- 'super_admin' | 'admin' | 'support'
    created_by TEXT,
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
