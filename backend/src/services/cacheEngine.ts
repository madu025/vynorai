import crypto from "crypto";
import { dbAll, dbGet, dbRun, usingPostgres } from "../db.js";
import {
  decryptCredential,
  encryptCredential,
  encryptionAtRestConfigured,
} from "./credentialVault.js";
import {
  deleteDistributedUserCache,
  cacheFillLockHeld,
  getDistributedCache,
  setDistributedUserCache,
} from "./redisStore.js";

interface CacheEntry {
  responseChunks: any[];
  fullResponse?: string;
  createdAt: number;
  expiresAt: number;
  userId: string;
  bytes: number;
}

// In-Memory L1 Cache with LRU eviction (Fastest, 0ms latency)
const L1_CACHE_MAX_ENTRIES = 500;
const L1_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_ENTRY_MAX_BYTES = 512 * 1024;
export const DISTRIBUTED_CACHE_TTL_SECONDS = 24 * 60 * 60;
const l1Cache = new Map<string, CacheEntry>();
let l1CacheBytes = 0;

export interface CacheOwner {
  userId: string;
  projectId?: string;
}

/**
 * Generate a deterministic SHA-256 fingerprint for any prompt, code context, and model parameters.
 */
export function generateCacheKey(
  scope: { userId: string; projectId?: string; policyVersion?: string },
  model: string,
  messages: any[],
  temperature?: number,
): string {
  // Normalize messages by stripping non-essential fields and trimming whitespace
  const normalized = messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content.trim()
        : JSON.stringify(m.content),
  }));

  const payload = JSON.stringify({
    // Never share model output across users or projects. Prompts frequently
    // contain proprietary source code even when the visible text looks alike.
    userId: scope.userId,
    projectId: scope.projectId || "default",
    policyVersion: scope.policyVersion || "v1",
    model,
    temperature: temperature ?? 0,
    messages: normalized,
  });

  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Check both L1 (RAM) and L2 (SQLite DB) caches.
 * Returns cached chunks if found, or null if miss.
 */
export async function getFromCache(
  cacheKey: string,
  owner?: CacheOwner,
): Promise<CacheEntry | null> {
  // 1. Check L1 In-Memory Cache
  if (l1Cache.has(cacheKey)) {
    const entry = l1Cache.get(cacheKey)!;
    if (entry.expiresAt <= Date.now()) {
      removeL1Entry(cacheKey);
    } else {
      // LRU refresh
      l1Cache.delete(cacheKey);
      l1Cache.set(cacheKey, entry);
      return entry;
    }
  }

  // 2. Check encrypted distributed cache shared across API replicas.
  if (encryptionAtRestConfigured()) {
    try {
      const encrypted = await getDistributedCache(cacheKey);
      const plaintext = decryptCredential(encrypted);
      if (plaintext) {
        const bytes = Buffer.byteLength(plaintext, "utf8");
        if (bytes > CACHE_ENTRY_MAX_BYTES) return null;
        const entry: CacheEntry = {
          responseChunks: JSON.parse(plaintext),
          createdAt: Date.now(),
          expiresAt: Date.now() + DISTRIBUTED_CACHE_TTL_SECONDS * 1000,
          userId: owner?.userId || "distributed",
          bytes,
        };
        setL1Cache(cacheKey, entry);
        return entry;
      }
    } catch (err) {
      console.error(
        "[CacheEngine] Redis read failed; using SQLite fallback:",
        err,
      );
    }
  }

  // 3. Check L2 Persistent SQLite Cache
  if (!encryptionAtRestConfigured()) return null;
  try {
    const row = await dbGet<any>(
      `SELECT response_data, created_at, expires_at, user_id
       FROM cache_entries
       WHERE cache_key = ? AND expires_at > ?`,
      [cacheKey, new Date().toISOString()],
    );

    if (row && row.response_data) {
      const plaintext = decryptCredential(row.response_data);
      if (!plaintext) return null;
      const bytes = Buffer.byteLength(plaintext, "utf8");
      if (bytes > CACHE_ENTRY_MAX_BYTES) return null;
      const parsedChunks = JSON.parse(plaintext);
      const entry: CacheEntry = {
        responseChunks: parsedChunks,
        createdAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        userId: String(row.user_id),
        bytes,
      };

      // Populate L1 cache for subsequent requests
      setL1Cache(cacheKey, entry);
      return entry;
    }
  } catch (err) {
    console.error("[CacheEngine] Error reading L2 cache:", err);
  }

  return null;
}

/** Wait briefly for another replica to finish the same cache miss. */
export async function waitForCacheFill(
  cacheKey: string,
  owner: CacheOwner,
  timeoutMs = 15_000,
): Promise<CacheEntry | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    const local = l1Cache.get(cacheKey);
    if (local && local.expiresAt > Date.now()) return local;
    if (local) removeL1Entry(cacheKey);
    const encrypted = await getDistributedCache(cacheKey);
    const plaintext = decryptCredential(encrypted);
    if (plaintext) {
      const bytes = Buffer.byteLength(plaintext, "utf8");
      if (bytes > CACHE_ENTRY_MAX_BYTES) return null;
      const entry: CacheEntry = {
        responseChunks: JSON.parse(plaintext),
        createdAt: Date.now(),
        expiresAt: Date.now() + DISTRIBUTED_CACHE_TTL_SECONDS * 1000,
        userId: owner.userId,
        bytes,
      };
      setL1Cache(cacheKey, entry);
      return entry;
    }
    const held = await cacheFillLockHeld(cacheKey);
    if (held === false) return null;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  return getFromCache(cacheKey, owner);
}

