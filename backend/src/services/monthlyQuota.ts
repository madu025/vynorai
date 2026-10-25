import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  billingAll as dbAll,
  billingGet as dbGet,
  billingRun as dbRun,
} from "./billingDb.js";
import {
  DEFAULT_CHAT_MODEL,
  getPlan,
  getUpgradePlan,
  PlanDefinition,
} from "../config.js";
import { canPlanUseModel } from "./modelRegistry.js";
import { creditWeight, isoDate, TOKEN_TYPE_WEIGHTS } from "./billingPolicy.js";
import { sliceFimContext } from "./fimContext.js";
import {
  reconcileStaleM365Reservations,
  releaseM365Reservation,
  settleM365Reservation,
  topUpM365Reservation,
} from "./m365QuotaLedger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 30;

/**
 * One billing cycle. `max_tokens` / `used_tokens` are measured in credits
 * (see billingPolicy.ts). `max_tokens` = plan allowance + `bonus_tokens`.
 */
export interface MonthlyUsageRow {
  id: string;
  user_id: string;
  plan_name: string;
  max_tokens: number;
  used_tokens: number;
  used_requests: number;
  bonus_tokens: number;
  bonus_requests: number;
  period_start: string;
  period_end: string;
  last_reset_at: string;
  updated_at: string;
}

/**
 * Which ledger a hold belongs to. Absent or "personal" means the user's own monthly_usage cycle (VS
 * Code and every non-M365 surface). "m365_tenant" means the organisation seat's row in
 * m365_tenant_usage; such a hold never touches subscriptions or monthly_usage.
 */
export type QuotaScope =
  | { kind: "personal" }
  | { kind: "m365_tenant"; tenantId: string; objectId: string };

export interface QuotaReservation {
  /** Row in quota_reservations (or m365_quota_reservations) while the hold is open. */
  id?: string;
  /** The real user the request is attributed to (audit and economics), whatever the scope. */
  userId: string;
  scope?: QuotaScope;
  reservedTokens: number;
  reservedRequests: number;
  settled: boolean;
  ownerType?: "request" | "background_task";
  ownerId?: string;
}

// ─── Durable holds ─────────────────────────────────────────────────────────
// A hold lived only in the request's memory: if the server restarted
// mid-request it was never settled or released, and the user lost those
// credits for the rest of the cycle. Each open hold is now a row, and
// reconcileStaleReservations() returns holds older than any real request.

/** Longer than any request can run (idle timeout 120s; long agent streams). */
export const STALE_RESERVATION_MS = 30 * 60_000;

async function persistReservation(r: QuotaReservation): Promise<void> {
  r.id = uuidv4();
  try {
    await dbRun(
      "INSERT INTO quota_reservations (id, user_id, tokens, requests, created_at, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        r.id,
        r.userId,
        r.reservedTokens,
        r.reservedRequests,
        new Date().toISOString(),
        r.ownerType || "request",
        r.ownerId || null,
      ],
    );
  } catch (err) {
    // Billing goes on without the safety net rather than failing the request.
    console.warn("[Quota] could not record hold:", (err as Error).message);
    r.id = undefined;
  }
}

/**
 * Close a hold by deleting its row, which doubles as the claim: true when this call owns the hold
 * (settle/release must then move the credits), false when the stale-hold sweeper already refunded
 * it (nothing may be refunded a second time). A hold that was never recorded (no id) is treated as
 * owned, as before.
 */
const STALE_SWEEP_BATCH = 500;
const STALE_SWEEP_MAX_BATCHES = 20;

async function closeReservationRecord(r: QuotaReservation): Promise<boolean> {
  if (!r.id) return true;
  try {
    const result = await dbRun("DELETE FROM quota_reservations WHERE id = ?", [
      r.id,
    ]);
    return result.changes > 0;
  } catch (err) {
    // Rare (the DB just served this request). A row left behind would be
    // refunded again by the reconcile job, so make it visible.
    console.error(
      `[Quota] could not close hold ${r.id}:`,
      (err as Error).message,
    );
    return true;
  }
}

