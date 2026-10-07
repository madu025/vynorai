import { PiiMap } from "../services/piiShield.js";
import { sanitizeText } from "../services/secretSanitizer.js";
import { dbAll, dbRun } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import {
  promptFingerprint,
  taskCreditStats,
} from "../services/routingSignals.js";
import { stripRulesAndPreamble } from "../services/templateVault.js";
import { Router, Request, Response, NextFunction } from "express";
import {
  authenticateApiKey,
  handleChatCompletions,
} from "../services/aiProxy.js";
import { quotaGuard } from "../services/quotaGuard.js";
import {
  MODEL_ALIASES,
  DEFAULT_CHAT_MODEL,
  DEFAULT_AUTOCOMPLETE,
} from "../config.js";
import { resolveModelId } from "../config.js";
import {
  getAllModels,
  canPlanUseModel,
  resolveModel,
} from "../services/modelRegistry.js";
import { sanitizePayload } from "../services/secretSanitizer.js";
import { handleFimAutocomplete } from "../services/fimEngine.js";
import { handleQuickFix } from "../services/quickFixEngine.js";
import {
  indexProjectFiles,
  getProjectMap,
  clearUserIndex,
} from "../services/ragEngine.js";
import { releaseQuotaReservation } from "../services/monthlyQuota.js";
import { creditWeight } from "../services/billingPolicy.js";
import { AUTO_MODEL_ID } from "../services/autoRouter.js";
import { z, validateBody, validateParams } from "../middleware/validate.js";

export const ChatCompletionsBodySchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(z.any()).min(1, "messages must be a non-empty array"),
    stream: z.boolean().optional(),
  })
  .passthrough();

export const FimCompletionsBodySchema = z
  .object({
    prompt: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    model: z.string().optional(),
    max_tokens: z.number().optional(),
    temperature: z.number().optional(),
  })
  .passthrough();

export const QuickFixBodySchema = z
  .object({
    error: z.string({ error: "error is required" }),
    file: z.string().optional(),
    code: z.string().optional(),
    language: z.string().optional(),
  })
  .passthrough();

export const FeedbackBodySchema = z.object({
  signal: z.enum(["helpful", "unhelpful"] as const, {
    error: "signal must be helpful or unhelpful",
  }),
  prompt: z.string().optional().default(""),
});

export const ErrorReportBodySchema = z.object({
  message: z
    .string({ error: "message is required" })
    .min(1, "message is required"),
  source: z.string().optional().default("gui"),
  stack: z.string().optional(),
  client: z.string().optional(),
});

export const ProjectIndexBodySchema = z.object({
  projectRoot: z.string().optional().default("workspace"),
  files: z
    .array(z.any())
    .min(1, "files array is required and must not be empty"),
});

export const ProxyIdParamSchema = z.object({
  id: z.string().min(1, "id is required"),
});

export const proxyRouter = Router();

// ─── Auth + Subscription Middleware ──────────────────────────────────────────
async function requireValidSubscriber(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const clientIp =
    (req.headers["cf-connecting-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
    req.ip;
  const user = await authenticateApiKey(req.headers.authorization, clientIp);

  if (!user) {
    return res.status(401).json({
      error: {
        message:
          "Invalid, expired, or suspended VynorAI API Key. Provide: Authorization: Bearer vynor_live_...",
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
          credit_multiplier: creditWeight(m.id),
          is_default_chat: m.is_default_chat === 1,
          is_default_autocomplete: m.is_default_autocomplete === 1,
          owned_by: "vynorai",
        };
      }),
    );

    // Auto is listed first and is the default: the router picks the model per request.
    const auto = {
      id: AUTO_MODEL_ID,
      openrouter_id: AUTO_MODEL_ID,
      object: "model",
      name: "VynorAI Auto",
      badge: "Auto",
      min_plan: "free",
      context_window: Math.max(
        ...allModels.map((m) => m.context_window),
        32_000,
      ),
      is_locked: false,
      credit_multiplier: creditWeight(AUTO_MODEL_ID),
      is_default_chat: true,
      is_default_autocomplete: false,
      owned_by: "vynorai",
    };
    res.json({
      object: "list",
      data: [auto, ...data.map((m) => ({ ...m, is_default_chat: false }))],
    });
  } catch (err: any) {
    console.error(
      "[VynorAI] /models dynamic query error, falling back:",
      err.message,
    );
    const fallback = Object.entries(MODEL_ALIASES).map(
      ([alias, openRouterId]) => ({
        id: alias,
        openrouter_id: openRouterId,
        object: "model",
        created: 1740000000,
        owned_by: "vynorai",
      }),
    );
    res.json({ object: "list", data: fallback });
  }
});

