import crypto from "crypto";
import { dbGet, dbRun } from "../db.js";

interface CacheEntry {
  responseChunks: any[];
  fullResponse?: string;
  createdAt: number;
}

// In-Memory L1 Cache with LRU eviction (Fastest, 0ms latency)
const L1_CACHE_MAX_ENTRIES = 500;
const l1Cache = new Map<string, CacheEntry>();

/**
 * Generate a deterministic SHA-256 fingerprint for any prompt, code context, and model parameters.
 */
export function generateCacheKey(model: string, messages: any[], temperature?: number): string {
  // Normalize messages by stripping non-essential fields and trimming whitespace
  const normalized = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content.trim() : JSON.stringify(m.content),
  }));

  const payload = JSON.stringify({
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
export async function getFromCache(cacheKey: string): Promise<CacheEntry | null> {
  // 1. Check L1 In-Memory Cache
  if (l1Cache.has(cacheKey)) {
    const entry = l1Cache.get(cacheKey)!;
    // LRU refresh
    l1Cache.delete(cacheKey);
    l1Cache.set(cacheKey, entry);
    return entry;
  }

  // 2. Check L2 Persistent SQLite Cache
  try {
    const row = await dbGet<any>(
      "SELECT response_data, created_at FROM cache_entries WHERE cache_key = ?",
      [cacheKey]
    );

    if (row && row.response_data) {
      const parsedChunks = JSON.parse(row.response_data);
      const entry: CacheEntry = {
        responseChunks: parsedChunks,
        createdAt: new Date(row.created_at).getTime(),
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

/**
 * Save response chunks into both L1 (RAM) and L2 (SQLite DB)
 */
export async function saveToCache(cacheKey: string, chunks: any[]): Promise<void> {
  if (!chunks || chunks.length === 0) return;

  const entry: CacheEntry = {
    responseChunks: chunks,
    createdAt: Date.now(),
  };

  // Save to L1
  setL1Cache(cacheKey, entry);

  // Save to L2 SQLite asynchronously
  const serialized = JSON.stringify(chunks);
  dbRun(
    `INSERT OR REPLACE INTO cache_entries (cache_key, response_data, created_at) 
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [cacheKey, serialized]
  ).catch((err) => {
    console.error("[CacheEngine] Error saving to L2 cache:", err);
  });
}

function setL1Cache(key: string, entry: CacheEntry) {
  if (l1Cache.size >= L1_CACHE_MAX_ENTRIES) {
    const oldestKey = l1Cache.keys().next().value;
    if (oldestKey) l1Cache.delete(oldestKey);
  }
  l1Cache.set(key, entry);
}

/**
 * Initialize cache table in SQLite
 */
export async function initCacheTable(): Promise<void> {
  await dbRun(
    `CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY,
      response_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_cache_created ON cache_entries (created_at)"
  );
}
