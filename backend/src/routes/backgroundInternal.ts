import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  billingGet as dbGet,
  billingRun as dbRun,
} from "../services/billingDb.js";
import {
  handleChatCompletions,
  type AuthenticatedUser,
} from "../services/aiProxy.js";
import {
  estimateReservation,
  topUpReservation,
  type QuotaReservation,
} from "../services/monthlyQuota.js";
import { verifyBackgroundModelToken } from "../services/backgroundModelToken.js";
import { getPlan } from "../config.js";
import { z, validateBody } from "../middleware/validate.js";

export const BackgroundChatCompletionsSchema = z
  .object({
    model: z.string().optional(),
    messages: z
      .array(z.record(z.string(), z.unknown()))
      .min(1, "messages array is required"),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

export const backgroundInternalRouter = Router();

async function requireScopedModelToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer "))
      throw new Error("MISSING_BACKGROUND_MODEL_TOKEN");
    (req as any).backgroundClaims = verifyBackgroundModelToken(auth.slice(7));
    next();
  } catch {
    res.status(401).json({
      error: {
        code: "INVALID_BACKGROUND_MODEL_TOKEN",
        message: "Invalid scoped task token.",
      },
    });
  }
}

backgroundInternalRouter.post(
  "/model/v1/chat/completions",
  requireScopedModelToken,
  validateBody(BackgroundChatCompletionsSchema, { shape: "nested" }),
  async (req, res) => {
    try {
      const claims = (req as any).backgroundClaims as {
        taskId: string;
        userId: string;
      };
      const task = await dbGet<any>(
        "SELECT * FROM background_tasks WHERE id = ? AND user_id = ? AND status IN ('running','cancel_requested')",
        [claims.taskId, claims.userId],
      );
      if (!task || task.status === "cancel_requested")
        return res.status(409).json({
          error: {
            code: "BACKGROUND_TASK_NOT_RUNNING",
            message: "Task is not running.",
          },
        });
      req.body.stream = false;
      const projected = estimateReservation(req);
      const remaining = Number(task.cap_credits) - Number(task.used_credits);
      if (projected > remaining)
        return res.status(402).json({
          error: {
            code: "BACKGROUND_CREDIT_CAP",
            message: "Task credit cap reached.",
          },
        });

      const hold = await dbGet<{ tokens: number }>(
        "SELECT tokens FROM quota_reservations WHERE id = ?",
        [task.quota_reservation_id],
      );
      const requiredHold = Number(task.used_credits) + projected;
      if (hold && requiredHold > Number(hold.tokens)) {
        const reservation: QuotaReservation = {
          id: task.quota_reservation_id,
          userId: task.user_id,
          reservedTokens: Number(hold.tokens),
          reservedRequests: 1,
          settled: false,
          ownerType: "background_task",
          ownerId: task.id,
        };
        if (
          !(await topUpReservation(
            reservation,
            requiredHold - Number(hold.tokens),
          ))
        )
          return res.status(402).json({
            error: {
              code: "INSUFFICIENT_CREDITS",
              message: "Unable to extend task credit hold.",
            },
          });
      }

      const subscription = await dbGet<{
        plan_name: string;
        valid_until: string;
      }>(
        "SELECT plan_name, valid_until FROM subscriptions WHERE user_id = ? AND status = 'active' AND valid_until > ? AND plan_name NOT LIKE 'topup%' ORDER BY valid_until DESC LIMIT 1",
        [claims.userId, new Date().toISOString()],
      );
      const planId = subscription?.plan_name || "free";
      if (!getPlan(planId).background.enabled)
        return res.status(403).json({
          error: {
            code: "BACKGROUND_NOT_INCLUDED",
            message: "Background entitlement is no longer active.",
          },
        });
      const account = await dbGet<{ email: string; name?: string }>(
        "SELECT email, name FROM users WHERE id = ?",
        [claims.userId],
      );
      if (!account)
        return res.status(404).json({ error: { code: "USER_NOT_FOUND" } });
      const user: AuthenticatedUser = {
        id: claims.userId,
        email: account.email,
        name: account.name,
        hasActiveSubscription: Boolean(subscription),
        subscriptionPlan: planId,
        validUntil: subscription?.valid_until,
      };
      return await handleChatCompletions(user, req.body, res, undefined, {
        onUsage: async (credits) => {
          const updated = await dbRun(
            `UPDATE background_tasks SET used_credits = used_credits + ?, model_credits = model_credits + ?,
           heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND used_credits + ? <= cap_credits AND status = 'running'`,
            [credits, credits, task.id, credits],
          );
          if (updated.changes === 0) throw new Error("BACKGROUND_CREDIT_CAP");
        },
      });
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : "BACKGROUND_MODEL_RELAY_FAILED";
      if (!res.headersSent)
        return res
          .status(code.includes("CAP") ? 402 : 500)
          .json({ error: { code, message: "Background model relay failed." } });
      res.end();
    }
  },
);