import { proxyRateLimiter } from "../middleware/security.js";

// ─── POST /v1/chat/completions ────────────────────────────────────────────────
proxyRouter.post(
  "/chat/completions",
  requireValidSubscriber,
  proxyRateLimiter,
  validateBody(ChatCompletionsBodySchema, { shape: "nested" }),
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
      const { sanitized, scrubbedCount, scrubbedTypes } = sanitizePayload(
        req.body,
      );
      res.setHeader("X-VynorAI-Privacy-Shield", "Active");
      if (scrubbedCount > 0) {
        res.setHeader("X-VynorAI-Scrubbed-Secrets", String(scrubbedCount));
        console.log(
          `[Privacy Shield 🛡️] Scrubbed ${scrubbedCount} secret(s) (${scrubbedTypes.join(", ")}) for ${user.email}`,
        );
      }

      // ── Enterprise Air-Gapped Zero-Knowledge Mode ───────────────────────────
      const {
        isAirGappedZkRequested,
        recordZkComplianceAuditLog,
        computeSha256,
      } = await import("../services/enterpriseZkEngine.js");
      const { generateZKUserId } = await import("../services/zkShield.js");

      const isZkMode =
        isAirGappedZkRequested(req.headers) || Boolean(req.body.zkMode);
      if (isZkMode) {
        sanitized.zkMode = true;
        sanitized.store = false;
        res.setHeader("X-VynorAI-ZK-Mode", "Air-Gapped");
        res.setHeader("X-VynorAI-Zero-Retention", "Verified");

        const surrogateId = generateZKUserId(user.id);
        const promptFingerprint = computeSha256(
          JSON.stringify(sanitized.messages || []),
        );
        res.setHeader("X-VynorAI-Prompt-Fingerprint", promptFingerprint);

        recordZkComplianceAuditLog({
          userSurrogateId: surrogateId,
          requestType: "chat_completion",
          action: "ephemeral_chat_completion",
          promptFingerprint,
          filesCount: 0,
        }).catch((err) =>
          console.error("[EnterpriseZK] Audit log error:", err),
        );
      }

      const quotaInfo = (req as any).quotaInfo;
      await handleChatCompletions(
        user,
        sanitized,
        res,
        quotaInfo?.reservation,
        {
          saver: quotaInfo?.saver,
          exhausted: quotaInfo?.exhausted,
          creditError: quotaInfo?.creditError,
        },
      );
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(
        console.error,
      );
      console.error("[VynorAI] Proxy error:", err);
      if (!res.headersSent)
        res.status(500).json({
          error: { message: "Internal proxy error. Please try again later." },
        });
    }
  },
);

// ─── POST /v1/fim/completions & /v1/completions (Ultra-Fast Inline Tab Autocomplete) ──
proxyRouter.post(
  ["/fim/completions", "/completions"],
  requireValidSubscriber,
  proxyRateLimiter,
  validateBody(FimCompletionsBodySchema, { shape: "nested" }),
  quotaGuard,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await handleFimAutocomplete(
        user,
        req.body,
        res,
        (req as any).quotaInfo?.reservation,
      );
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(
        console.error,
      );
      console.error("[VynorAI] FIM Autocomplete error:", err);
      if (!res.headersSent)
        res.status(500).json({
          error: { message: "Autocomplete service temporarily unavailable." },
        });
    }
  },
);