/**
 * Save response chunks into both L1 (RAM) and L2 (SQLite DB)
 */
export async function saveToCache(
  cacheKey: string,
  chunks: any[],
  owner: CacheOwner,
): Promise<boolean> {
  if (!chunks || chunks.length === 0) return false;

  const serialized = JSON.stringify(chunks);
  const bytes = Buffer.byteLength(serialized, "utf8");
  // One unusually large answer must not evict the useful cache or exhaust
  // Redis/Postgres storage. It can still be returned normally to the caller.
  if (bytes > CACHE_ENTRY_MAX_BYTES) return false;

  const expiresAt = new Date(
    Date.now() + DISTRIBUTED_CACHE_TTL_SECONDS * 1000,
  ).toISOString();

  const entry: CacheEntry = {
    responseChunks: chunks,
    createdAt: Date.now(),
    expiresAt: new Date(expiresAt).getTime(),
    userId: owner.userId,
    bytes,
  };

  // Save to L1
  setL1Cache(cacheKey, entry);

  // Save encrypted copies to shared Redis and the persistent fallback.
  const encrypted = encryptCredential(serialized);
  if (!encrypted) return false;
  const writes = await Promise.allSettled([
    setDistributedUserCache(
      cacheKey,
      owner.userId,
      encrypted,
      DISTRIBUTED_CACHE_TTL_SECONDS,
    ),
    dbRun(
      `INSERT INTO cache_entries
       (cache_key, user_id, project_id, response_data, response_bytes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(cache_key) DO UPDATE SET
       user_id = excluded.user_id,
       project_id = excluded.project_id,
       response_data = excluded.response_data,
       response_bytes = excluded.response_bytes,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`,
      [
        cacheKey,
        owner.userId,
        owner.projectId || "default",
        encrypted,
        bytes,
        expiresAt,
      ],
    ),
  ]);
  for (const write of writes) {
    if (write.status === "rejected")
      console.error("[CacheEngine] Cache write failed:", write.reason);
  }
  return writes.some((write) => write.status === "fulfilled");
}

function setL1Cache(key: string, entry: CacheEntry) {
  if (entry.bytes > CACHE_ENTRY_MAX_BYTES) return;
  if (l1Cache.has(key)) removeL1Entry(key);
  while (
    l1Cache.size >= L1_CACHE_MAX_ENTRIES ||
    l1CacheBytes + entry.bytes > L1_CACHE_MAX_BYTES
  ) {
    const oldestKey = l1Cache.keys().next().value;
    if (!oldestKey) break;
    removeL1Entry(oldestKey);
  }
  l1Cache.set(key, entry);
  l1CacheBytes += entry.bytes;
}

function removeL1Entry(key: string): void {
  const entry = l1Cache.get(key);
  if (!entry) return;
  l1Cache.delete(key);
  l1CacheBytes = Math.max(0, l1CacheBytes - entry.bytes);
}

/** Delete every exact-cache copy owned by a user. */
export async function purgeUserCache(userId: string): Promise<void> {
  for (const [key, entry] of l1Cache) {
    if (entry.userId === userId) removeL1Entry(key);
  }
  await Promise.allSettled([
    deleteDistributedUserCache(userId),
    dbRun("DELETE FROM cache_entries WHERE user_id = ?", [userId]),
  ]);
}

/**
 * Initialize cache table in SQLite
 */
export async function initCacheTable(): Promise<void> {
  if (!usingPostgres) {
    await dbRun(
      `CREATE TABLE IF NOT EXISTS cache_entries (
        cache_key TEXT PRIMARY KEY,
        user_id TEXT,
        project_id TEXT,
        response_data TEXT NOT NULL,
        response_bytes INTEGER NOT NULL DEFAULT 0,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    const columns = new Set(
      (await dbAll<{ name: string }>("PRAGMA table_info(cache_entries)")).map(
        (column) => column.name,
      ),
    );
    const additions: Array<[string, string]> = [
      ["user_id", "TEXT"],
      ["project_id", "TEXT"],
      ["response_bytes", "INTEGER NOT NULL DEFAULT 0"],
      ["expires_at", "DATETIME"],
    ];
    for (const [name, type] of additions) {
      if (!columns.has(name))
        await dbRun(`ALTER TABLE cache_entries ADD COLUMN ${name} ${type}`);
    }
    await dbRun(
      "CREATE INDEX IF NOT EXISTS idx_cache_created ON cache_entries (created_at)",
    );
    await dbRun(
      "CREATE INDEX IF NOT EXISTS idx_cache_user ON cache_entries (user_id)",
    );
    await dbRun(
      "CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries (expires_at)",
    );
  }
  // Preserve the established startup hardening: plaintext entries created
  // before encrypted-at-rest storage are disposable and must not survive.
  // Tenant/TTL migration itself remains add-only; v3 keys cannot address old
  // rows, and the normal retention job removes them without a deploy-time wipe.
  await dbRun("DELETE FROM cache_entries WHERE response_data NOT LIKE 'v1:%'");
}
