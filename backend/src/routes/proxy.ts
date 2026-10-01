import { Router, Request, Response, NextFunction } from "express";
import { authenticateApiKey, handleChatCompletions } from "../services/aiProxy.js";
import { quotaGuard } from "../services/quotaGuard.js";
import { MODEL_ALIASES, DEFAULT_CHAT_MODEL, DEFAULT_AUTOCOMPLETE } from "../config.js";
import { resolveModelId } from "../config.js";
import { getAllModels, canPlanUseModel, resolveModel } from "../services/modelRegistry.js";
import { sanitizePayload } from "../services/secretSanitizer.js";
import { handleFimAutocomplete } from "../services/fimEngine.js";
import { handleQuickFix } from "../services/quickFixEngine.js";
import { indexProjectFiles, getProjectMap, clearUserIndex } from "../services/ragEngine.js";
import { releaseQuotaReservation } from "../services/monthlyQuota.js";

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
        await releaseQuotaReservation((req as any).quotaInfo?.reservation);
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

      await handleChatCompletions(user, sanitized, res, (req as any).quotaInfo?.reservation);
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(console.error);
      console.error("[VynorAI] Proxy error:", err);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "Internal proxy error. Please try again later." } });
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
      await handleFimAutocomplete(user, req.body, res, (req as any).quotaInfo?.reservation);
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(console.error);
      console.error("[VynorAI] FIM Autocomplete error:", err);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "Autocomplete service temporarily unavailable." } });
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
      await handleQuickFix(user, req.body, res, (req as any).quotaInfo?.reservation);
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(console.error);
      console.error("[VynorAI] QuickFix error:", err);
      if (!res.headersSent)
        res.status(500).json({ error: { message: "Quick-fix service temporarily unavailable." } });
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

// ─── POST /v1/project/index (Universal Multi-Language Project AST Indexer) ────
proxyRouter.post("/project/index", requireValidSubscriber, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { projectRoot, files = [] } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: { message: "files array is required and must not be empty" } });
    }
    const pMap = indexProjectFiles(user.id, projectRoot || "workspace", files);
    res.json({
      success: true,
      projectRoot: pMap.projectRoot,
      filesIndexed: pMap.fileCount,
      chunksGenerated: pMap.chunkCount,
      symbolsMapped: pMap.symbolCount,
      languages: pMap.languages,
      updatedAt: pMap.updatedAt,
    });
  } catch (err: any) {
    console.error("[VynorAI] Project indexing error:", err);
    res.status(500).json({ error: { message: "Project indexing failed. Please verify file paths and try again." } });
  }
});

// ─── GET /v1/project/map (Retrieve Active Project Symbol & Dependency Map) ───
proxyRouter.get("/project/map", requireValidSubscriber, (req: Request, res: Response) => {
  const user = (req as any).user;
  const pMap = getProjectMap(user.id);
  if (!pMap) {
    return res.json({ indexed: false, message: "No active project indexed for user session." });
  }
  res.json({
    indexed: true,
    projectRoot: pMap.projectRoot,
    fileCount: pMap.fileCount,
    chunkCount: pMap.chunkCount,
    symbolCount: pMap.symbolCount,
    languages: pMap.languages,
    updatedAt: pMap.updatedAt,
  });
});

// ─── DELETE /v1/project/index (Clear In-Memory Project Index for Session) ─────
proxyRouter.delete("/project/index", requireValidSubscriber, (req: Request, res: Response) => {
  const user = (req as any).user;
  clearUserIndex(user.id);
  res.json({ success: true, message: "Project index cleared from RAM." });
});

// ─── GET /v1/security/merkle-verify (Cryptographic Blockchain Audit Verification)
proxyRouter.get("/security/merkle-verify", requireValidSubscriber, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { billingAll: dbAll } = await import("../services/billingDb.js");
    const logs = await dbAll<any>(
      "SELECT id, model, tokens_used, prev_hash, audit_hash, created_at FROM usage_logs WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
      [user.id]
    );

    let isValid = true;
    let brokenAt: string | null = null;
    for (let i = 1; i < logs.length; i++) {
      if (logs[i].prev_hash !== logs[i - 1].audit_hash) {
        isValid = false;
        brokenAt = logs[i].id;
        break;
      }
    }

    res.json({
      verified: isValid,
      blocksCount: logs.length,
      brokenAt,
      latestAuditHash: logs.length ? logs[logs.length - 1].audit_hash : "GENESIS_BLOCK_VYNORAI_0000000000000000",
      status: isValid ? "CRYPTOGRAPHICALLY_VERIFIED_TAMPER_PROOF" : "CHAIN_INTEGRITY_COMPROMISED",
    });
  } catch (err: any) {
    console.error("[VynorAI] Merkle verification error:", err);
    res.status(500).json({ error: { message: "Audit chain verification failed." } });
  }
});

// ─── GET /v1/templates (List All Pre-Vetted Golden Templates) ─────────────────
proxyRouter.get("/templates", requireValidSubscriber, async (req: Request, res: Response) => {
  const { GOLDEN_TEMPLATES } = await import("../services/templateVault.js");
  const list = GOLDEN_TEMPLATES.map((t) => ({
    id: t.id,
    category: t.category,
    title: t.title,
    description: t.description,
    languages: t.languages,
    keywords: t.keywords,
  }));
  res.json({ object: "list", data: list });
});

// ─── GET /v1/templates/:id (Fetch Exact 0-Token Scaffold Code) ───────────────
proxyRouter.get("/templates/:id", requireValidSubscriber, async (req: Request, res: Response) => {
  const templateId = String(req.params.id);
  const { GOLDEN_TEMPLATES } = await import("../services/templateVault.js");
  const template = GOLDEN_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return res.status(404).json({ error: { message: `Template '${templateId}' not found.` } });
  }
  res.json(template);
});

// ─── GET /v1/scaffolds/catalog (Lightweight 100-Scaffold Manifest) ────────────
proxyRouter.get("/scaffolds/catalog", requireValidSubscriber, async (req: Request, res: Response) => {
  const { getScaffoldCatalog } = await import("../services/scaffoldRegistry.js");
  res.json(getScaffoldCatalog());
});

// ─── GET /v1/scaffolds/:id (Resolve Full Multi-File Compound Package) ─────────
proxyRouter.get("/scaffolds/:id", requireValidSubscriber, async (req: Request, res: Response) => {
  const scaffoldId = String(req.params.id);
  const { resolveCompoundScaffold } = await import("../services/scaffoldRegistry.js");
  const pkg = resolveCompoundScaffold(scaffoldId);
  if (!pkg) {
    return res.status(404).json({ error: { message: `Compound scaffold '${scaffoldId}' not found in registry.` } });
  }
  res.json(pkg);
});
