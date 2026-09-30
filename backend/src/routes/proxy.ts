import { Router, Request, Response, NextFunction } from "express";
import { authenticateApiKey, handleChatCompletions } from "../services/aiProxy.js";
import { quotaGuard } from "../services/quotaGuard.js";
import { MODEL_ALIASES, DEFAULT_CHAT_MODEL, DEFAULT_AUTOCOMPLETE } from "../config.js";
import { resolveModelId } from "../config.js";
import { getAllModels, canPlanUseModel, resolveModel } from "../services/modelRegistry.js";
import { sanitizePayload } from "../services/secretSanitizer.js";
import { handleFimAutocomplete } from "../services/fimEngine.js";
import { handleQuickFix } from "../services/quickFixEngine.js";

export const proxyRouter = Router();

// ─── Auth + Subscription Middleware ──────────────────────────────────────────
async function requireValidSubscriber(req: Request, res: Response, next: NextFunction) {
  const clientIp = (req.headers["cf-connecting-ip"] as string) || (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() || req.ip;
  const user = await authenticateApiKey(req.headers.authorization, clientIp);

  if (!user) {
    return res.status(401).json({
      error: {
        message: "Invalid, expired, or suspended VynorAI API Key. Provide: Authorization: Bearer vynor_live_...",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  }

  if (!user.hasActiveSubscription) {
    return res.status(403).json({
      error: {
        message: `Active subscription required. Subscribe at ${process.env.BASE_URL || "http://localhost:3000"}/dashboard.html`,
        type: "permission_error",
        code: "subscription_inactive",
        plan: "free",
      },
    });
  }

  (req as any).user = user;
  next();
}

// ─── GET /v1/models (Dynamic Single Source of Truth based on User Plan) ───────
proxyRouter.get("/models", async (req: Request, res: Response) => {
  try {
    const user = await authenticateApiKey(req.headers.authorization);
    const userPlan = user?.subscriptionPlan || "free";
    const allModels = await getAllModels();


    const data = await Promise.all(
      allModels.map(async (m) => {
        const allowed = await canPlanUseModel(userPlan, m.id);
        const isThinking =
          m.id.includes("r1") ||
          m.id.includes("sonnet") ||
          m.id.includes("opus") ||
          m.id.includes("pro");
        const badge = isThinking ? "Thinking" : "Fast";

        return {
          id: m.id,
          openrouter_id: m.openrouter_id,
          object: "model",
          name: m.display_name,
          badge,
          min_plan: m.min_plan,
          context_window: m.context_window,
          is_locked: !allowed,
          is_default_chat: m.is_default_chat === 1,
          is_default_autocomplete: m.is_default_autocomplete === 1,
          owned_by: "vynorai",
        };
      })
    );

    res.json({ object: "list", data });
  } catch (err: any) {
    console.error("[VynorAI] /models dynamic query error, falling back:", err.message);
    const fallback = Object.entries(MODEL_ALIASES).map(([alias, openRouterId]) => ({
      id: alias,
      openrouter_id: openRouterId,
      object: "model",
      created: 1740000000,
      owned_by: "vynorai",
    }));
    res.json({ object: "list", data: fallback });
  }
});

import { proxyRateLimiter } from "../middleware/security.js";

// ─── POST /v1/chat/completions ────────────────────────────────────────────────
proxyRouter.post(
  "/chat/completions",
  requireValidSubscriber,
  proxyRateLimiter,
  quotaGuard,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const userPlan = user?.subscriptionPlan || "free";
      const requestedModel = req.body.model || DEFAULT_CHAT_MODEL;

      // ── Model Plan Restriction Guard ─────────────────────────────────────────
      const allowed = await canPlanUseModel(userPlan, requestedModel);
      if (!allowed) {
        const resolved = await resolveModel(requestedModel);
        const minPlan = resolved?.min_plan || "pro";
        return res.status(403).json({
          error: {
            message: `Model "${requestedModel}" requires the ${minPlan.toUpperCase()} subscription plan. Your current plan is ${userPlan.toUpperCase()}.`,
            type: "plan_restriction",
            code: "model_locked",
            requestedModel,
            currentPlan: userPlan,
            requiredPlan: minPlan,
            upgradeUrl: "http://localhost:3000/#pricing",
          },
        });
      }

      // ── Privacy Shield & In-Flight Secret Sanitizer ─────────────────────────
      const { sanitized, scrubbedCount, scrubbedTypes } = sanitizePayload(req.body);
      res.setHeader("X-VynorAI-Privacy-Shield", "Active");
      if (scrubbedCount > 0) {
        res.setHeader("X-VynorAI-Scrubbed-Secrets", String(scrubbedCount));
        console.log(`[Privacy Shield 🛡️] Scrubbed ${scrubbedCount} secret(s) (${scrubbedTypes.join(", ")}) for ${user.email}`);
      }

      await handleChatCompletions(user, sanitized, res);
    } catch (err: any) {
      console.error("[VynorAI] Proxy error:", err.message);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "Internal proxy error: " + err.message } });
    }
  }
);

// ─── POST /v1/fim/completions (Ultra-Fast Inline Tab Autocomplete) ────────────
proxyRouter.post(
  "/fim/completions",
  requireValidSubscriber,
  proxyRateLimiter,
  quotaGuard,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await handleFimAutocomplete(user, req.body, res);
    } catch (err: any) {
      console.error("[VynorAI] FIM Autocomplete error:", err.message);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "FIM Autocomplete error: " + err.message } });
    }
  }
);

// ─── POST /v1/agent/fix-error (Terminal Compiler & Stack Trace Quick-Fix) ──────
proxyRouter.post(
  "/agent/fix-error",
  requireValidSubscriber,
  proxyRateLimiter,
  quotaGuard,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await handleQuickFix(user, req.body, res);
    } catch (err: any) {
      console.error("[VynorAI] QuickFix error:", err.message);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "QuickFix error: " + err.message } });
    }
  }
);

// ─── GET /v1/usage ────────────────────────────────────────────────────────────
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";
import { getPlan, getUpgradePlan } from "../config.js";

proxyRouter.get("/usage", requireValidSubscriber, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const planId = user.subscriptionPlan || "free";
  const plan = getPlan(planId);
  const monthlyUsage = await getOrInitMonthlyUsage(user.id, planId);
  const upgradePlan = getUpgradePlan(planId);

  res.json({
    plan: planId,
    displayName: plan.displayName,
    cycle: {
      periodStart: monthlyUsage.period_start,
      periodEnd: monthlyUsage.period_end,
      lastResetAt: monthlyUsage.last_reset_at,
    },
    tokens: {
      used: monthlyUsage.used_tokens,
      limit: monthlyUsage.max_tokens,
      percentUsed: Math.min(100, Math.round((monthlyUsage.used_tokens / Math.max(1, monthlyUsage.max_tokens)) * 100)),
    },
    requests: {
      used: monthlyUsage.used_requests,
      limit: plan.monthlyRequests,
      percentUsed: Math.min(100, Math.round((monthlyUsage.used_requests / Math.max(1, plan.monthlyRequests)) * 100)),
    },
    validUntil: user.validUntil,
    upgradeUrl: plan.upgradeUrl,
    upgradePlan: upgradePlan
      ? {
          id: upgradePlan.id,
          displayName: upgradePlan.displayName,
          priceLKR: upgradePlan.priceLKR,
          monthlyTokens: upgradePlan.monthlyTokens,
          monthlyRequests: upgradePlan.monthlyRequests,
        }
      : null,
  });
});