/**
 * Release holds that outlived any request (the server died before settling).
 * Each row is claimed by deleting it first, so two backend instances never
 * refund the same hold twice.
 */
export async function reconcileStaleReservations(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RESERVATION_MS).toISOString();
  let released = 0;
  // After a long outage there can be thousands of stale holds: sweep in bounded batches so one
  // pass never loads them all (each row is still claimed by its own DELETE, so replicas never
  // refund a hold twice). The batch cap keeps one sweep bounded; the next run continues.
  for (let batch = 0; batch < STALE_SWEEP_MAX_BATCHES; batch += 1) {
    const stale = await dbAll<{
      id: string;
      user_id: string;
      tokens: number;
      requests: number;
    }>(
      "SELECT id, user_id, tokens, requests FROM quota_reservations WHERE created_at < ? AND COALESCE(owner_type, 'request') != 'background_task' ORDER BY created_at LIMIT ?",
      [cutoff, STALE_SWEEP_BATCH],
    );
    for (const row of stale) {
      const claimed = await dbRun(
        "DELETE FROM quota_reservations WHERE id = ?",
        [row.id],
      );
      if (claimed.changes === 0) continue;
      await dbRun(
        `UPDATE monthly_usage
       SET used_tokens = MAX(0, used_tokens - ?),
           used_requests = MAX(0, used_requests - ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND period_end >= ?`,
        [Number(row.tokens), Number(row.requests), row.user_id, isoDate(now)],
      );
      released++;
    }
    if (stale.length < STALE_SWEEP_BATCH) break;
  }
  // Tenant-scoped M365 holds are recovered against their own ledger, never the user's cycle.
  released += await reconcileStaleM365Reservations(now);
  await reapStalePendingOrders(now).catch(() => {});
  if (released > 0) {
    console.warn(`[Quota] released ${released} stale hold(s)`);
  }
  return released;
}

/** A checkout that was never paid stops being "pending" after this long. */
export const PENDING_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
/** Unpaid failed orders (no payment id) are deleted after this long. */
export const FAILED_ORDER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Keep the subscriptions table from filling with abandoned checkouts. Old pending orders become
 * 'failed' (never deleted outright: a late but valid IPN may still claim a failed order), and
 * unpaid failed orders are removed after a month. Returns the rows changed.
 */
export async function reapStalePendingOrders(
  now: Date = new Date(),
): Promise<number> {
  const pendingCutoff = new Date(
    now.getTime() - PENDING_ORDER_TTL_MS,
  ).toISOString();
  const failedCutoff = new Date(
    now.getTime() - FAILED_ORDER_RETENTION_MS,
  ).toISOString();
  const aged = await dbRun(
    "UPDATE subscriptions SET status = 'failed' WHERE status = 'pending' AND created_at < ?",
    [pendingCutoff],
  );
  const removed = await dbRun(
    "DELETE FROM subscriptions WHERE status = 'failed' AND payment_id IS NULL AND created_at < ?",
    [failedCutoff],
  );
  return (aged.changes || 0) + (removed.changes || 0);
}

export function scheduleReservationReconcile(): void {
  const run = () => void reconcileStaleReservations().catch(() => {});
  setTimeout(run, 60_000).unref();
  setInterval(run, 10 * 60_000).unref();
}

/**
 * The subscription that defines a user's tier. Top-up orders are excluded:
 * they credit the current cycle and must never become the active plan.
 */
