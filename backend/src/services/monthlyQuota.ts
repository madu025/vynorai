import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { dbGet, dbRun } from "../db.js";
import { getPlan, getUpgradePlan, PlanDefinition } from "../config.js";

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

/**
 * Initialize or get monthly usage for a user.
 * Automatically handles 30-day billing cycle rollover.
 */
export async function getOrInitMonthlyUsage(userId: string, planName: string = "free"): Promise<MonthlyUsageRow> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let row = await dbGet<MonthlyUsageRow>(
    "SELECT * FROM monthly_usage WHERE user_id = ?",
    [userId]
  );

  const planDef: PlanDefinition = getPlan(planName);

  if (!row) {
    // First time initializing
    const id = uuidv4();
    const periodStart = todayStr;
    const periodEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const periodEnd = periodEndDate.toISOString().slice(0, 10);

    await dbRun(
      `INSERT INTO monthly_usage 
       (id, user_id, plan_name, max_tokens, used_tokens, used_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, userId, planDef.id, planDef.monthlyTokens, periodStart, periodEnd]
    );

    return {
      id,
      user_id: userId,
      plan_name: planDef.id,
      max_tokens: planDef.monthlyTokens,
      used_tokens: 0,
      used_requests: 0,
      period_start: periodStart,
      period_end: periodEnd,
      last_reset_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
  }

  // Check if billing period expired -> auto reset for new 30-day cycle
  if (todayStr > row.period_end) {
    const periodStart = todayStr;
    const periodEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const periodEnd = periodEndDate.toISOString().slice(0, 10);

    await dbRun(
      `UPDATE monthly_usage 
       SET plan_name = ?, max_tokens = ?, used_tokens = 0, used_requests = 0,
           period_start = ?, period_end = ?, last_reset_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [planDef.id, planDef.monthlyTokens, periodStart, periodEnd, userId]
    );

    row.plan_name = planDef.id;
    row.max_tokens = planDef.monthlyTokens;
    row.used_tokens = 0;
    row.used_requests = 0;
    row.period_start = periodStart;
    row.period_end = periodEnd;
  } else if (row.plan_name !== planDef.id) {
    // Plan changed (e.g. upgraded) mid-cycle
    await dbRun(
      `UPDATE monthly_usage 
       SET plan_name = ?, max_tokens = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [planDef.id, planDef.monthlyTokens, userId]
    );
    row.plan_name = planDef.id;
    row.max_tokens = planDef.monthlyTokens;
  }

  return row;
}

/**
 * Increment usage atomically after completion.
 */
export async function incrementMonthlyUsage(
  userId: string,
  tokensUsed: number,
  requestsUsed: number = 1
): Promise<void> {
  await dbRun(
    `UPDATE monthly_usage 
     SET used_tokens = used_tokens + ?, 
         used_requests = used_requests + ?, 
         updated_at = CURRENT_TIMESTAMP 
     WHERE user_id = ?`,
    [tokensUsed, requestsUsed, userId]
  );
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

    // Store quota data on request for downstream use
    (req as any).quotaInfo = {
      plan,
      usage,
    };

    // 3. Check model entitlement for user's tier
    const requestedModel = req.body?.model;
    if (requestedModel) {
      import("../config.js").then(({ isModelAllowedForPlan }) => {
        if (!isModelAllowedForPlan(plan.id, requestedModel)) {
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
        next();
      }).catch(() => next());
      return;
    }

    next();
  } catch (err: any) {

    console.error("[VynorAI] monthlyQuotaGuard error:", err.message);
    next();
  }
}
