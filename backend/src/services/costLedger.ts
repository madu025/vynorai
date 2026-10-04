import { billingRun as dbRun } from "./billingDb.js";
import { getEffectivePrice, getPlan, ProviderID } from "../config.js";
import { v4 as uuidv4 } from "uuid";
import { estimateDeepSeekCostUsd } from "./pricing.js";

export type CostSource = "provider" | "local-zero" | "unknown";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prefix cache (billed at a discount). */
  cachedInputTokens: number;
  providerCostUsd: number | null;
  costSource: CostSource;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/** Normalize OpenRouter/OpenAI/Anthropic-compatible usage without inventing a cost. */
export function extractProviderUsage(chunks: any[]): ProviderUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let providerCostUsd: number | null = null;

  for (const chunk of chunks) {
    const usage = chunk?.usage;
    if (!usage) continue;
    inputTokens =
      finiteNumber(usage.prompt_tokens ?? usage.input_tokens) ?? inputTokens;
    outputTokens =
      finiteNumber(usage.completion_tokens ?? usage.output_tokens) ??
      outputTokens;
    // DeepSeek: prompt_cache_hit_tokens; OpenAI/OpenRouter: prompt_tokens_details.cached_tokens;
    // Anthropic: cache_read_input_tokens.
    cachedInputTokens =
      finiteNumber(
        usage.prompt_cache_hit_tokens ??
          usage.prompt_tokens_details?.cached_tokens ??
          usage.cache_read_input_tokens,
      ) ?? cachedInputTokens;
    providerCostUsd =
      finiteNumber(
        usage.cost ??
          usage.total_cost ??
          usage.cost_details?.upstream_inference_cost,
      ) ?? providerCostUsd;
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    providerCostUsd,
    costSource: providerCostUsd === null ? "unknown" : "provider",
  };
}

export interface EconomicsEvent {
  requestId?: string;
  usageLogId?: string | null;
  userId: string;
  planId: string;
  requestedModel: string;
  resolvedModel?: string | null;
  provider?:
    | ProviderID
    | "cache"
    | "deterministic"
    | "template"
    | "blueprint"
    | null;
  inputTokens: number;
  outputTokens: number;
  providerCostUsd: number | null;
  costSource: CostSource;
  cachedInputTokens?: number;
  cacheStatus?: "hit" | "miss" | "bypass";
  optimizationMode?: string;
  templateId?: string | null;
  estimatedTokensSaved?: number;
  latencyMs?: number | null;
  outcome?: "success" | "failed";
  /** Credits taken from the user's quota for this request. */
  creditsCharged?: number;
  offPeak?: boolean;
  /** Router decision for this request (see routingSignals.ts). */
  routeTier?: string | null;
  routeAuto?: boolean;
  promptFp?: string | null;
  toolFollowUp?: boolean;
}

/**
 * Records unit economics. Revenue is an allocation of subscription price per
 * included request, not a claim that this exact request was individually sold.
 */
export async function recordRequestEconomics(
  event: EconomicsEvent,
): Promise<void> {
  const plan = getPlan(event.planId);
  const monthlyRevenue = getEffectivePrice(plan).usd;
  const succeeded = event.outcome !== "failed";
  // Credit plans: revenue is the share of the plan price these credits represent.
  const allocatedRevenue =
    !succeeded || monthlyRevenue <= 0
      ? 0
      : event.creditsCharged !== undefined && plan.monthlyTokens > 0
        ? (event.creditsCharged * monthlyRevenue) / plan.monthlyTokens
        : plan.monthlyRequests > 0
          ? monthlyRevenue / plan.monthlyRequests
          : 0;
  // DeepSeek reports tokens, not money: price them from the published list.
  const estimatedCost =
    event.providerCostUsd === null
      ? estimateDeepSeekCostUsd(event.resolvedModel ?? event.requestedModel, {
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens ?? 0,
          outputTokens: event.outputTokens,
        })
      : null;
  const cost = event.providerCostUsd ?? estimatedCost;
  const grossMargin = cost === null ? null : allocatedRevenue - cost;

  await dbRun(
    `INSERT INTO request_economics (
      id, request_id, usage_log_id, user_id, plan_id, requested_model,
      resolved_model, provider, input_tokens, output_tokens, provider_cost_usd,
      cost_source, allocated_revenue_usd, gross_margin_usd, cache_status,
      optimization_mode, template_id, estimated_tokens_saved, latency_ms, outcome,
      cached_input_tokens, estimated_cost_usd, credits_charged, off_peak,
      route_tier, route_auto, prompt_fp, tool_followup
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      event.requestId ?? uuidv4(),
      event.usageLogId ?? null,
      event.userId,
      event.planId,
      event.requestedModel,
      event.resolvedModel ?? null,
      event.provider ?? null,
      event.inputTokens,
      event.outputTokens,
      event.providerCostUsd,
      event.costSource,
      allocatedRevenue,
      grossMargin,
      event.cacheStatus ?? "bypass",
      event.optimizationMode ?? "safe",
      event.templateId ?? null,
      event.estimatedTokensSaved ?? 0,
      event.latencyMs ?? null,
      event.outcome ?? "success",
      event.cachedInputTokens ?? 0,
      estimatedCost,
      event.creditsCharged ?? null,
      event.offPeak ? 1 : 0,
      event.routeTier ?? null,
      event.routeAuto ? 1 : 0,
      event.promptFp ?? null,
      event.toolFollowUp ? 1 : 0,
    ],
  );
}