export async function getActiveSubscription<T = any>(
  userId: string,
  excludeOrderId?: string,
): Promise<T | undefined> {
  const nowIso = new Date().toISOString();
  const rows = await dbAll<T & { valid_until: unknown }>(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND valid_until > ? AND plan_name NOT LIKE 'topup%'
       AND (CAST(? AS TEXT) IS NULL OR order_id != ?)
     ORDER BY valid_until DESC LIMIT 10`,
    [userId, nowIso, excludeOrderId ?? null, excludeOrderId ?? null],
  );
  // The SQL compare is textual, so a malformed expiry such as "garbage" sorts after any date and
  // would look active. Only a parseable, future date counts; anything else fails closed.
  const now = Date.now();
  return rows.find((row) => {
    const raw = String(row.valid_until);
    // Date.parse accepts bare years such as "9999"; an expiry must be a full ISO date.
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return false;
    const until = Date.parse(raw);
    return Number.isFinite(until) && until > now;
  }) as T | undefined;
}

function requestLimit(plan: PlanDefinition, usage: MonthlyUsageRow): number {
  return plan.monthlyRequests + (usage.bonus_requests || 0);
}

/**
 * Initialize or get monthly usage for a user.
 * Automatically handles 30-day billing cycle rollover.
 */
export async function getOrInitMonthlyUsage(
  userId: string,
  planName: string = "free",
): Promise<MonthlyUsageRow> {
  const now = new Date();
  const todayStr = isoDate(now);

  // Look for the currently active billing cycle
  let row = await dbGet<MonthlyUsageRow>(
    "SELECT * FROM monthly_usage WHERE user_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
    [userId, todayStr],
  );

  const planDef: PlanDefinition = getPlan(planName);

  if (!row) {
    // New billing cycle initialization
    const periodStart = todayStr;
    const periodEnd = isoDate(new Date(now.getTime() + CYCLE_DAYS * DAY_MS));

    // Carry over unspent top-up bonus tokens from the previous cycle
    const previous = await dbGet<MonthlyUsageRow>(
      "SELECT * FROM monthly_usage WHERE user_id = ? ORDER BY period_end DESC LIMIT 1",
      [userId],
    );
    let bonusTokens = 0;
    let bonusRequests = 0;
    if (previous) {
      const prevPlan = getPlan(previous.plan_name);
      const remainingTokens = Math.max(
        0,
        previous.max_tokens - previous.used_tokens,
      );
      const remainingRequests = Math.max(
        0,
        requestLimit(prevPlan, previous) - previous.used_requests,
      );
      bonusTokens = Math.min(previous.bonus_tokens || 0, remainingTokens);
      bonusRequests = Math.min(previous.bonus_requests || 0, remainingRequests);
    }
    const maxTokens = planDef.monthlyTokens + bonusTokens;

    await dbRun(
      `INSERT INTO monthly_usage
       (id, user_id, plan_name, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
       ON CONFLICT(user_id, period_start) DO NOTHING`,
      [
        uuidv4(),
        userId,
        planDef.id,
        maxTokens,
        bonusTokens,
        bonusRequests,
        periodStart,
        periodEnd,
      ],
    );

    // Another concurrent request may have initialized the same cycle first.
    // Always re-read the canonical row instead of returning synthetic state.
    row = await dbGet<MonthlyUsageRow>(
      "SELECT * FROM monthly_usage WHERE user_id = ? AND period_start = ? LIMIT 1",
      [userId, periodStart],
    );
    if (!row) throw new Error("Failed to initialize monthly quota cycle");
  }

  // Plan changed mid-cycle (e.g. subscription expired). Purchased top-up
  // credits survive the change.
  if (row.plan_name !== planDef.id) {
    const maxTokens = planDef.monthlyTokens + (row.bonus_tokens || 0);
    await dbRun(
      `UPDATE monthly_usage
       SET plan_name = ?, max_tokens = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [planDef.id, maxTokens, row.id],
    );
    row.plan_name = planDef.id;
    row.max_tokens = maxTokens;
  }

  return row;
}

/**
 * Start a fresh billing cycle when a paid plan is activated. The cycle runs
 * from today until the subscription ends (at most 30 days), so one payment
 * can never span two full quota resets. Unused top-up credit carries over.
 */
