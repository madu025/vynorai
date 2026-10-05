import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { incrementRateLimit } from "../services/redisStore.js";
import { billingGet as dbGet } from "../services/billingDb.js";
import {
  createEstimateQuote,
  storeEstimateQuote,
  validateEstimateInput,
} from "../services/backgroundQuote.js";
import { BACKGROUND_POLICY_VERSION } from "../services/backgroundTypes.js";
import {
  cancelBackgroundTask,
  createBackgroundTask,
  getBackgroundEntitlement,
  getBackgroundPatch,
  getBackgroundTask,
  hashClientIp,
  listBackgroundTasks,
  purgeBackgroundTask,
  uploadBackgroundProject,
} from "../services/backgroundTasks.js";
import {
  pushPublicKey,
  revokePushSubscription,
  savePushSubscription,
} from "../services/backgroundNotifications.js";

export const backgroundRouter = Router();

// Answered even while the feature is off, so the IDE can hide Background
// mode instead of letting users pick a mode that only returns errors.
backgroundRouter.get("/availability", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.BG_ENABLED !== "true")
    return res.json({ available: false, reason: "disabled" });
  try {
    const entitlement = await getBackgroundEntitlement(
      (req as any).user.id as string,
    );
    return res.json({
      available: Boolean(entitlement.enabled),
      reason: entitlement.enabled ? undefined : "plan",
      entitlement,
    });
  } catch {
    return res.json({ available: false, reason: "unavailable" });
  }
});

backgroundRouter.use((_req, res, next) => {
  if (process.env.BG_ENABLED !== "true")
    return res.status(503).json({
      error: {
        code: "BACKGROUND_DISABLED",
        message: "Background agents are not enabled yet.",
      },
    });
  next();
});
backgroundRouter.use(requireAuth);
backgroundRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
backgroundRouter.use(async (req, res, next) => {
  const userId = (req as any).user.id as string;
  const result = await incrementRateLimit(`background:${userId}`, 60_000);
  if (!result)
    return res.status(503).json({
      error: {
        code: "BACKGROUND_QUEUE_UNAVAILABLE",
        message: "Background tasks are temporarily unavailable.",
      },
    });
  if (result.count > 120)
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many background task requests.",
      },
    });
  next();
});

