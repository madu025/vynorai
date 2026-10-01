import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { dbGet, dbRun } from "../db.js";
import { getPlan, getUpgradePlan, isModelAllowedForPlan, PlanDefinition } from "../config.js";

export interface MonthlyUsageRow {
  id: string;
  user_id: string;
  plan_name: string;
  max_tokens: number;
  used_tokens: number;
  used_requests: number;
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
 * Initialize or get monthly usage for a user.
 * Automatically handles 30-day billing cycle rollover.
 */
export async function getOrInitMonthlyUsage(userId: string, planName: string = "free"): Promise<MonthlyUsageRow> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Look for the currently active billing cycle
  let row = await dbGet<MonthlyUsageRow>(
    "SELECT * FROM monthly_usage WHERE user_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
    [userId, todayStr]
  );

  const planDef: PlanDefinition = getPlan(planName);

  if (!row) {
    // New billing cycle initialization
    const id = uuidv4();
    const periodStart = todayStr;
    const periodEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const periodEnd = periodEndDate.toISOString().slice(0, 10);

    await dbRun(
      `INSERT OR IGNORE INTO monthly_usage
       (id, user_id, plan_name, max_tokens, used_tokens, used_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, userId, planDef.id, planDef.monthlyTokens, periodStart, periodEnd]
    );

    // Another concurrent request may have initialized the same cycle first.
    // Always re-read the canonical row instead of returning synthetic state.
    row = await dbGet<MonthlyUsageRow>(
      "SELECT * FROM monthly_usage WHERE user_id = ? AND period_start = ? LIMIT 1",
      [userId, periodStart],
    );
    if (!row) throw new Error("Failed to initialize monthly quota cycle");
  }

  // If plan changed mid-cycle (e.g. upgraded)
  if (row.plan_name !== planDef.id) {
    await dbRun(
      `UPDATE monthly_usage 
       SET plan_name = ?, max_tokens = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [planDef.id, planDef.monthlyTokens, row.id]
    );
    row.plan_name = planDef.id;
    row.max_tokens = planDef.monthlyTokens;
  }

  return row;
}

/**
 * Increment usage atomically for the current active billing cycle.
 */
export async function incrementMonthlyUsage(
  userId: string,
  tokensUsed: number,
  requestsUsed: number = 1
): Promise<{ success: boolean; changes: number }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const result = await dbRun(
    `UPDATE monthly_usage 
     SET used_tokens = used_tokens + ?, 
         used_requests = used_requests + ?, 
         updated_at = CURRENT_TIMESTAMP 
     WHERE user_id = ? AND period_end >= ?`,
    [tokensUsed, requestsUsed, userId, todayStr]
  );
  return { success: result.changes > 0, changes: result.changes };
}

/**
 * Atomic quota verification & consumption.
 * Eliminates race conditions during concurrent API bursts by combining quota check
 * and token increment into a single atomic SQLite statement:
 *   UPDATE monthly_usage
 *   SET used_tokens = used_tokens + ?
 *   WHERE user_id = ? AND period_end >= ? AND (max_tokens = 0 OR used_tokens + ? <= max_tokens);
 */