export async function startPaidCycle(
  userId: string,
  planId: string,
  validUntil: Date,
): Promise<void> {
  const plan = getPlan(planId);
  const now = new Date();
  const today = isoDate(now);
  const periodEnd = isoDate(
    new Date(
      Math.min(validUntil.getTime(), now.getTime() + CYCLE_DAYS * DAY_MS),
    ),
  );

  const active = await dbGet<MonthlyUsageRow>(
    "SELECT * FROM monthly_usage WHERE user_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
    [userId, today],
  );

  let bonusTokens = 0;
  let bonusRequests = 0;
  if (active) {
    const activePlan = getPlan(active.plan_name);
    const remainingTokens = Math.max(0, active.max_tokens - active.used_tokens);
    const remainingRequests = Math.max(
      0,
      requestLimit(activePlan, active) - active.used_requests,
    );
    bonusTokens = Math.min(active.bonus_tokens || 0, remainingTokens);
    bonusRequests = Math.min(active.bonus_requests || 0, remainingRequests);
  }
  const maxTokens = plan.monthlyTokens + bonusTokens;

  if (active && active.period_start === today) {
    // A cycle already started today; reuse it (period_start is unique per user).
    await dbRun(
      `UPDATE monthly_usage
       SET plan_name = ?, max_tokens = ?, used_tokens = 0, used_requests = 0,
           bonus_tokens = ?, bonus_requests = ?, period_end = ?,
           last_reset_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [plan.id, maxTokens, bonusTokens, bonusRequests, periodEnd, active.id],
    );
    return;
  }

  const yesterday = isoDate(new Date(now.getTime() - DAY_MS));
  await dbRun(
    "UPDATE monthly_usage SET period_end = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND period_end >= ?",
    [yesterday, userId, today],
  );
  // UNIQUE(user_id, period_start): a concurrent request may have created today's row between the
  // read above and this write. Upsert so activation never fails (and is never half-done) on that race.
  await dbRun(
    `INSERT INTO monthly_usage
     (id, user_id, plan_name, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
     ON CONFLICT(user_id, period_start) DO UPDATE SET
       plan_name = excluded.plan_name, max_tokens = excluded.max_tokens,
       used_tokens = 0, used_requests = 0,
       bonus_tokens = excluded.bonus_tokens, bonus_requests = excluded.bonus_requests,
       period_end = excluded.period_end,
       last_reset_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [
      uuidv4(),
      userId,
      plan.id,
      maxTokens,
      bonusTokens,
      bonusRequests,
      today,
      periodEnd,
    ],
  );
}

/**
 * Requests that go with some credits at the plan's own ratio (a paid top-up pack is one plan
 * allowance of each, so the ratio is monthlyRequests per monthlyTokens). At least 1 for any credit.
 */
export function proportionalRequests(planId: string, credits: number): number {
  const plan = getPlan(planId);
  if (!(credits > 0) || !(plan.monthlyTokens > 0)) return 0;
  return Math.max(
    1,
    Math.round((credits * plan.monthlyRequests) / plan.monthlyTokens),
  );
}

/**
 * Add purchased or granted credits to the user's current cycle. `requests` is the request
 * allowance that goes with them; when it is left out (an admin "Add tokens"), it follows the
 * user's plan ratio so a user stopped at the request cap is not left blocked.
 * Returns the requests added.
 */
export async function creditTopup(
  userId: string,
  credits: number,
  requests?: number,
): Promise<number> {
  const subscription = await getActiveSubscription<{ plan_name: string }>(
    userId,
  );
  const planName = subscription?.plan_name || "free";
  const usage = await getOrInitMonthlyUsage(userId, planName);
  const addedRequests = requests ?? proportionalRequests(planName, credits);
  await dbRun(
    `UPDATE monthly_usage
     SET max_tokens = max_tokens + ?, bonus_tokens = bonus_tokens + ?,
         bonus_requests = bonus_requests + ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [credits, credits, addedRequests, usage.id],
  );
  return addedRequests;
}

/** Reverse a top-up (e.g. PayHere chargeback). Never drives balances negative. */
export async function reverseTopup(
  userId: string,
  credits: number,
  requests: number,
): Promise<void> {
  // The plan allowance (max_tokens) loses only what is really taken out of the bonus: an old
  // top-up that was already used up or carried over must not eat into the current plan allowance.
  await dbRun(
    `UPDATE monthly_usage
     SET max_tokens = MAX(0, max_tokens - CASE WHEN bonus_tokens < ? THEN bonus_tokens ELSE ? END),
         bonus_tokens = MAX(0, bonus_tokens - ?),
         bonus_requests = MAX(0, bonus_requests - ?), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [credits, credits, credits, requests, userId, isoDate(new Date())],
  );
}

/**
 * Increment usage atomically for the current active billing cycle.
 */
export async function incrementMonthlyUsage(
  userId: string,
  tokensUsed: number,
  requestsUsed: number = 1,
): Promise<{ success: boolean; changes: number }> {
  const todayStr = isoDate(new Date());
  const result = await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = used_tokens + ?,
         used_requests = used_requests + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [tokensUsed, requestsUsed, userId, todayStr],
  );
  return { success: result.changes > 0, changes: result.changes };
}

/**
 * Atomic quota verification & consumption.
 * Eliminates race conditions during concurrent API bursts by combining quota check
 * and credit increment into a single atomic statement.
 */
export async function tryConsumeQuotaAtomic(
  userId: string,
  tokensToConsume: number,
  requestsToConsume: number = 1,
  planName: string = "free",
): Promise<{ allowed: boolean; reason?: string }> {
  const todayStr = isoDate(new Date());

  // Ensure active billing cycle exists
  const usage = await getOrInitMonthlyUsage(userId, planName);
  const plan = getPlan(usage.plan_name);

  // Perform atomic check and update
  const result = await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = used_tokens + ?,
         used_requests = used_requests + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?
       AND period_end >= ?
       AND used_requests + ? <= ? + bonus_requests
       AND used_tokens + ? <= max_tokens`,
    [
      tokensToConsume,
      requestsToConsume,
      userId,
      todayStr,
      requestsToConsume,
      plan.monthlyRequests,
      tokensToConsume,
    ],
  );

  if (result.changes === 0) {
    return { allowed: false, reason: "Monthly credit limit exceeded." };
  }

  return { allowed: true };
}

/** Below this many credits left, a request is refused rather than reserved. */
const MIN_RESERVATION_CREDITS = 1_000;
/**
 * A partial hold takes at most half of what is left (but at least this):
 * holding all of it refused every concurrent request (autocomplete, a second
 * chat) while one over-estimated request was in flight.
 */
const PARTIAL_HOLD_FLOOR = 100_000;

export function partialHold(remaining: number): number {
  return Math.min(
    remaining,
    Math.max(PARTIAL_HOLD_FLOOR, Math.floor(remaining / 2)),
  );
}

/** Reserve the maximum expected request cost before any provider is called. */
export async function reserveQuotaAtomic(
  userId: string,
  planName: string,
  tokensToReserve: number,
  owner?: { type: "request" | "background_task"; id: string },
): Promise<QuotaReservation | null> {
  const reservedTokens = Math.max(1, Math.floor(tokensToReserve));
  const consumed = await tryConsumeQuotaAtomic(
    userId,
    reservedTokens,
    1,
    planName,
  );
  if (consumed.allowed) {
    const reservation: QuotaReservation = {
      userId,
      reservedTokens,
      reservedRequests: 1,
      settled: false,
      ownerType: owner?.type,
      ownerId: owner?.id,
    };
    await persistReservation(reservation);
    return reservation;
  }

  // The estimate assumes no prompt cache, so it is far above what an agent
  // turn really costs (most input is cached at 0.1). With credits left,
  // reserve what remains instead of refusing; the request settles at its
  // actual cost. Only a nearly empty allowance is refused.
  const usage = await getOrInitMonthlyUsage(userId, planName);
  const remaining = Math.floor(usage.max_tokens - usage.used_tokens);
  if (remaining < MIN_RESERVATION_CREDITS) return null;
  const hold = partialHold(remaining);
  const partial = await tryConsumeQuotaAtomic(userId, hold, 1, planName);
  if (!partial.allowed) return null;
  const reservation: QuotaReservation = {
    userId,
    reservedTokens: hold,
    reservedRequests: 1,
    settled: false,
    ownerType: owner?.type,
    ownerId: owner?.id,
  };
  await persistReservation(reservation);
  return reservation;
}

/**
 * Grow a reservation when routing picks a pricier model than the one the
 * middleware reserved for (e.g. Auto → V4 Pro). Returns false — and changes
 * nothing — when the cycle cannot cover it, so the caller can fall back to a
 * cheaper model instead of failing the request.
 */
export async function topUpReservation(
  reservation: QuotaReservation | undefined,
  extraCredits: number,
): Promise<boolean> {
  if (!reservation || reservation.settled) return false;
  const extra = Math.max(0, Math.ceil(extraCredits));
  if (extra === 0) return true;
  if (reservation.scope?.kind === "m365_tenant")
    return topUpM365Reservation(reservation, extra);
  // A hold the stale sweeper already refunded cannot be grown: its credits are no longer reserved,
  // so growing the usage would charge credits no hold row backs.
  if (reservation.id) {
    const grown = await dbRun(
      "UPDATE quota_reservations SET tokens = tokens + ? WHERE id = ?",
      [extra, reservation.id],
    ).catch(() => undefined);
    if (grown && grown.changes === 0) return false;
  }
  const result = await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = used_tokens + ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ? AND used_tokens + ? <= max_tokens`,
    [extra, reservation.userId, isoDate(new Date()), extra],
  );
  if (result.changes === 0) {
    if (reservation.id)
      await dbRun(
        "UPDATE quota_reservations SET tokens = MAX(0, tokens - ?) WHERE id = ?",
        [extra, reservation.id],
      ).catch(() => {});
    return false;
  }
  reservation.reservedTokens += extra;
  return true;
}

