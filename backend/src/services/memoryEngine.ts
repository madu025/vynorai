/**
 * VynorAI User Memory & Rules Service
 * -------------------------------------
 * Fills the Cursor ".cursorrules" / "Memory" gap.
 *
 * Features:
 *  1. User Rules  — persistent instructions injected into EVERY request
 *                   (e.g. "Always use TypeScript strict mode", "Reply in Sinhala")
 *  2. Project Rules — per-project-root instructions (like .cursorrules)
 *  3. Short-term Memory — recent facts agent learned this session
 *
 * Storage: SQLite (user_rules + user_memory tables)
 * Injection: prepended to system prompt on every request
 */

import { dbGet, dbAll, dbRun, db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { decryptCredential, encryptCredential, encryptionAtRestConfigured } from "./credentialVault.js";

function protect(value: string): string {
  return encryptCredential(value) || value;
}

function unprotect(value: string): string {
  if (!value.startsWith("v1:")) return value;
  return decryptCredential(value) || "";
}

// ─── Schema ───────────────────────────────────────────────────────────────────
export async function ensureMemoryTables(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS user_rules (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'global', -- global | project:<hash>
        rule       TEXT NOT NULL,
        enabled    INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  await new Promise<void>((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS user_memory (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        expires_at DATETIME,         -- NULL = permanent
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  if (encryptionAtRestConfigured()) {
    const plaintextRules = await dbAll<{ id: string; rule: string }>(
      "SELECT id, rule FROM user_rules WHERE rule NOT LIKE 'v1:%'",
    );
    for (const row of plaintextRules) {
      await dbRun("UPDATE user_rules SET rule = ? WHERE id = ?", [protect(row.rule), row.id]);
    }
    const plaintextMemory = await dbAll<{ id: string; value: string }>(
      "SELECT id, value FROM user_memory WHERE value NOT LIKE 'v1:%'",
    );
    for (const row of plaintextMemory) {
      await dbRun("UPDATE user_memory SET value = ? WHERE id = ?", [protect(row.value), row.id]);
    }
  }
}

// ─── Rules CRUD ───────────────────────────────────────────────────────────────
export async function getUserRules(userId: string, scope = "global"): Promise<string[]> {
  const rows = await dbAll<{ rule: string }>(
    "SELECT rule FROM user_rules WHERE user_id = ? AND scope = ? AND enabled = 1 ORDER BY created_at ASC",
    [userId, scope]
  );
  return rows.map((r) => unprotect(r.rule)).filter(Boolean);
}

export async function addUserRule(userId: string, rule: string, scope = "global"): Promise<string> {
  const id = uuidv4();
  await dbRun(
    "INSERT INTO user_rules (id, user_id, scope, rule) VALUES (?, ?, ?, ?)",
    [id, userId, scope, protect(rule.trim())]
  );
  return id;
}

export async function deleteUserRule(userId: string, ruleId: string): Promise<void> {
  await dbRun("DELETE FROM user_rules WHERE id = ? AND user_id = ?", [ruleId, userId]);
}

export async function clearUserRules(userId: string, scope = "global"): Promise<void> {
  await dbRun("DELETE FROM user_rules WHERE user_id = ? AND scope = ?", [userId, scope]);
}

// ─── Memory CRUD ──────────────────────────────────────────────────────────────
export async function getUserMemory(userId: string): Promise<Record<string, string>> {
  const rows = await dbAll<{ key: string; value: string; expires_at: string | null }>(
    `SELECT key, value, expires_at FROM user_memory
     WHERE user_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return Object.fromEntries(rows.map((r) => [r.key, unprotect(r.value)]).filter(([, value]) => value));
}

export async function setMemory(userId: string, key: string, value: string, ttlDays?: number): Promise<void> {
  const expires = ttlDays ? new Date(Date.now() + ttlDays * 86400_000).toISOString() : null;
  await dbRun(
    `INSERT INTO user_memory (id, user_id, key, value, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    [uuidv4(), userId, key, protect(value), expires]
  );
}

export async function deleteMemory(userId: string, key: string): Promise<void> {
  await dbRun("DELETE FROM user_memory WHERE user_id = ? AND key = ?", [userId, key]);
}

export async function clearMemory(userId: string): Promise<void> {
  await dbRun("DELETE FROM user_memory WHERE user_id = ?", [userId]);
}

// ─── Detect #remember / #forget commands in user message ─────────────────────
const REMEMBER_RE = /#remember\s+(.+?)(?:\n|$)/gi;
const FORGET_RE   = /#forget\s+(.+?)(?:\n|$)/gi;

export async function processMemoryCommands(
  userId: string,
  text: string
): Promise<{ remembered: string[]; forgotten: string[] }> {
  const remembered: string[] = [];
  const forgotten:  string[] = [];
  let m: RegExpExecArray | null;

  while ((m = REMEMBER_RE.exec(text)) !== null) {
    const fact = m[1].trim();
    // Auto-extract key=value or just store as fact_N
    const kvMatch = fact.match(/^(.+?)[=:]\s*(.+)$/);
    if (kvMatch) {
      await setMemory(userId, kvMatch[1].trim().toLowerCase().replace(/\s+/g, "_"), kvMatch[2].trim());
      remembered.push(fact);
    } else {
      await setMemory(userId, `fact_${Date.now()}`, fact, 30);
      remembered.push(fact);
    }
  }

  FORGET_RE.lastIndex = 0;
  while ((m = FORGET_RE.exec(text)) !== null) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    await deleteMemory(userId, key);
    forgotten.push(key);
  }

  return { remembered, forgotten };
}

// ─── Build system memory prefix ───────────────────────────────────────────────
export async function buildMemoryPrefix(userId: string, projectScope?: string): Promise<string> {
  const [globalRules, memory] = await Promise.all([
    getUserRules(userId, "global"),
    getUserMemory(userId),
  ]);

  let projectRules: string[] = [];
  if (projectScope) {
    projectRules = await getUserRules(userId, `project:${projectScope}`);
  }

  const parts: string[] = [];

  if (globalRules.length > 0) {
    parts.push(`## User Rules (always follow)\n${globalRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`);
  }

  if (projectRules.length > 0) {
    parts.push(`## Project Rules\n${projectRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`);
  }

  const memEntries = Object.entries(memory);
  if (memEntries.length > 0) {
    parts.push(`## Remembered Facts\n${memEntries.map(([k, v]) => `- **${k}**: ${v}`).join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "";
}

// ─── Inject memory into request ───────────────────────────────────────────────
export async function enrichWithMemory(
  body: any,
  userId: string,
  projectScope?: string
): Promise<{ body: any; prefix: string }> {
  // Process any #remember / #forget commands first
  const lastUser = (body.messages ?? []).slice().reverse().find((m: any) => m.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content
    : Array.isArray(lastUser?.content) ? lastUser.content.map((p: any) => p.text ?? "").join("") : "";

  await processMemoryCommands(userId, userText);

  const prefix = await buildMemoryPrefix(userId, projectScope);
  if (!prefix) return { body, prefix: "" };

  const messages = [...(body.messages ?? [])];
  const sysIdx = messages.findIndex((m: any) => m.role === "system");
  if (sysIdx >= 0) {
    messages[sysIdx] = { ...messages[sysIdx], content: prefix + "\n\n---\n\n" + (messages[sysIdx].content ?? "") };
  } else {
    messages.unshift({ role: "system", content: prefix });
  }

  console.log(`[Memory] Injected ${Math.ceil(prefix.length / 4)} tokens | rules:${(prefix.match(/\d+\./g) ?? []).length}`);
  return { body: { ...body, messages }, prefix };
}
