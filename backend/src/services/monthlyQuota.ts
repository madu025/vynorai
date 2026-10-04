import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { billingGet as dbGet, billingRun as dbRun } from "./billingDb.js";
import {
  DEFAULT_CHAT_MODEL,
  getPlan,
  getUpgradePlan,
  PlanDefinition,
} from "../config.js";
import { canPlanUseModel } from "./modelRegistry.js";
import { creditWeight, isoDate } from "./billingPolicy.js";

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

export interface QuotaReservation {
  userId: string;
  reservedTokens: number;
  reservedRequests: number;
  settled: boolean;
}

/**
 * The subscription that defines a user's tier. Top-up orders are excluded:
 * they credit the current cycle and must never become the active plan.
 */
export async function getActiveSubscription<T = any>(
  userId: string,
): Promise<T | undefined> {
  return dbGet<T>(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND valid_until > ? AND plan_name NOT LIKE 'topup%'
     ORDER BY valid_until DESC LIMIT 1`,
    [userId, new Date().toISOString()],
  );
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

    await dbRun(
      `INSERT INTO monthly_usage
       (id, user_id, plan_name, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
       ON CONFLICT(user_id, period_start) DO NOTHING`,
      [
        uuidv4(),
        userId,
        planDef.id,
        planDef.monthlyTokens,
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
  await dbRun(
    `INSERT INTO monthly_usage
     (id, user_id, plan_name, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
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

/** Add purchased or granted credits to the user's current cycle. */
export async function creditTopup(
  userId: string,
  credits: number,
  requests: number,
): Promise<void> {
  const subscription = await getActiveSubscription<{ plan_name: string }>(
    userId,
  );
  const usage = await getOrInitMonthlyUsage(
    userId,
    subscription?.plan_name || "free",
  );
  await dbRun(
    `UPDATE monthly_usage
     SET max_tokens = max_tokens + ?, bonus_tokens = bonus_tokens + ?,
         bonus_requests = bonus_requests + ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [credits, credits, requests, usage.id],
  );
}

/** Reverse a top-up (e.g. PayHere chargeback). Never drives balances negative. */
export async function reverseTopup(
  userId: string,
  credits: number,
  requests: number,
): Promise<void> {
  await dbRun(
    `UPDATE monthly_usage
     SET max_tokens = MAX(0, max_tokens - ?), bonus_tokens = MAX(0, bonus_tokens - ?),
         bonus_requests = MAX(0, bonus_requests - ?), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [credits, credits, requests, userId, isoDate(new Date())],
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

/** Reserve the maximum expected request cost before any provider is called. */
export async function reserveQuotaAtomic(
  userId: string,
  planName: string,
  tokensToReserve: number,
): Promise<QuotaReservation | null> {
  const reservedTokens = Math.max(1, Math.floor(tokensToReserve));
  const consumed = await tryConsumeQuotaAtomic(
    userId,
    reservedTokens,
    1,
    planName,
  );
  if (consumed.allowed)
    return { userId, reservedTokens, reservedRequests: 1, settled: false };

  // The estimate assumes no prompt cache, so it is far above what an agent
  // turn really costs (most input is cached at 0.1). With credits left,
  // reserve what remains instead of refusing; the request settles at its
  // actual cost. Only a nearly empty allowance is refused.
  const usage = await getOrInitMonthlyUsage(userId, planName);
  const remaining = Math.floor(usage.max_tokens - usage.used_tokens);
  if (remaining < MIN_RESERVATION_CREDITS) return null;
  const partial = await tryConsumeQuotaAtomic(userId, remaining, 1, planName);
  if (!partial.allowed) return null;
  return {
    userId,
    reservedTokens: remaining,
    reservedRequests: 1,
    settled: false,
  };
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
  const result = await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = used_tokens + ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ? AND used_tokens + ? <= max_tokens`,
    [extra, reservation.userId, isoDate(new Date()), extra],
  );
  if (result.changes === 0) return false;
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
  const delta =
    Math.max(0, Math.floor(actualCredits)) - reservation.reservedTokens;
  if (delta === 0) return;
  await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = MAX(0, used_tokens + ?), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [delta, reservation.userId, isoDate(new Date())],
  );
}

/** Release a reservation when dispatch fails before producing a billable result. */
export async function releaseQuotaReservation(
  reservation: QuotaReservation | undefined,
): Promise<void> {
  if (!reservation || reservation.settled) return;
  reservation.settled = true;
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

function estimateReservation(req: Request): number {
  const body = req.body || {};
  let chars = 0;
  const collect = (value: unknown) => {
    if (typeof value === "string") chars += value.length;
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value as Record<string, unknown>).forEach(collect);
  };
  collect(body.messages || body.prompt || body.prefix || body.errorLog || "");
  collect(body.suffix || body.codeContext || "");

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
  return Math.ceil(
    (inputTokens + outputTokens) *
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