/** Replace a conservative reservation with the request's actual credit cost. */
export async function settleQuotaReservation(
  reservation: QuotaReservation | undefined,
  actualCredits: number,
): Promise<void> {
  if (!reservation || reservation.settled) return;
  reservation.settled = true;
  if (reservation.scope?.kind === "m365_tenant")
    return settleM365Reservation(reservation, actualCredits);
  const claimed = await closeReservationRecord(reservation);
  // A cost that is not a finite number must never reach SQL (NaN would write NULL): settle at the
  // reserved amount instead, which is the conservative charge.
  const credits = Number.isFinite(actualCredits)
    ? Math.max(0, Math.floor(actualCredits))
    : reservation.reservedTokens;
  if (!claimed) {
    // The sweeper already gave the whole hold back, so the actual cost is charged in full, once.
    if (credits === 0) return;
    await dbRun(
      `UPDATE monthly_usage
       SET used_tokens = used_tokens + ?,
           used_requests = used_requests + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND period_end >= ?`,
      [
        credits,
        reservation.reservedRequests,
        reservation.userId,
        isoDate(new Date()),
      ],
    );
    return;
  }
  const delta = credits - reservation.reservedTokens;
  // A free answer (cache, template) doesn't count as a request either.
  const requestRefund = credits === 0 ? reservation.reservedRequests : 0;
  if (delta === 0 && requestRefund === 0) return;
  await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = MAX(0, used_tokens + ?),
         used_requests = MAX(0, used_requests - ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [delta, requestRefund, reservation.userId, isoDate(new Date())],
  );
}