// ─── POST /v1/agent/fix-error (Terminal Compiler & Stack Trace Quick-Fix) ──────
proxyRouter.post(
  "/agent/fix-error",
  requireValidSubscriber,
  proxyRateLimiter,
  validateBody(QuickFixBodySchema, { shape: "nested" }),
  quotaGuard,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await handleQuickFix(
        user,
        req.body,
        res,
        (req as any).quotaInfo?.reservation,
      );
    } catch (err: any) {
      await releaseQuotaReservation((req as any).quotaInfo?.reservation).catch(
        console.error,
      );
      console.error("[VynorAI] QuickFix error:", err);
      if (!res.headersSent)
        res.status(500).json({
          error: { message: "Quick-fix service temporarily unavailable." },
        });
    }
  },
);

// ─── POST /v1/feedback ────────────────────────────────────────────────────────
// Helpful / unhelpful on an answer, linked to the prompt by its keyed hash.
// The prompt text is used only to compute that hash and is not stored.
proxyRouter.post(
  "/feedback",
  requireValidSubscriber,
  validateBody(FeedbackBodySchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { signal, prompt } = req.body;
    const fp = promptFingerprint(user.id, stripRulesAndPreamble(prompt || ""));
    await dbRun(
      "INSERT INTO routing_feedback (id, user_id, prompt_fp, signal) VALUES (?, ?, ?, ?)",
      [uuidv4(), user.id, fp, signal],
    );
    res.json({ ok: true });
  },
);

// ─── POST /v1/errors ──────────────────────────────────────────────────────────
// Opt-in client error reports: message and stack only, scrubbed of secrets
// and personal data before storage. Kept 90 days.
proxyRouter.post(
  "/errors",
  requireValidSubscriber,
  validateBody(ErrorReportBodySchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const scrub = (v: unknown, max: number) =>
      typeof v === "string"
        ? new PiiMap().mask(sanitizeText(v.slice(0, max)).text)
        : null;
    const message = scrub(req.body?.message, 2000);
    if (!message) return res.status(400).json({ error: "message is required" });
    await dbRun(
      "INSERT INTO error_reports (id, user_id, source, message, stack, client) VALUES (?, ?, ?, ?, ?, ?)",
      [
        uuidv4(),
        user.id,
        String(req.body?.source ?? "gui").slice(0, 32),
        message,
        scrub(req.body?.stack, 8000),
        String(req.body?.client ?? "").slice(0, 64) || null,
      ],
    );
    res.json({ ok: true });
  },
);

// ─── GET /v1/usage ────────────────────────────────────────────────────────────
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";
import { getPlan, getUpgradePlan } from "../config.js";

proxyRouter.get(
  "/usage",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const planId = user.subscriptionPlan || "free";
    const plan = getPlan(planId);
    const monthlyUsage = await getOrInitMonthlyUsage(user.id, planId);
    const upgradePlan = getUpgradePlan(planId);
    const requestLimit =
      plan.monthlyRequests + (monthlyUsage.bonus_requests || 0);

    const taskCredits = await taskCreditStats(user.id, (sql, params) =>
      dbAll<{ credits: number }>(sql, params),
    );

    res.json({
      plan: planId,
      displayName: plan.displayName,
      // What this user's prompts typically cost, for a pre-task estimate.
      taskCredits,
      cycle: {
        periodStart: monthlyUsage.period_start,
        periodEnd: monthlyUsage.period_end,
        lastResetAt: monthlyUsage.last_reset_at,
      },
      // Measured in cost-weighted credits (see usageCredits in billingPolicy.ts).
      unit: "credits",
      tokens: {
        used: monthlyUsage.used_tokens,
        limit: monthlyUsage.max_tokens,
        percentUsed: Math.min(
          100,
          Math.round(
            (monthlyUsage.used_tokens / Math.max(1, monthlyUsage.max_tokens)) *
              100,
          ),
        ),
      },
      requests: {
        used: monthlyUsage.used_requests,
        limit: requestLimit,
        percentUsed: Math.min(
          100,
          Math.round(
            (monthlyUsage.used_requests / Math.max(1, requestLimit)) * 100,
          ),
        ),
      },
      bonus: {
        credits: monthlyUsage.bonus_tokens || 0,
        requests: monthlyUsage.bonus_requests || 0,
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
  },
);

// ─── POST /v1/project/index (Universal Multi-Language Project AST Indexer) ────
proxyRouter.post(
  "/project/index",
  requireValidSubscriber,
  validateBody(ProjectIndexBodySchema, { shape: "nested" }),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { projectRoot, files = [] } = req.body;
      const pMap = indexProjectFiles(
        user.id,
        projectRoot || "workspace",
        files,
      );
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
      res.status(500).json({
        error: {
          message:
            "Project indexing failed. Please verify file paths and try again.",
        },
      });
    }
  },
);

