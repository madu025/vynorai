/**
 * VynorAI Terminal Error & Stack Trace Quick-Fix Engine
 * ----------------------------------------------------
 * High-precision analyzer that takes compiler errors, unit test failures,
 * or runtime stack traces, isolates the root cause, and generates an instant
 * search/replace surgical patch.
 */

import { Response } from "express";
import { AuthenticatedUser } from "./aiProxy.js";
import { dispatchToProvider } from "./providerRouter.js";
import { sanitizeText } from "./secretSanitizer.js";
import { getPlan } from "../config.js";
import {
  QuotaReservation,
  releaseQuotaReservation,
  settleQuotaReservation,
} from "./monthlyQuota.js";
import { usageCredits } from "./billingPolicy.js";
import { recordRequestEconomics } from "./costLedger.js";
import { billingRun as dbRun } from "./billingDb.js";
import { v4 as uuidv4 } from "uuid";

export interface QuickFixRequest {
  errorLog: string; // Terminal output / compiler error / stack trace
  codeContext?: string; // Active file code around the error
  filePath?: string; // Path to the failing file
  language?: string; // Language (e.g. typescript, python)
  model?: string;
}

export async function handleQuickFix(
  user: AuthenticatedUser,
  body: QuickFixRequest,
  res: Response,
  quotaReservation?: QuotaReservation,
) {
  const startedAt = Date.now();
  const plan = getPlan(user.subscriptionPlan || "free");
  const model =
    body.model ||
    (user.subscriptionPlan === "pro" || user.subscriptionPlan === "ultra"
      ? "deepseek/deepseek-r1"
      : "deepseek/deepseek-chat-v3-0324");

  const cleanError = sanitizeText(body.errorLog || "").text;
  const cleanContext = sanitizeText(body.codeContext || "").text;

  const prompt = `
You are the VynorAI Code Repair Engine.
Analyze the following terminal error and active code context.
Diagnose the exact root cause and generate a surgical fix.

### TERMINAL ERROR / STACK TRACE:
\`\`\`
${cleanError}
\`\`\`

${
  cleanContext
    ? `### ACTIVE CODE CONTEXT (${body.filePath || "File"}):
\`\`\`${body.language || ""}
${cleanContext}
\`\`\``
    : ""
}

### INSTRUCTIONS:
1. Explain the root cause in 1-2 concise bullet points.
2. Provide the exact surgical patch using SEARCH/REPLACE format:
<<<<<<< SEARCH
[exact existing lines to be replaced]
=======
[fixed replacement lines]
>>>>>>>
3. If no code was provided, provide the exact corrected code block with filename.
`;

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an elite automated debugger that fixes terminal compiler and runtime errors.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    stream: true,
  };

  res.setHeader("X-VynorAI-Engine", "QuickFix-Repair");
  const dispatch = await dispatchToProvider(payload, res);
  const { collected } = dispatch;
  let outputChars = 0;
  for (const chunk of collected) {
    outputChars += chunk?.choices?.[0]?.delta?.content?.length || 0;
    outputChars += chunk?.choices?.[0]?.message?.content?.length || 0;
  }
  const inputTokens =
    dispatch.usage?.inputTokens || Math.ceil(prompt.length / 4);
  const outputTokens =
    dispatch.usage?.outputTokens || Math.max(1, Math.ceil(outputChars / 4));
  const actualTokens = dispatch.success ? inputTokens + outputTokens : 0;
  if (dispatch.success)
    await settleQuotaReservation(
      quotaReservation,
      dispatch.success
        ? usageCredits(model, {
            inputTokens,
            cachedInputTokens: dispatch.usage?.cachedInputTokens ?? 0,
            outputTokens,
          })
        : 0,
    );
  else await releaseQuotaReservation(quotaReservation);
  const usageLogId = uuidv4();
  await dbRun(
    "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [usageLogId, user.id, model, inputTokens, outputTokens, actualTokens],
  );
  await recordRequestEconomics({
    usageLogId,
    userId: user.id,
    planId: plan.id,
    requestedModel: model,
    resolvedModel: dispatch.resolvedModel,
    provider: dispatch.provider,
    inputTokens,
    outputTokens,
    providerCostUsd: dispatch.usage?.providerCostUsd ?? null,
    costSource: dispatch.usage?.costSource ?? "unknown",
    cacheStatus: "bypass",
    optimizationMode: "quick-fix",
    latencyMs: dispatch.latencyMs ?? Date.now() - startedAt,
    outcome: dispatch.success ? "success" : "failed",
  });
}