/** Release a reservation when dispatch fails before producing a billable result. */
export async function releaseQuotaReservation(
  reservation: QuotaReservation | undefined,
): Promise<void> {
  if (!reservation || reservation.settled) return;
  reservation.settled = true;
  if (reservation.scope?.kind === "m365_tenant")
    return releaseM365Reservation(reservation);
  // Already refunded by the stale-hold sweeper: nothing is left to give back.
  if (!(await closeReservationRecord(reservation))) return;
  await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = MAX(0, used_tokens - ?),
         used_requests = MAX(0, used_requests - ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [
      reservation.reservedTokens,
      reservation.reservedRequests,
      reservation.userId,
      isoDate(new Date()),
    ],
  );
}

/** An attached image costs about this many input tokens, whatever its size. */
const IMAGE_TOKEN_ESTIMATE = 1_500;

export function estimateReservation(req: Request): number {
  const body = req.body || {};
  let chars = 0;
  const collect = (value: unknown) => {
    // A base64 screenshot is not text: counted by length, 1 MB looked like
    // ~333k tokens and refused or locked the whole allowance.
    if (typeof value === "string" && value.startsWith("data:"))
      chars += IMAGE_TOKEN_ESTIMATE * 4;
    else if (typeof value === "string") chars += value.length;
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value as Record<string, unknown>).forEach(collect);
  };
  if (req.path.includes("/fim/") && typeof body.prefix === "string") {
    // Autocomplete only sends the lines around the cursor upstream.
    const sliced = sliceFimContext(body.prefix, String(body.suffix ?? ""));
    collect(sliced.prefix);
    collect(sliced.suffix);
  } else {
    collect(body.messages || body.prompt || body.prefix || body.errorLog || "");
    collect(body.suffix || body.codeContext || "");
  }

  const inputTokens = Math.ceil(chars / 4);
  const routeMax = req.path.includes("/fim/")
    ? 128
    : req.path.includes("/fix-error")
      ? 2048
      : 8192;
  const requestedMax = Number(body.max_tokens);
  const outputTokens = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(Math.floor(requestedMax), routeMax))
    : routeMax;
  // Output is billed at its own (higher) weight; pricing it like input
  // under-reserved heavy turns.
  return Math.ceil(
    (inputTokens * TOKEN_TYPE_WEIGHTS.input +
      outputTokens * TOKEN_TYPE_WEIGHTS.output) *
      creditWeight(body.model || DEFAULT_CHAT_MODEL),
  );
}