// ─── GET /v1/project/map (Retrieve Active Project Symbol & Dependency Map) ───
proxyRouter.get(
  "/project/map",
  requireValidSubscriber,
  (req: Request, res: Response) => {
    const user = (req as any).user;
    const pMap = getProjectMap(user.id);
    if (!pMap) {
      return res.json({
        indexed: false,
        message: "No active project indexed for user session.",
      });
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
  },
);

// ─── DELETE /v1/project/index (Clear In-Memory Project Index for Session) ─────
proxyRouter.delete(
  "/project/index",
  requireValidSubscriber,
  (req: Request, res: Response) => {
    const user = (req as any).user;
    clearUserIndex(user.id);
    res.json({ success: true, message: "Project index cleared from RAM." });
  },
);

// ─── GET /v1/security/merkle-verify (Cryptographic Blockchain Audit Verification)
proxyRouter.get(
  "/security/merkle-verify",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { billingAll: dbAll } = await import("../services/billingDb.js");
      const logs = await dbAll<any>(
        "SELECT id, model, tokens_used, prev_hash, audit_hash, created_at FROM usage_logs WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
        [user.id],
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
        latestAuditHash: logs.length
          ? logs[logs.length - 1].audit_hash
          : "GENESIS_BLOCK_VYNORAI_0000000000000000",
        status: isValid
          ? "CRYPTOGRAPHICALLY_VERIFIED_TAMPER_PROOF"
          : "CHAIN_INTEGRITY_COMPROMISED",
      });
    } catch (err: any) {
      console.error("[VynorAI] Merkle verification error:", err);
      res
        .status(500)
        .json({ error: { message: "Audit chain verification failed." } });
    }
  },
);

// ─── GET /v1/templates (List All Pre-Vetted Golden Templates) ─────────────────
proxyRouter.get(
  "/templates",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
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
  },
);

// ─── GET /v1/templates/:id (Fetch Exact 0-Token Scaffold Code) ───────────────
proxyRouter.get(
  "/templates/:id",
  requireValidSubscriber,
  validateParams(ProxyIdParamSchema, { shape: "nested" }),
  async (req: Request, res: Response) => {
    const templateId = String(req.params.id);
    const { GOLDEN_TEMPLATES } = await import("../services/templateVault.js");
    const template = GOLDEN_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      return res
        .status(404)
        .json({ error: { message: `Template '${templateId}' not found.` } });
    }
    res.json(template);
  },
);

// ─── GET /v1/scaffolds/catalog (Lightweight 100-Scaffold Manifest) ────────────
proxyRouter.get(
  "/scaffolds/catalog",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    const { getScaffoldCatalog } = await import(
      "../services/scaffoldRegistry.js"
    );
    res.json(getScaffoldCatalog());
  },
);

// ─── GET /v1/scaffolds/:id (Resolve Full Multi-File Compound Package) ─────────
proxyRouter.get(
  "/scaffolds/:id",
  requireValidSubscriber,
  validateParams(ProxyIdParamSchema, { shape: "nested" }),
  async (req: Request, res: Response) => {
    const scaffoldId = String(req.params.id);
    const { resolveCompoundScaffold } = await import(
      "../services/scaffoldRegistry.js"
    );
    const pkg = resolveCompoundScaffold(scaffoldId);
    if (!pkg) {
      return res.status(404).json({
        error: {
          message: `Compound scaffold '${scaffoldId}' not found in registry.`,
        },
      });
    }
    res.json(pkg);
  },
);

