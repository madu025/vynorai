import { getRedis } from "./redisStore.js";

const READY_KEY = "vynor:bg:v1:ready";
const PROCESSING_KEY = "vynor:bg:v1:processing";

export async function enqueueBackgroundTask(
  taskId: string,
  highPriority: boolean,
  queuedAt = Date.now(),
): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  const score = (highPriority ? 0 : 1_000_000_000_000_000) + queuedAt;
  await redis.zAdd(READY_KEY, [{ score, value: taskId }]);
}

export async function removeBackgroundTask(taskId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  await redis
    .multi()
    .zRem(READY_KEY, taskId)
    .zRem(PROCESSING_KEY, taskId)
    .exec();
}

export async function claimBackgroundTask(
  workerId: string,
  leaseMs: number,
  maxConcurrency = 2,
): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  const value = (await redis.eval(
    `if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return nil end
     local item = redis.call('ZRANGE', KEYS[1], 0, 0)[1]
     if not item then return nil end
     redis.call('ZREM', KEYS[1], item)
     redis.call('ZADD', KEYS[2], ARGV[1], item)
     redis.call('HSET', KEYS[3], item, ARGV[2])
     return item`,
    {
      keys: [READY_KEY, PROCESSING_KEY, "vynor:bg:v1:workers"],
      arguments: [
        String(Date.now() + leaseMs),
        workerId,
        String(Math.max(1, Math.min(2, maxConcurrency))),
      ],
    },
  )) as string | null;
  return value;
}

export async function renewBackgroundLease(
  taskId: string,
  leaseMs: number,
): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  return (
    (await redis.zAdd(
      PROCESSING_KEY,
      [{ score: Date.now() + leaseMs, value: taskId }],
      { XX: true },
    )) > 0
  );
}

export async function restoreBackgroundLease(
  taskId: string,
  leaseMs: number,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  await redis.zAdd(PROCESSING_KEY, [
    { score: Date.now() + leaseMs, value: taskId },
  ]);
}

export async function queuePosition(taskId: string): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const rank = await redis.zRank(READY_KEY, taskId);
  return rank == null ? null : rank + 1;
}

export async function requeueExpiredBackgroundLeases(): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const expired = await redis.zRangeByScore(PROCESSING_KEY, 0, Date.now());
  for (const taskId of expired) {
    await redis.zRem(PROCESSING_KEY, taskId);
  }
  return expired;
}