/** From this share of the allowance, Auto stops using thinking (saver mode). */
export const SAVER_THRESHOLD = 0.8;

/** How the proxy should treat this request's remaining allowance. */
export interface QuotaContext {
  /** Allowance at or over 80%: keep Auto on cheap, non-thinking tiers. */
  saver?: boolean;
  /** Allowance used up: serve only zero-cost answers, refuse upstream calls. */
  exhausted?: boolean;
  creditError?: unknown;
  /** Internal metering hook used by scoped background-task model relays. */
  onUsage?: (credits: number) => Promise<void> | void;
}

function upgradeOffer(planId: string) {
  const upgrade = getUpgradePlan(planId);
  return upgrade
    ? {
        id: upgrade.id,
        displayName: upgrade.displayName,
        priceLKR: upgrade.priceLKR,
        monthlyTokens: upgrade.monthlyTokens,
        monthlyRequests: upgrade.monthlyRequests,
      }
    : null;
}

/**
 * Middleware: Enforce monthly credit and request limits.
 * Emits actionable Upsell response payload when limits are hit.
 */
export async function monthlyQuotaGuard(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as any).user;
  if (!user) return next();

  try {
    const currentPlanId = user.subscriptionPlan || "free";
    const usage = await getOrInitMonthlyUsage(user.id, currentPlanId);
    const plan = getPlan(usage.plan_name);
    const maxRequests = requestLimit(plan, usage);

    // 1. Check request limits
    if (usage.used_requests >= maxRequests) {
      return res.status(403).json({
        error: {
          message: `Monthly request limit of ${maxRequests.toLocaleString()} reached for plan "${plan.displayName}". Please upgrade to continue coding seamlessly.`,
          type: "quota_exceeded",
          code: "monthly_limit_reached",
          plan: plan.id,
          usedRequests: usage.used_requests,
          maxRequests,
          periodEnd: usage.period_end,
          upgradeUrl: plan.upgradeUrl,
          upgradePlan: upgradeOffer(plan.id),
        },
      });
    }

    // 2. Credit limit. Chat requests are not hard-stopped here: cached and
    //    template answers cost nothing and can still be served. The proxy
    //    refuses only when a request would need a paid upstream call.
    const creditError = {
      error: {
        message: `Your ${usage.max_tokens.toLocaleString()} monthly credits on "${plan.displayName}" are used up. Answers VynorAI already has (cached and template replies) still work; new model requests need more credits. Top up or upgrade to continue.`,
        type: "quota_exceeded",
        code: "monthly_limit_reached",
        plan: plan.id,
        usedTokens: usage.used_tokens,
        maxTokens: usage.max_tokens,
        periodEnd: usage.period_end,
        upgradeUrl: plan.upgradeUrl,
        upgradePlan: upgradeOffer(plan.id),
      },
    };
    const softLimit = req.path.endsWith("/chat/completions");
    const saver =
      usage.max_tokens > 0 &&
      usage.used_tokens / usage.max_tokens >= SAVER_THRESHOLD;
    if (usage.used_tokens >= usage.max_tokens) {
      if (!softLimit) return res.status(403).json(creditError);
      (req as any).quotaInfo = {
        plan,
        usage,
        exhausted: true,
        creditError,
        saver: true,
      };
      return next();
    }

    // 3. Check model entitlement before reserving paid quota.
    const requestedModel = req.body?.model;
    if (requestedModel && !(await canPlanUseModel(plan.id, requestedModel))) {
      return res.status(403).json({
        error: {
          message: `Model "${requestedModel}" is not available on your "${plan.displayName}" plan. Upgrade your plan to access premium models.`,
          type: "tier_restricted",
          code: "model_not_allowed",
          plan: plan.id,
          model: requestedModel,
          upgradeUrl: plan.upgradeUrl,
          upgradePlan: upgradeOffer(plan.id),
        },
      });
    }

    // Reserve quota before an upstream request. This closes the concurrent
    // check-then-increment race that allowed bursts to exceed paid limits.
    const reservation = await reserveQuotaAtomic(
      user.id,
      currentPlanId,
      estimateReservation(req),
    );
    if (!reservation) {
      if (softLimit) {
        (req as any).quotaInfo = {
          plan,
          usage,
          exhausted: true,
          creditError,
          saver: true,
        };
        return next();
      }
      return res.status(403).json({
        error: {
          message: "Insufficient monthly credits for this request.",
          type: "quota_exceeded",
          code: "quota_reservation_failed",
          plan: plan.id,
          periodEnd: usage.period_end,
          upgradeUrl: plan.upgradeUrl,
        },
      });
    }

    // Store quota data on request for downstream use
    (req as any).quotaInfo = {
      plan,
      usage,
      reservation,
      saver,
    };

    next();
  } catch (err: any) {
    console.error("[VynorAI] monthlyQuotaGuard error:", err.message);
    return res.status(503).json({
      error: {
        message: "Quota service temporarily unavailable. Please retry shortly.",
        type: "service_unavailable",
        code: "quota_service_unavailable",
      },
    });
  }
}