backgroundRouter.post("/tasks/estimate", async (req, res) => {
  try {
    const userId = (req as any).user.id as string;
    const input = validateEstimateInput(req.body);
    const entitlement = await getBackgroundEntitlement(userId);
    const { quote, signature } = createEstimateQuote(userId, input);
    await storeEstimateQuote(quote);
    const consent = await dbGet(
      "SELECT accepted_at FROM background_consent WHERE user_id = ? AND policy_version = ?",
      [userId, BACKGROUND_POLICY_VERSION],
    );
    return res.json({
      quote,
      signature,
      entitlement,
      consentRequired: !consent,
      policyVersion: BACKGROUND_POLICY_VERSION,
      computeCreditsPerHour: Number(
        process.env.BG_COMPUTE_CREDITS_PER_HOUR || 100_000,
      ),
      maxRuntimeMinutes: 45,
    });
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/patch-public-key", (_req, res) => {
  const value = process.env.BG_PATCH_SIGNING_PUBLIC_KEY_BASE64;
  if (!value)
    return res
      .status(503)
      .json({ error: { code: "PATCH_SIGNING_NOT_CONFIGURED" } });
  return res.json({
    keyId: process.env.BG_PATCH_SIGNING_KEY_ID || "vynor-bg-1",
    algorithm: "Ed25519",
    publicKey: value,
  });
});

backgroundRouter.post("/tasks", async (req, res) => {
  try {
    const userId = (req as any).user.id as string;
    const input = validateEstimateInput(req.body.input || req.body);
    const result = await createBackgroundTask({
      userId,
      input,
      quoteId: String(req.body.quoteId || ""),
      quoteSignature: String(req.body.quoteSignature || ""),
      capCredits: Number(req.body.capCredits),
      idempotencyKey: String(
        req.body.idempotencyKey || req.headers["idempotency-key"] || "",
      ),
      consentAccepted: req.body.consentAccepted === true,
      policyVersion: String(req.body.policyVersion || ""),
      client: String(req.headers["x-vynor-client"] || "unknown"),
      ipDigest: hashClientIp(
        String(req.headers["cf-connecting-ip"] || req.ip || "unknown"),
      ),
    });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.put("/tasks/:id/upload", async (req, res) => {
  try {
    if (
      !/^(application\/zip|application\/octet-stream)(;|$)/i.test(
        String(req.headers["content-type"] || ""),
      )
    )
      return res.status(415).json({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Upload must be application/zip.",
        },
      });
    const result = await uploadBackgroundProject(
      (req as any).user.id,
      String(req.params.id),
      req,
    );
    return res.json(result);
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/tasks", async (req, res) => {
  try {
    return res.json(
      await listBackgroundTasks(
        (req as any).user.id,
        Number(req.query.limit || 20),
        typeof req.query.status === "string" ? req.query.status : undefined,
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      ),
    );
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/tasks/:id", async (req, res) => {
  try {
    return res.json(
      await getBackgroundTask(
        (req as any).user.id,
        String(req.params.id),
        Number(req.query.afterSequence || 0),
      ),
    );
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/tasks/:id/events", async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  let sequence = Number(
    req.headers["last-event-id"] || req.query.afterSequence || 0,
  );
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  const send = async () => {
    if (closed) return;
    try {
      const detail = await getBackgroundTask(
        (req as any).user.id,
        String(req.params.id),
        sequence,
      );
      for (const event of detail.events as any[]) {
        sequence = Number(event.sequence);
        res.write(
          `id: ${sequence}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch (error) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ code: errorCode(error) })}\n\n`,
      );
      res.end();
      closed = true;
    }
  };
  await send();
  const timer = setInterval(() => void send(), 2_000);
  timer.unref();
  req.on("close", () => clearInterval(timer));
});

backgroundRouter.post("/tasks/:id/cancel", async (req, res) => {
  try {
    return res.json(
      await cancelBackgroundTask((req as any).user.id, String(req.params.id)),
    );
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/tasks/:id/patch", async (req, res) => {
  try {
    const patch = await getBackgroundPatch(
      (req as any).user.id,
      String(req.params.id),
    );
    const etag = `"${(await import("crypto")).createHash("sha256").update(patch).digest("hex")}"`;
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.setHeader(
      "Content-Type",
      "application/vnd.vynor.background-patch+json",
    );
    res.setHeader("ETag", etag);
    return res.send(patch);
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.delete("/tasks/:id", async (req, res) => {
  try {
    return res.json(
      await purgeBackgroundTask((req as any).user.id, String(req.params.id)),
    );
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.get("/push/public-key", (_req, res) => {
  const publicKey = pushPublicKey();
  return publicKey
    ? res.json({ publicKey })
    : res.status(503).json({ error: { code: "PUSH_NOT_CONFIGURED" } });
});

backgroundRouter.post("/push/subscriptions", async (req, res) => {
  try {
    return res
      .status(201)
      .json({ id: await savePushSubscription((req as any).user.id, req.body) });
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

backgroundRouter.delete("/push/subscriptions", async (req, res) => {
  try {
    await revokePushSubscription(
      (req as any).user.id,
      String(req.body?.endpoint || ""),
    );
    return res.status(204).end();
  } catch (error) {
    return sendBackgroundError(res, error);
  }
});

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "BACKGROUND_INTERNAL_ERROR";
}

function sendBackgroundError(res: Response, error: unknown) {
  const code = errorCode(error);
  const status = code.includes("NOT_FOUND")
    ? 404
    : code.includes("NOT_INCLUDED") ||
        code.includes("LIMIT") ||
        code.includes("INSUFFICIENT")
      ? 403
      : code.includes("UNAVAILABLE") || code.includes("NOT_CONFIGURED")
        ? 503
        : code.includes("INVALID") ||
            code.includes("MISMATCH") ||
            code.includes("CONSENT") ||
            code.includes("NOT_ALLOWED")
          ? 400
          : 500;
  if (status === 500) console.error("[Background] request failed:", code);
  return res
    .status(status)
    .json({ error: { code, message: backgroundErrorMessage(code) } });
}

function backgroundErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    BACKGROUND_NOT_INCLUDED:
      "Background agents are available on Pro and Ultra plans.",
    BACKGROUND_MONTHLY_LIMIT: "Your monthly background task allowance is used.",
    BACKGROUND_CONCURRENCY_LIMIT:
      "Your plan's background task concurrency is in use.",
    BACKGROUND_CONSENT_REQUIRED:
      "Accept the Background Agents privacy notice before creating a task.",
    INSUFFICIENT_CREDITS: "There are not enough credits to reserve this task.",
    INVALID_OR_EXPIRED_QUOTE: "The estimate expired. Request a new estimate.",
    BACKGROUND_TASK_NOT_FOUND: "Background task not found.",
    PATCH_NOT_AVAILABLE: "This task has no retained patch.",
  };
  return (
    messages[code] || "The background task request could not be completed."
  );
}
