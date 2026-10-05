/**
 * VynorAI Ultra-Fast FIM (Fill-in-the-Middle) Autocomplete Engine
 * ---------------------------------------------------------------
 * Optimized for sub-120ms inline ghost text completions in VS Code.
 *
 * Supports:
 * - Standard Qwen / DeepSeek FIM tokens (<|fim_prefix|>, <|fim_suffix|>, <|fim_middle|>)
 * - Context window slicing (keeps surrounding 60 lines prefix + 30 lines suffix)
 * - Zero-overhead bypass of heavy agents/web/search pipelines
 * - Greedy low-temperature decoding for exact syntax completions
 */

import { Response } from "express";
import { AuthenticatedUser } from "./aiProxy.js";
import { dispatchToProvider } from "./providerRouter.js";
import { sanitizeText } from "./secretSanitizer.js";
import { PiiMap, PiiStreamRestorer } from "./piiShield.js";
import { sliceFimContext } from "./fimContext.js";
import { getPlan } from "../config.js";
import { v4 as uuidv4 } from "uuid";
import { billingRun as dbRun } from "./billingDb.js";
import {
  QuotaReservation,
  releaseQuotaReservation,
  settleQuotaReservation,
} from "./monthlyQuota.js";
import { usageCredits } from "./billingPolicy.js";
import { recordRequestEconomics } from "./costLedger.js";

export interface FimRequest {
  prefix: string; // Code before cursor
  suffix?: string; // Code after cursor
  language?: string; // e.g. "typescript", "python", "html"
  max_tokens?: number; // Defaults to 64
  temperature?: number; // Defaults to 0.1
  model?: string; // Optional model override
}

/**
 * Handle dedicated inline tab-autocomplete
 */
export async function handleFimAutocomplete(
  user: AuthenticatedUser,
  body: FimRequest,
  res: Response,
  quotaReservation?: QuotaReservation,
) {
  const t0 = Date.now();
  const plan = getPlan(user.subscriptionPlan || "free");
  const rawPrefix = body.prefix || "";
  const rawSuffix = body.suffix || "";

  // 1. Scrub sensitive secrets in-flight
  const cleanPrefix = sanitizeText(rawPrefix).text;
  const cleanSuffix = sanitizeText(rawSuffix).text;

  // 2. Slice local context window
  const { prefix, suffix } = sliceFimContext(cleanPrefix, cleanSuffix);

  // 3. Assemble FIM Prompt
  // Format for Qwen 2.5 Coder and DeepSeek:
  // <|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>
  // Personal data is masked before dispatch and restored in the completion.
  const pii = new PiiMap();
  const fimPrompt = `<|fim_prefix|>${pii.mask(prefix)}<|fim_suffix|>${pii.mask(suffix)}<|fim_middle|>`;

  const model =
    body.model ||
    plan.defaultAutocompleteModel ||
    "qwen/qwen-2.5-coder-32b-instruct";
  const maxTokens = Math.min(body.max_tokens || 64, 128);
  const temperature = body.temperature ?? 0.1;

  const payload = {
    model,
    prompt: fimPrompt,
    messages: [
      {
        role: "user",
        content: fimPrompt,
      },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false, // Fast 1-shot completion for autocomplete
    stop: [
      "\n\n\n",
      "<|fim_prefix|>",
      "<|fim_suffix|>",
      "<|fim_middle|>",
      "<|endoftext|>",
    ],
  };

  res.setHeader("X-VynorAI-FIM-Model", model);
  res.setHeader("X-VynorAI-Engine", "FIM-UltraFast");

  // 4. Dispatch directly to provider
  const dispatch = await dispatchToProvider(
    payload,
    res,
    undefined,
    true,
    new PiiStreamRestorer(pii),
  );
  const { collected } = dispatch;

  const latency = Date.now() - t0;
  console.log(
    `[VynorAI ⚡ FIM Autocomplete] ${latency}ms | Model: ${model} | User: ${user.id}`,
  );

  // 5. Track tokens
  const estimatedInput =
    dispatch.usage?.inputTokens || Math.ceil(fimPrompt.length / 4);
  let outputText = "";
  for (const c of collected) {
    if (c?.choices?.[0]?.message?.content)
      outputText += c.choices[0].message.content;
    else if (c?.choices?.[0]?.text) outputText += c.choices[0].text;
  }
  const estimatedOutput =
    dispatch.usage?.outputTokens ||
    Math.max(1, Math.ceil(outputText.length / 4));
  const totalTokens = dispatch.success ? estimatedInput + estimatedOutput : 0;
  if (dispatch.success)
    await settleQuotaReservation(
      quotaReservation,
      dispatch.success
        ? usageCredits(model, {
            inputTokens: estimatedInput,
            cachedInputTokens: dispatch.usage?.cachedInputTokens ?? 0,
            outputTokens: estimatedOutput,
          })
        : 0,
    );
  else await releaseQuotaReservation(quotaReservation);

  const usageLogId = uuidv4();
  await dbRun(
    "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [usageLogId, user.id, model, estimatedInput, estimatedOutput, totalTokens],
  );
  await recordRequestEconomics({
    usageLogId,
    userId: user.id,
    planId: plan.id,
    requestedModel: model,
    resolvedModel: dispatch.resolvedModel,
    provider: dispatch.provider,
    inputTokens: estimatedInput,
    outputTokens: estimatedOutput,
    providerCostUsd: dispatch.usage?.providerCostUsd ?? null,
    costSource: dispatch.usage?.costSource ?? "unknown",
    cacheStatus: "bypass",
    optimizationMode: "fim-slice",
    latencyMs: latency,
    outcome: dispatch.success ? "success" : "failed",
    estimatedTokensSaved: Math.max(
      0,
      Math.ceil(
        (rawPrefix.length + rawSuffix.length - prefix.length - suffix.length) /
          4,
      ),
    ),
  });
}
