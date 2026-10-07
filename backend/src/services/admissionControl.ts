import {
  acquireDistributedSlot,
  releaseDistributedSlot,
  renewDistributedSlot,
  type DistributedSlot,
} from "./redisStore.js";

const DEFAULT_GLOBAL_LIMIT = 64;
const DEFAULT_PROVIDER_LIMIT = 48;
const DEFAULT_WAIT_MS = 750;
const SLOT_LEASE_MS = 180_000;

const localCounts = new Map<string, number>();

export interface AdmissionLease {
  release(): Promise<void>;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function takeLocal(scopes: Array<[string, number]>): AdmissionLease | null {
  if (scopes.some(([scope, limit]) => (localCounts.get(scope) || 0) >= limit))
    return null;
  for (const [scope] of scopes)
    localCounts.set(scope, (localCounts.get(scope) || 0) + 1);
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      for (const [scope] of scopes) {
        const next = Math.max(0, (localCounts.get(scope) || 1) - 1);
        if (next === 0) localCounts.delete(scope);
        else localCounts.set(scope, next);
      }
    },
  };
}

async function releaseSlots(slots: DistributedSlot[]): Promise<void> {
  await Promise.allSettled(slots.map((slot) => releaseDistributedSlot(slot)));
}

/**
 * Bound upstream calls across both API replicas. Redis is authoritative; the
 * process-local fallback preserves a safe ceiling while Redis is degraded.
 */
export async function acquireProviderAdmission(
  provider: string,
  options: {
    globalLimit?: number;
    providerLimit?: number;
    waitMs?: number;
  } = {},
): Promise<AdmissionLease | null> {
  const globalLimit =
    options.globalLimit ??
    positiveInt(process.env.AI_MAX_CONCURRENT, DEFAULT_GLOBAL_LIMIT);
  const providerLimit =
    options.providerLimit ??
    positiveInt(process.env.AI_PROVIDER_MAX_CONCURRENT, DEFAULT_PROVIDER_LIMIT);
  const waitMs =
    options.waitMs ??
    positiveInt(process.env.AI_ADMISSION_WAIT_MS, DEFAULT_WAIT_MS);
  const scopes: Array<[string, number]> = [
    ["ai-global", globalLimit],
    [`ai-provider:${provider}`, providerLimit],
  ];
  const deadline = Date.now() + waitMs;

  do {
    const slots: DistributedSlot[] = [];
    let redisUnavailable = false;
    for (const [scope, limit] of scopes) {
      const slot = await acquireDistributedSlot(
        scope,
        limit,
        SLOT_LEASE_MS,
      ).catch(() => undefined);
      if (slot === undefined) {
        redisUnavailable = true;
        break;
      }
      if (slot === null) break;
      slots.push(slot);
    }

    if (slots.length === scopes.length) {
      let released = false;
      const heartbeat = setInterval(() => {
        void Promise.allSettled(
          slots.map((slot) => renewDistributedSlot(slot, SLOT_LEASE_MS)),
        );
      }, SLOT_LEASE_MS / 3);
      heartbeat.unref();
      return {
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          await releaseSlots(slots);
        },
      };
    }
    await releaseSlots(slots);

    if (redisUnavailable) {
      const local = takeLocal(scopes);
      if (local) return local;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) =>
      setTimeout(resolve, 125 + Math.random() * 125),
    );
  } while (true);
}

/** Test-only visibility without exposing request or tenant data. */
export function localAdmissionCount(scope: string): number {
  return localCounts.get(scope) || 0;
}
