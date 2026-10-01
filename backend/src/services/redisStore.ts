import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;
let lastError: string | null = null;
let nextRetryAt = 0;

export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function redisStatus(): { configured: boolean; ready: boolean; lastError: string | null } {
  return { configured: redisConfigured(), ready: Boolean(client?.isReady), lastError };
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
          lastError = error instanceof Error ? error.message.slice(0, 180) : "Redis client error";
        });
        client.on("ready", () => { lastError = null; });
      }
      if (!client.isOpen) await client.connect();
      return client.isReady ? client : null;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 180) : "Redis connection failed";
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
  const result = await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
     local ttl = redis.call('PTTL', KEYS[1])
     return {count, ttl}`,
    { keys: [`vynor:ratelimit:${key}`], arguments: [String(windowMs)] },
  ) as [number, number];
  return { count: Number(result[0]), ttlMs: Math.max(1, Number(result[1])) };
}

export async function getDistributedCache(key: string): Promise<string | null> {
  const redis = await getRedis();
  return redis ? redis.get(`vynor:response:${key}`) : null;
}

export async function setDistributedCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = await getRedis();
  if (redis) await redis.set(`vynor:response:${key}`, value, { EX: ttlSeconds });
}