export async function tryConsumeQuotaAtomic(
  userId: string,
  tokensToConsume: number,
  requestsToConsume: number = 1,
  planName: string = "free",
): Promise<{ allowed: boolean; reason?: string }> {
  const todayStr = new Date().toISOString().slice(0, 10);

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
       AND used_requests + ? <= ?
       AND (max_tokens = 0 OR used_tokens + ? <= max_tokens)`,
    [tokensToConsume, requestsToConsume, userId, todayStr, requestsToConsume, plan.monthlyRequests, tokensToConsume]
  );

  if (result.changes === 0) {
    return { allowed: false, reason: "Monthly token limit exceeded." };
  }

  return { allowed: true };
}

/** Reserve the maximum expected request cost before any provider is called. */
export async function reserveQuotaAtomic(
  userId: string,
  planName: string,
  tokensToReserve: number,
): Promise<QuotaReservation | null> {
  const reservedTokens = Math.max(1, Math.floor(tokensToReserve));
  const consumed = await tryConsumeQuotaAtomic(userId, reservedTokens, 1, planName);
  if (!consumed.allowed) return null;
  return { userId, reservedTokens, reservedRequests: 1, settled: false };
}

/** Replace a conservative reservation with the provider's actual usage. */
export async function settleQuotaReservation(
  reservation: QuotaReservation | undefined,
  actualTokens: number,
): Promise<void> {
  if (!reservation || reservation.settled) return;
  reservation.settled = true;
  const delta = Math.max(0, Math.floor(actualTokens)) - reservation.reservedTokens;
  if (delta === 0) return;
  await dbRun(
    `UPDATE monthly_usage
     SET used_tokens = MAX(0, used_tokens + ?), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND period_end >= ?`,
    [delta, reservation.userId, new Date().toISOString().slice(0, 10)],
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
    [reservation.reservedTokens, reservation.reservedRequests, reservation.userId, new Date().toISOString().slice(0, 10)],
  );
}

function estimateReservation(req: Request): number {
  const body = req.body || {};
  let chars = 0;
  const collect = (value: unknown) => {
    if (typeof value === "string") chars += value.length;
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(collect);
  };
  collect(body.messages || body.prompt || body.prefix || body.errorLog || "");
  collect(body.suffix || body.codeContext || "");

  const inputTokens = Math.ceil(chars / 4);
  const routeMax = req.path.includes("/fim/") ? 128 : req.path.includes("/fix-error") ? 2048 : 8192;
  const requestedMax = Number(body.max_tokens);
  const outputTokens = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(Math.floor(requestedMax), routeMax))
    : routeMax;
  return inputTokens + outputTokens;
}

/**
 * Middleware: Enforce monthly token and request limits.
 * Emits actionable Upsell response payload when limits are hit.
 */
export async function monthlyQuotaGuard(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return next();

  try {
    const currentPlanId = user.subscriptionPlan || "free";
    const usage = await getOrInitMonthlyUsage(user.id, currentPlanId);
    const plan = getPlan(usage.plan_name);

    // 1. Check request limits
    if (usage.used_requests >= plan.monthlyRequests) {
      const upgrade = getUpgradePlan(plan.id);
      return res.status(403).json({
        error: {
          message: `Monthly request limit of ${plan.monthlyRequests.toLocaleString()} reached for plan "${plan.displayName}". Please upgrade to continue coding seamlessly.`,
          type: "quota_exceeded",
          code: "monthly_limit_reached",
          plan: plan.id,
          usedRequests: usage.used_requests,
          maxRequests: plan.monthlyRequests,
          periodEnd: usage.period_end,
          upgradeUrl: plan.upgradeUrl,
          upgradePlan: upgrade
            ? {
                id: upgrade.id,
                displayName: upgrade.displayName,
                priceLKR: upgrade.priceLKR,
                monthlyTokens: upgrade.monthlyTokens,
                monthlyRequests: upgrade.monthlyRequests,
              }
            : null,
        },
      });
    }

    // 2. Check token limits
    if (usage.used_tokens >= usage.max_tokens) {
      const upgrade = getUpgradePlan(plan.id);
      return res.status(403).json({
        error: {
          message: `Monthly token limit of ${usage.max_tokens.toLocaleString()} reached for plan "${plan.displayName}". Upgrade your plan to get more tokens instantly.`,
          type: "quota_exceeded",
          code: "monthly_limit_reached",
          plan: plan.id,
          usedTokens: usage.used_tokens,
          maxTokens: usage.max_tokens,
          periodEnd: usage.period_end,
          upgradeUrl: plan.upgradeUrl,
          upgradePlan: upgrade
            ? {
                id: upgrade.id,
                displayName: upgrade.displayName,
                priceLKR: upgrade.priceLKR,
                monthlyTokens: upgrade.monthlyTokens,
                monthlyRequests: upgrade.monthlyRequests,
              }
            : null,
        },
      });
    }

    // 3. Check model entitlement before reserving paid quota.
    const requestedModel = req.body?.model;
    if (requestedModel && !isModelAllowedForPlan(plan.id, requestedModel)) {
      const upgrade = getUpgradePlan(plan.id);
      return res.status(403).json({
        error: {
          message: `Model "${requestedModel}" is not available on your "${plan.displayName}" plan. Upgrade your plan to access premium open models.`,
          type: "tier_restricted",
          code: "model_not_allowed",
          plan: plan.id,
          model: requestedModel,
          upgradeUrl: plan.upgradeUrl,
          upgradePlan: upgrade
            ? {
                id: upgrade.id,
                displayName: upgrade.displayName,
                priceLKR: upgrade.priceLKR,
                monthlyTokens: upgrade.monthlyTokens,
              }
            : null,
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
      return res.status(403).json({
        error: {
          message: "Insufficient monthly quota for this request.",
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