// ─── POST /v1/diff/apply & POST /v1/diff/preview (High-Speed Speculative Diff) ──
proxyRouter.post(
  ["/diff/apply", "/diff/preview"],
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    const { applySpeculativeDiff } = await import(
      "../services/speculativeDiffEngine.js"
    );
    const { isAirGappedZkRequested, recordZkComplianceAuditLog } = await import(
      "../services/enterpriseZkEngine.js"
    );
    const { generateZKUserId } = await import("../services/zkShield.js");

    const isPreview = req.path.includes("/preview") || Boolean(req.body.dryRun);
    const isZkMode =
      isAirGappedZkRequested(req.headers) || Boolean(req.body.zkMode);
    const diff = typeof req.body.diff === "string" ? req.body.diff : "";
    if (!diff.trim()) {
      return res.status(400).json({
        error: { message: "Missing required 'diff' string in request body." },
      });
    }

    const result = await applySpeculativeDiff(diff, {
      workspaceRoot: req.body.workspaceRoot,
      virtualFiles: req.body.virtualFiles,
      dryRun: isPreview,
      validateSyntax: req.body.validateSyntax ?? true,
      allowFuzzyMatch: req.body.allowFuzzyMatch ?? true,
      zkMode: isZkMode,
    });

    if (isZkMode) {
      res.setHeader("X-VynorAI-ZK-Mode", "Air-Gapped");
      res.setHeader("X-VynorAI-Zero-Retention", "Verified");
      if (result.zkFingerprint?.diffFingerprint) {
        res.setHeader(
          "X-VynorAI-Diff-Fingerprint",
          result.zkFingerprint.diffFingerprint,
        );
      }

      const user = (req as any).user;
      const surrogateId = generateZKUserId(user?.id || "anon");
      recordZkComplianceAuditLog({
        userSurrogateId: surrogateId,
        requestType: isPreview ? "diff_preview" : "diff_apply",
        action: result.success
          ? "speculative_diff_success"
          : `speculative_diff_${result.status}`,
        diffFingerprint: result.zkFingerprint?.diffFingerprint,
        filesCount:
          result.zkFingerprint?.filesCount ?? result.modifiedFiles?.length ?? 0,
        linesAdded: result.linesAdded ?? 0,
        linesDeleted: result.linesDeleted ?? 0,
      }).catch((err) => console.error("[EnterpriseZK] Audit log error:", err));
    }

    if (!result.success) {
      const statusCode =
        result.status === "syntax_error"
          ? 422
          : result.status === "conflict"
            ? 409
            : 500;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  },
);

// ─── GET /v1/zk/compliance-report (SOC2 / ISO27001 Cryptographic Proof) ─────────
proxyRouter.get(
  "/zk/compliance-report",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    const { generateZkComplianceReport } = await import(
      "../services/enterpriseZkEngine.js"
    );
    const { generateZKUserId } = await import("../services/zkShield.js");
    const user = (req as any).user;
    const surrogateId = user?.id ? generateZKUserId(user.id) : undefined;
    const report = await generateZkComplianceReport(surrogateId);
    res.json(report);
  },
);

// ─── POST /v1/zk/verify-chain (Verify Tamper-Evident Merkle Hash Chain) ─────────
proxyRouter.post(
  "/zk/verify-chain",
  requireValidSubscriber,
  async (_req: Request, res: Response) => {
    const { verifyZkAuditChainIntegrity } = await import(
      "../services/enterpriseZkEngine.js"
    );
    const verification = await verifyZkAuditChainIntegrity();
    res.json(verification);
  },
);

// ─── POST /v1/codebase/index (Index Repository Files into Symbol Graph) ──────
proxyRouter.post(
  "/codebase/index",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    try {
      const { repoId = "default", files } = req.body;
      if (!files || typeof files !== "object") {
        return res
          .status(400)
          .json({ error: "Missing or invalid 'files' map in request body" });
      }

      const { codebaseGraphManager } = await import(
        "../services/codebaseGraphIndexer.js"
      );
      const user = (req as any).user;
      const effectiveRepoId = `${user?.id || "anon"}:${repoId}`;

      const index = codebaseGraphManager.indexRepository(
        effectiveRepoId,
        files,
      );

      res.json({
        success: true,
        repoId: effectiveRepoId,
        fileCount: index.fileCount,
        symbolCount: index.symbolCount,
        chunkCount: index.chunkCount,
        callGraphEdgesCount: index.callGraph.edges.length,
        indexedAt: index.indexedAt,
      });
    } catch (err: any) {
      console.error("[CodebaseGraph] Index error:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to index codebase" });
    }
  },
);

