/**
 * VynorAI Auto Router
 * -------------------
 * Turns the request classification (light / normal / heavy) into a concrete
 * upstream model, output budget, and reasoning policy.
 *
 *   light  → DeepSeek V4.1 Flash, small output budget, thinking off
 *   normal → DeepSeek V4.1 Flash, standard output budget, thinking off
 *   heavy  → DeepSeek V4.1 Flash, large output budget, thinking on (big coding work)
 *   deep   → DeepSeek V4 Pro, thinking on (deep logic reasoning only; see DEEP_LOGIC)
 *
 * Only "vynor-auto" requests get a model chosen for them. Every request gets
 * the tier's output cap and thinking policy, because thinking tokens are billed
 * as output and are the single most expensive thing to enable by accident.
 */
import { getPlan } from "../config.js";
import { canPlanUseModel } from "./modelRegistry.js";
import { isReasoningModel } from "./providerRouter.js";

export const AUTO_MODEL_ID = "vynor-auto";
export type Tier = "light" | "normal" | "heavy" | "deep";

/**
 * Deep logic reasoning — the only work worth the Pro model (4x credits).
 * Ordinary coding, however large, stays on Flash.
 */
const DEEP_LOGIC =
  /\b(race conditions?|deadlocks?|concurrency|thread[- ]safe(ty)?|algorithms?|time complexity|big[- ]o|prove|proofs?|invariants?|formal verification|cryptograph\w*|security (audit|review|analysis)|vulnerabilit(y|ies)|threat model\w*|root cause|system design|architecture (design|decision|review)|consensus|memory leaks?|intermittent(ly)?|heisenbug)\b/i;

/** Promote a heavy turn to "deep" only when the request is about deep logic. */
export function refineTier(tier: Tier, prompt: string): Tier {
  return tier === "heavy" && DEEP_LOGIC.test(prompt) ? "deep" : tier;
}

export function isAutoModel(model: string | undefined | null): boolean {
  return model === AUTO_MODEL_ID || model === "auto";
}

export function tierFromComplexity(
  complexity: "EASY" | "MEDIUM" | "HARD",
): Tier {
  return complexity === "HARD"
    ? "heavy"
    : complexity === "MEDIUM"
      ? "normal"
      : "light";
}

/** DeepSeek thinking depth. "low" thinks far less than "high" (~half the reasoning tokens). */
export type ReasoningEffort = "low" | "high" | "max";

interface TierProfile {
  model: string;
  maxTokens: number;
  thinking: boolean;
  effort?: ReasoningEffort;
}

function effortFromEnv(
  value: string | undefined,
  fallback: ReasoningEffort,
): ReasoningEffort {
  return value === "low" || value === "high" || value === "max"
    ? value
    : fallback;
}

// One hybrid model (DeepSeek V4.1 Flash) for every tier: only the thinking
// switch changes. One model also keeps the provider prefix cache warm across
// tiers, which a V3/R1 split could not.
export function tierProfile(tier: Tier): TierProfile {
  switch (tier) {
    case "light":
      return {
        model: process.env.AUTO_MODEL_LIGHT || "deepseek/deepseek-flash",
        maxTokens: 4096,
        thinking: false,
      };
    case "normal":
      return {
        model: process.env.AUTO_MODEL_NORMAL || "deepseek/deepseek-flash",
        maxTokens: 8192,
        thinking: false,
      };
    case "heavy":
      return {
        model: process.env.AUTO_MODEL_HEAVY || "deepseek/deepseek-flash",
        // Reasoning tokens count toward output, so heavy needs headroom.
        maxTokens: 16384,
        thinking: true,
        // Big coding work needs a plan, not a proof: think briefly.
        effort: effortFromEnv(process.env.AUTO_EFFORT_HEAVY, "low"),
      };
    case "deep":
      return {
        model: process.env.AUTO_MODEL_DEEP || "deepseek/deepseek-v4-pro",
        maxTokens: 16384,
        thinking: true,
        effort: effortFromEnv(process.env.AUTO_EFFORT_DEEP, "high"),
      };
  }
}

export interface Route {
  model: string;
  tier: Tier;
  auto: boolean;
}

/** Pick the upstream model. Falls back to the plan default if the tier model is not entitled. */
export async function resolveRoute(
  requestedModel: string,
  tier: Tier,
  planId: string,
): Promise<Route> {
  if (!isAutoModel(requestedModel))
    return { model: requestedModel, tier, auto: false };

  const candidate = tierProfile(tier).model;
  if (await canPlanUseModel(planId, candidate))
    return { model: candidate, tier, auto: true };

  // Pro not on this plan: deep reasoning still runs, on Flash with thinking.
  if (tier === "deep") return resolveRoute(requestedModel, "heavy", planId);

  // Tier model not on this plan: run the request on the plan default instead.
  return { model: getPlan(planId).defaultChatModel, tier, auto: true };
}

/**
 * Apply the tier's output cap and reasoning policy to an upstream body.
 * Explicit client settings win, except that max_tokens can only be lowered.
 */
export function applyTierPolicy(body: any, tier: Tier): any {
  const profile = tierProfile(tier);
  const requestedMax = Number(body.max_tokens);
  const max_tokens =
    Number.isFinite(requestedMax) && requestedMax > 0
      ? Math.min(Math.floor(requestedMax), profile.maxTokens)
      : profile.maxTokens;

  const { thinking, reasoning_effort, extra_body, ...rest } = body;
  const out: any = { ...rest, max_tokens };
  if (extra_body !== undefined) out.extra_body = extra_body;

  // An explicitly chosen reasoning model (R1, "reasoner") always thinks.
  const think = profile.thinking || isReasoningModel(String(body.model ?? ""));
  out.thinking =
    thinking !== undefined
      ? thinking
      : { type: think ? "enabled" : "disabled" };

  if (reasoning_effort !== undefined) out.reasoning_effort = reasoning_effort;
  else if (out.thinking?.type === "enabled")
    out.reasoning_effort = profile.effort ?? "high";

  return out;
}
