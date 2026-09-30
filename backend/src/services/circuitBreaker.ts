/**
 * VynorAI Circuit Breaker + Provider Health Monitor
 * 
 * Works like an electrical circuit breaker:
 *  CLOSED   → requests flow normally
 *  OPEN     → provider is broken, fail fast (no wasted latency)
 *  HALF_OPEN→ test one request – if passes, reset to CLOSED
 * 
 * Users NEVER see a raw provider error – we always failover silently.
 */

import { ProviderID } from "../config.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitStats {
  state:          CircuitState;
  failures:       number;
  successes:      number;
  lastFailure:    number;   // epoch ms
  lastSuccess:    number;
  totalRequests:  number;
  avgLatencyMs:   number;
  openedAt:       number;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────
const FAILURE_THRESHOLD    = 3;     // consecutive failures before OPEN
const RECOVERY_TIMEOUT_MS  = 30_000; // 30s before HALF_OPEN test
const HALF_OPEN_SUCCESS_NEEDED = 1; // 1 success re-closes circuit

// ─── Per-Provider State ───────────────────────────────────────────────────────
const circuits = new Map<ProviderID, CircuitStats>();

function getCircuit(provider: ProviderID): CircuitStats {
  if (!circuits.has(provider)) {
    circuits.set(provider, {
      state: "CLOSED",
      failures: 0,
      successes: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
      totalRequests: 0,
      avgLatencyMs: 0,
      openedAt: 0,
    });
  }
  return circuits.get(provider)!;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if this provider can accept requests right now */
export function canUseProvider(provider: ProviderID): boolean {
  const c = getCircuit(provider);

  if (c.state === "CLOSED") return true;

  if (c.state === "OPEN") {
    // Check recovery timeout
    if (Date.now() - c.openedAt >= RECOVERY_TIMEOUT_MS) {
      c.state = "HALF_OPEN";
      console.log(`[Circuit ${provider}] → HALF_OPEN (testing recovery)`);
      return true;
    }
    return false;
  }

  // HALF_OPEN – allow one probe
  return true;
}

/** Record a successful call to a provider */
export function recordSuccess(provider: ProviderID, latencyMs: number) {
  const c = getCircuit(provider);
  c.totalRequests++;
  c.successes++;
  c.failures = 0;
  c.lastSuccess = Date.now();
  c.avgLatencyMs = Math.round((c.avgLatencyMs * 0.8) + (latencyMs * 0.2));

  if (c.state === "HALF_OPEN") {
    if (c.successes >= HALF_OPEN_SUCCESS_NEEDED) {
      c.state = "CLOSED";
      console.log(`[Circuit ${provider}] ✅ CLOSED (recovered)`);
    }
  }
}

/** Record a failed call to a provider */
export function recordFailure(provider: ProviderID, reason: string) {
  const c = getCircuit(provider);
  c.totalRequests++;
  c.failures++;
  c.successes = 0;
  c.lastFailure = Date.now();

  if (c.state === "HALF_OPEN" || c.failures >= FAILURE_THRESHOLD) {
    c.state = "OPEN";
    c.openedAt = Date.now();
    console.warn(`[Circuit ${provider}] ⚡ OPEN – ${reason} (will retry in ${RECOVERY_TIMEOUT_MS / 1000}s)`);
  }
}

/** Get status snapshot for all providers (used by health endpoint) */
export function getAllCircuitStats(): Record<string, CircuitStats & { uptimePct: string }> {
  const result: Record<string, any> = {};
  circuits.forEach((c, provider) => {
    const uptime = c.totalRequests > 0
      ? ((c.successes / c.totalRequests) * 100).toFixed(1)
      : "100.0";
    result[provider] = { ...c, uptimePct: uptime };
  });
  return result;
}

/** Reset a specific circuit manually (admin use) */
export function resetCircuit(provider: ProviderID) {
  circuits.delete(provider);
  console.log(`[Circuit ${provider}] manually reset`);
}