// ─── POST /v1/codebase/query (Hybrid BM25 + Vector + Graph Retrieval) ────────
proxyRouter.post(
  "/codebase/query",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    try {
      const {
        repoId = "default",
        query,
        topK = 5,
        bm25Weight = 1.0,
        vectorWeight = 1.0,
        graphBonusWeight = 0.5,
      } = req.body;

      if (!query || typeof query !== "string") {
        return res
          .status(400)
          .json({ error: "Missing 'query' string parameter" });
      }

      const { codebaseGraphManager } = await import(
        "../services/codebaseGraphIndexer.js"
      );
      const user = (req as any).user;
      const effectiveRepoId = `${user?.id || "anon"}:${repoId}`;

      const results = codebaseGraphManager.query(effectiveRepoId, query, {
        topK: Number(topK) || 5,
        bm25Weight: Number(bm25Weight) || 1.0,
        vectorWeight: Number(vectorWeight) || 1.0,
        graphBonusWeight: Number(graphBonusWeight) || 0.5,
      });

      res.json({
        success: true,
        query,
        repoId: effectiveRepoId,
        resultsCount: results.length,
        results,
      });
    } catch (err: any) {
      console.error("[CodebaseGraph] Query error:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to query codebase" });
    }
  },
);

// ─── GET /v1/codebase/symbol/:symbolName (Retrieve Symbol Call Graph Context) ─
proxyRouter.get(
  "/codebase/symbol/:symbolName",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    try {
      const rawSymbolName = req.params.symbolName;
      const symbolName = Array.isArray(rawSymbolName)
        ? rawSymbolName[0]
        : String(rawSymbolName || "");
      const repoId = (req.query.repoId as string) || "default";

      const { codebaseGraphManager } = await import(
        "../services/codebaseGraphIndexer.js"
      );
      const user = (req as any).user;
      const effectiveRepoId = `${user?.id || "anon"}:${repoId}`;

      const symbol = codebaseGraphManager.getSymbolDetails(
        effectiveRepoId,
        symbolName,
      );

      if (!symbol) {
        return res.status(404).json({
          error: `Symbol '${symbolName}' not found in codebase '${effectiveRepoId}'`,
        });
      }

      res.json({
        success: true,
        repoId: effectiveRepoId,
        symbol,
      });
    } catch (err: any) {
      console.error("[CodebaseGraph] Symbol lookup error:", err);
      res.status(500).json({ error: err.message || "Failed to lookup symbol" });
    }
  },
);

// ─── POST /v1/terminal/self-heal (Autonomous Terminal Self-Healing Loop) ─────
proxyRouter.post(
  "/terminal/self-heal",
  requireValidSubscriber,
  async (req: Request, res: Response) => {
    try {
      const {
        command,
        cwd,
        maxAttempts = 4,
        timeoutMs = 30000,
        virtualFiles,
      } = req.body;

      if (!command || typeof command !== "string") {
        return res
          .status(400)
          .json({
            error: "Missing or invalid 'command' string in request body",
          });
      }

      const { runAutonomousSelfHealingLoop } = await import(
        "../services/terminalSelfHealingEngine.js"
      );

      const result = await runAutonomousSelfHealingLoop({
        command,
        cwd,
        maxAttempts: Number(maxAttempts) || 4,
        timeoutMs: Number(timeoutMs) || 30000,
        virtualFiles,
      });

      const statusCode = result.success ? 200 : 422;
      res.status(statusCode).json(result);
    } catch (err: any) {
      console.error("[TerminalSelfHeal] Error in loop execution:", err);
      res
        .status(500)
        .json({
          error: err.message || "Terminal self-healing execution failed",
        });
    }
  },
);
