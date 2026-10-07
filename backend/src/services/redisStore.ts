import { createClient, RedisClientType } from "redis";
import crypto from "node:crypto";

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;
let lastError: string | null = null;
let nextRetryAt = 0;
const localCacheFillLocks = new Map<
  string,
  { token: string; expiresAt: number }
>();

export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function redisStatus(): {
  configured: boolean;
  ready: boolean;
  lastError: string | null;
} {
  return {
    configured: redisConfigured(),
    ready: Boolean(client?.isReady),
    lastError,
  };
}

export async function getRedis(): Promise<RedisClientType | null> {
  if (!redisConfigured()) return null;
  if (client?.isReady) return client;
  if (Date.now() < nextRetryAt) return null;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      if (!client) {
        client = createClient({
          url: process.env.REDIS_URL,
          socket: {
            connectTimeout: 3_000,
            reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, 3_000),
          },
        });
        client.on("error", (error) => {
          lastError =
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Redis client error";
        });
        client.on("ready", () => {
          lastError = null;
        });
      }
      if (!client.isOpen) await client.connect();
      return client.isReady ? client : null;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Redis connection failed";
      nextRetryAt = Date.now() + 30_000;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** Atomic fixed-window counter shared by every API replica. */
export async function incrementRateLimit(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number } | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const result = (await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
     local ttl = redis.call('PTTL', KEYS[1])
     return {count, ttl}`,
    { keys: [`vynor:ratelimit:${key}`], arguments: [String(windowMs)] },
  )) as [number, number];
  return { count: Number(result[0]), ttlMs: Math.max(1, Number(result[1])) };
}

export async function getDistributedCache(key: string): Promise<string | null> {
  const redis = await getRedis();
  return redis ? redis.get(`vynor:response:${key}`) : null;
}

export async function setDistributedCache(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const redis = await getRedis();
  if (redis)
    await redis.set(`vynor:response:${key}`, value, { EX: ttlSeconds });
}

/**
 * Store an answer and its per-user ownership index atomically enough for
 * account deletion. The index has the same TTL as the response, so abandoned
 * members disappear without a separate cleanup job.
 */
export async function setDistributedUserCache(
  key: string,
  userId: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const responseKey = `vynor:response:${key}`;
  const userKey = `vynor:response-user:${userId}`;
  await redis
    .multi()
    .set(responseKey, value, { EX: ttlSeconds })
    .sAdd(userKey, responseKey)
    .expire(userKey, ttlSeconds)
    .exec();
}

/** Delete every distributed exact-cache answer owned by one user. */
export async function deleteDistributedUserCache(
  userId: string,
): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  const userKey = `vynor:response-user:${userId}`;
  const keys = await redis.sMembers(userKey);
  for (let i = 0; i < keys.length; i += 500)
    await redis.del(keys.slice(i, i + 500));
  await redis.del(userKey);
  return keys.length;
}

/** A short lease used to coalesce identical cache misses across API replicas. */
export async function acquireCacheFillLock(
  key: string,
  ttlMs: number,
): Promise<string | null | undefined> {
  const redis = await getRedis();
  const token = crypto.randomUUID();
  if (!redis) {
    const existing = localCacheFillLocks.get(key);
    if (existing && existing.expiresAt > Date.now()) return null;
    const localToken = `local:${token}`;
    localCacheFillLocks.set(key, {
      token: localToken,
      expiresAt: Date.now() + ttlMs,
    });
    return localToken;
  }
  const result = await redis.set(`vynor:cache-fill:${key}`, token, {
    NX: true,
    PX: ttlMs,
  });
  return result === "OK" ? token : null;
}

/** Release only the lease created by this request. */
export async function releaseCacheFillLock(
  key: string,
  token: string,
): Promise<void> {
  if (token.startsWith("local:")) {
    if (localCacheFillLocks.get(key)?.token === token)
      localCacheFillLocks.delete(key);
    return;
  }
  const redis = await getRedis();
  if (!redis) return;
  await redis.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then
       return redis.call('DEL', KEYS[1])
     end
     return 0`,
    {
      keys: [`vynor:cache-fill:${key}`],
      arguments: [token],
    },
  );
}

export async function cacheFillLockHeld(
  key: string,
): Promise<boolean | undefined> {
  const redis = await getRedis();
  if (!redis) {
    const local = localCacheFillLocks.get(key);
    if (!local) return false;
    if (local.expiresAt <= Date.now()) {
      localCacheFillLocks.delete(key);
      return false;
    }
    return true;
  }
  return (await redis.exists(`vynor:cache-fill:${key}`)) === 1;
}

export interface DistributedSlot {
  scope: string;
  token: string;
}

/**
 * Acquire a distributed expiring semaphore slot. A sorted set makes stale
 * leases self-healing when a worker crashes before release.
 */
export async function acquireDistributedSlot(
  scope: string,
  limit: number,
  leaseMs: number,
): Promise<DistributedSlot | null | undefined> {
  const redis = await getRedis();
  if (!redis) return undefined;
  const key = `vynor:slots:${scope}`;
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await redis.eval(
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
     local count = redis.call('ZCARD', KEYS[1])
     if count >= tonumber(ARGV[2]) then return 0 end
     redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
     redis.call('PEXPIRE', KEYS[1], ARGV[5])
     return 1`,
    {
      keys: [key],
      arguments: [
        String(now),
        String(Math.max(1, limit)),
        String(now + leaseMs),
        token,
        String(leaseMs * 2),
      ],
    },
  );
  return Number(result) === 1 ? { scope, token } : null;
}

export async function releaseDistributedSlot(
  slot: DistributedSlot,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.zRem(`vynor:slots:${slot.scope}`, slot.token);
}

export async function renewDistributedSlot(
  slot: DistributedSlot,
  leaseMs: number,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  const key = `vynor:slots:${slot.scope}`;
  const renewed = await redis.eval(
    `if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
       redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
       redis.call('PEXPIRE', KEYS[1], ARGV[3])
       return 1
     end
     return 0`,
    {
      keys: [key],
      arguments: [
        slot.token,
        String(Date.now() + leaseMs),
        String(leaseMs * 2),
      ],
    },
  );
  return Number(renewed) === 1;
}
