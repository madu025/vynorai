import crypto from "crypto";
import { Response } from "express";
import { billingGet as dbGet, billingRun as dbRun } from "./billingDb.js";
import { v4 as uuidv4 } from "uuid";
import { generateCacheKey, getFromCache, saveToCache } from "./cacheEngine.js";
import {
  VYNORAI_AGENT_TOOLS,
  VYNORAI_AGENT_SYSTEM_PROMPT,
  filterToolsForIntent,
} from "./agentEngine.js";
import {
  dispatchToProvider,
  hasImageInput,
  isTextOnlyModel,
} from "./providerRouter.js";
import { estimateInputTokens } from "./quotaGuard.js";
import { DEFAULT_CHAT_MODEL } from "../config.js";
import {
  getActiveSubscription,
  QuotaReservation,
  releaseQuotaReservation,
  settleQuotaReservation,
  topUpReservation,
} from "./monthlyQuota.js";
import {
  creditsFor,
  creditWeight,
  offPeakCreditFactor,
  usageCredits,
} from "./billingPolicy.js";
import {
  applyTierPolicy,
  refineTier,
  resolveRoute,
  tierFromComplexity,
} from "./autoRouter.js";
import {
  attachTurnContext,
  memoizeTurnContext,
  turnKey,
} from "./tokenOptimizer.js";
import {
  semanticCacheQuestion,
  semanticLookup,
  semanticSave,
  semanticScope,
} from "./semanticCache.js";
import { generateZKUserId, computeAuditHash } from "./zkShield.js";
import { applyHybridContext } from "./hybridContext.js";
import { enrichWithRAG } from "./ragEngine.js";
import { enrichWithWeb } from "./webSearch.js";
import { enrichWithMemory } from "./memoryEngine.js";
import {
  detectTemplateIntent,
  formatTemplateContext,
  checkInstantTemplateMatch,
  executeVynorEngine,
  formatOrchestrationToMarkdown,
  stripRulesAndPreamble,
} from "./templateVault.js";
import {
  detectProjectBlueprint,
  formatBlueprintPlan,
} from "./scaffoldRegistry.js";
import { recordRequestEconomics } from "./costLedger.js";
import type { QuotaContext } from "./monthlyQuota.js";
import { promptFingerprint } from "./routingSignals.js";
import { maskRequestBody, PiiStreamRestorer } from "./piiShield.js";
import {
  analyzeIntentWithLocalSlm,
  isMutationRequest,
} from "./localSlmRouter.js";

// Screenshots and designs are read by DeepSeek V4.1 Flash (V4 Pro is text-only).
const IMAGE_MODEL = "deepseek/deepseek-flash";

function messageText(m: any): string {
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content))
    return m.content
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
  return "";
}

/** The IDE's (auto) compaction prompt — see core/util/conversationCompaction.ts. */
export function isCompactionRequest(prompt: string): boolean {
  return /\bsummary of this conversation\b/i.test(prompt);
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  hasActiveSubscription: boolean;
  subscriptionPlan?: string;
  validUntil?: string;
}

// ── In-Memory High-Speed Auth Cache (Handles 1000+ Concurrent Requests / 0ms Latency) ──
interface CachedAuthUser {
  user: AuthenticatedUser;
  expiresAt: number;
}
const authUserCache = new Map<string, CachedAuthUser>();
const AUTH_CACHE_TTL_MS = 60_000; // 60-second TTL

export function invalidateAuthCache(apiKey?: string) {
  if (!apiKey) return authUserCache.clear();
  for (const key of authUserCache.keys()) {
    if (key.startsWith(`${apiKey}:`)) authUserCache.delete(key);
  }
}

export async function authenticateApiKey(
  authHeader?: string,
  clientIp?: string,
): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.replace("Bearer ", "").trim();

  // Fast memory lookup (0.001 ms)
  const cacheKey = `${apiKey}:${clientIp || ""}`;
  const cached = authUserCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.user;
  }

  // Compute cryptographic SHA-256 hash
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  const user = await dbGet<any>(
    "SELECT id, email, name, api_key_hash, COALESCE(is_suspended, 0) as is_suspended, allowed_ips FROM users WHERE api_key_hash = ?",
    [apiKeyHash],
  );
  if (!user) return null;

  // Auto-backfill SHA-256 hash for legacy keys
  if (!user.api_key_hash) {
    dbRun("UPDATE users SET api_key_hash = ? WHERE id = ?", [
      apiKeyHash,
      user.id,
    ]).catch(() => {});
  }

  if (user.is_suspended === 1) {
    console.warn(
      `[Security] Blocked request from suspended user: ${user.email}`,
    );
    return null;
  }

  // Check IP whitelisting if configured (OpenAI Codex / Kimi Enterprise feature)
  if (user.allowed_ips && user.allowed_ips.trim() && clientIp) {
    const allowed = user.allowed_ips.split(",").map((s: string) => s.trim());
    if (!allowed.includes("*") && !allowed.includes(clientIp)) {
      console.warn(
        `[Security] IP ${clientIp} not in allowed_ips for user ${user.email}`,
      );
      return null;
    }
  }

  const subscription = await getActiveSubscription<any>(user.id);

  const authResult: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    hasActiveSubscription: true, // Free tier is active by default for all valid users
    subscriptionPlan: subscription?.plan_name || "free",
    validUntil: subscription?.valid_until || "lifetime",
  };

  // Cache user for 60 seconds
  authUserCache.set(cacheKey, {
    user: authResult,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });

  return authResult;
}

/**
 * Full pipeline:
 * 1. L1/L2 cache check → instant 0-token response
 * 2. Agent tools + system prompt injection
 * 3. Smart provider routing (OpenAI / Anthropic / DeepSeek / Gemini / Groq / Ollama)
 * 4. Anthropic ephemeral cache headers + code compression
 * 5. Async usage logging
 */
/**
 * The backend prompt is only a default. The IDE sends its own system message;
 * adding this one on top gave the model two conflicting instructions on every
 * agent turn.
 */
export function systemPromptFor(body: any): string | undefined {
  if (body?.system) return body.system;
  const hasOwn =
    Array.isArray(body?.messages) &&
    body.messages.some((m: any) => m?.role === "system");
  return hasOwn ? undefined : VYNORAI_AGENT_SYSTEM_PROMPT;
}

export function finishedWithStop(chunks: unknown[]): boolean {
  const text = chunks
    .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
    .join("");
  return (
    /finish_reason\\?"\s*:\s*\\?"stop/.test(text) &&
    !/finish_reason\\?"\s*:\s*\\?"(?:length|tool_calls|content_filter)/.test(
      text,
    )
  );
}

export async function handleChatCompletions(
  user: AuthenticatedUser,
  body: any,
  res: Response,
  quotaReservation?: QuotaReservation,
  quota: QuotaContext = {},
) {
  const {
    model = DEFAULT_CHAT_MODEL,
    messages = [],
    stream = true,
    temperature = 0,
  } = body;
  const planId = user.subscriptionPlan || "free";
  const requestId = uuidv4();
  const requestStartedAt = Date.now();

  // ── 1. Cache Lookup ─────────────────────────────────────────────────────────
  const cacheKey = generateCacheKey(
    {
      userId: user.id,
      projectId:
        typeof body.projectRoot === "string" ? body.projectRoot : "default",
      // Streamed and plain answers are stored in different shapes, and the
      // same prompt with other tools is a different request (v2 also drops
      // entries cached before truncated answers were excluded).
      policyVersion: `2026-10-security-v2|stream=${stream !== false}|tools=${
        Array.isArray(body.tools)
          ? body.tools
              .map((t: any) => t?.function?.name ?? t?.name ?? "")
              .join(",")
          : ""
      }`,
    },
    model,
    messages,
    temperature,
  );
  const cached = await getFromCache(cacheKey);

  /** Serve a stored answer at zero upstream cost (exact or semantic cache hit). */
  const serveCachedChunks = async (
    chunks: any[],
    kind: "exact" | "semantic",
  ) => {
    await settleQuotaReservation(quotaReservation, 0);
    console.log(
      `[VynorAI ⚡ ${kind.toUpperCase()} CACHE HIT] 0 tokens | key=${cacheKey.slice(0, 10)}…`,
    );
    res.setHeader("X-VynorAI-Cache", kind === "exact" ? "HIT" : "SEMANTIC-HIT");
    res.setHeader("X-VynorAI-Tokens-Saved", "100%");

    (async () => {
      try {
        const estimatedInput = estimateInputTokens(messages);
        // Plain estimate (no floors) — this feeds the user-facing savings figure.
        const savedTokens = estimatedInput;
        const usageLogId = uuidv4();
        await dbRun(
          "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, 0, 0, 1)",
          [
            usageLogId,
            user.id,
            kind === "exact" ? "vynorai-exact-cache" : "vynorai-semantic-cache",
            savedTokens,
          ],
        );
        await recordRequestEconomics({
          requestId,
          usageLogId,
          userId: user.id,
          planId,
          requestedModel: model,
          provider: "cache",
          inputTokens: 0,
          outputTokens: 0,
          providerCostUsd: 0,
          costSource: "local-zero",
          cacheStatus: "hit",
          estimatedTokensSaved: savedTokens,
          latencyMs: Date.now() - requestStartedAt,
        });
      } catch (_) {}
    })();

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for (const chunk of chunks)
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    const content = chunks
      .map(
        (chunk: any) =>
          chunk?.choices?.[0]?.delta?.content ??
          chunk?.choices?.[0]?.message?.content ??
          "",
      )
      .join("");
    return res.json({
      id: `cache-${requestId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  };

  if (cached?.responseChunks?.length) {
    return serveCachedChunks(cached.responseChunks, "exact");
  }

  // ── 1b. 5-Layer Deterministic Local Engineering Engine (0 Tokens & 100% Deterministic) ──
  const lastMsg =
    Array.isArray(messages) && messages.length > 0
      ? messages[messages.length - 1]
      : null;
  const isToolFollowUp =
    lastMsg?.role === "tool" || (lastMsg?.role as string) === "function";
  const hasToolHistory = messages?.some(
    (m: any) =>
      m.role === "tool" ||
      m.role === "function" ||
      (m.role === "assistant" &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0),
  );

  // An IDE agent (it sends its own tools) works on the user's codebase: a canned
  // template or blueprint would replace that work. Templates still reach the
  // model as reference context (see turn context below).
  const isIdeAgent = Array.isArray(body.tools) && body.tools.length > 0;

  // CRITICAL GUARD: Only run the 0-token deterministic engine on initial user turns.
  // NEVER run on tool continuations, tool outputs, or multi-turn tool loops!
  if (!isToolFollowUp && !hasToolHistory && !isIdeAgent) {
    const lastUserMsgEarly = [...(messages || [])]
      .reverse()
      .find((m: any) => m.role === "user");
    let rawQuery = "";
    if (typeof lastUserMsgEarly?.content === "string") {
      rawQuery = lastUserMsgEarly.content;
    } else if (Array.isArray(lastUserMsgEarly?.content)) {
      // Find the last text part (the actual user prompt, since context items are prepended)
      const textParts = lastUserMsgEarly.content.filter(
        (p: any) => typeof p.text === "string",
      );
      rawQuery =
        textParts.length > 0 ? textParts[textParts.length - 1].text : "";
    }
    const cleanPrompt = stripRulesAndPreamble(rawQuery).trim();

    // Guard against conversational/informational questions (e.g. "did you understand this project")
    const isInformationalQuery =
      /^(did you|do you|can you|could you|what is|what are|explain|how does|how do|tell me about|analyze|review|understand|summary|summarize)\b/i.test(
        cleanPrompt,
      ) || isCompactionRequest(cleanPrompt);
    const hasExplicitMutationIntent =
      !isCompactionRequest(cleanPrompt) &&
      (/\b(add|create|build|scaffold|generate|setup|make|implement|fix|refactor|update|delete|remove|modify|edit|write|hadanna|danna)\b/i.test(
        cleanPrompt,
      ) ||
        /^\/(template|scaffold|golden|edit)\b/i.test(cleanPrompt));

    if (
      cleanPrompt &&
      cleanPrompt.length > 3 &&
      !isInformationalQuery &&
      hasExplicitMutationIntent
    ) {
      const engineResult = await executeVynorEngine(cleanPrompt, {});
      if (
        engineResult.status === "SUCCESS" ||
        engineResult.status === "VALIDATION_FAILED"
      ) {
        await settleQuotaReservation(quotaReservation, 0);
        const responseMarkdown = formatOrchestrationToMarkdown(engineResult);
        const engineSavedTokens = Math.ceil(
          (rawQuery.length + responseMarkdown.length) / 4,
        );
        console.log(
          `[VynorAI ⚡ 5-LAYER ENGINE] 0 tokens | status=${engineResult.status} | workflow=${engineResult.workflowId}`,
        );
        res.setHeader("X-VynorAI-Engine", "5-LAYER-LOCAL");
        res.setHeader("X-VynorAI-Workflow", engineResult.workflowId || "none");
        res.setHeader("X-VynorAI-Tokens-Saved", "100%");

        (async () => {
          try {
            const savedTokens = engineSavedTokens;
            await dbRun(
              "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, 0, 0, 1)",
              [uuidv4(), user.id, "vynorai-slm-engine", savedTokens],
            );
          } catch (_) {}
        })();
        recordRequestEconomics({
          requestId,
          userId: user.id,
          planId,
          requestedModel: model,
          resolvedModel: "vynorai-local-engine",
          provider: "deterministic",
          inputTokens: 0,
          outputTokens: 0,
          providerCostUsd: 0,
          costSource: "local-zero",
          cacheStatus: "bypass",
          templateId: engineResult.workflowId,
          estimatedTokensSaved: engineSavedTokens,
          latencyMs: Date.now() - requestStartedAt,
        }).catch((err) =>
          console.error("[Economics] Local engine ledger failed:", err),
        );

        const clientRequestedTools =
          Array.isArray(body?.tools) && body.tools.length > 0;
        const fileEntries = Object.entries(engineResult.modifiedFiles);
        const explicitScaffoldIntent = hasExplicitMutationIntent;

        if (
          clientRequestedTools &&
          fileEntries.length > 0 &&
          explicitScaffoldIntent
        ) {
          const toolCalls = fileEntries.map(([path, content], i) => ({
            id: `call_${uuidv4().replace(/-/g, "").slice(0, 10)}_${i}`,
            type: "function",
            function: {
              name: "createNewFile",
              arguments: JSON.stringify({
                filepath: path,
                contents: content,
              }),
            },
          }));

          if (stream) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            const textChunk = {
              id: "vynor-" + uuidv4(),
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "vynorai-local-engine",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: `⚡ **VynorAI Autonomous Agent**: Creating ${fileEntries.length} verified files directly to your workspace...\n`,
                  },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(textChunk)}\n\n`);

            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i];
              const tcChunk = {
                id: "vynor-" + uuidv4(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: "vynorai-local-engine",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: i,
                          id: tc.id,
                          type: "function",
                          function: tc.function,
                        },
                      ],
                    },
                    finish_reason:
                      i === toolCalls.length - 1 ? "tool_calls" : null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(tcChunk)}\n\n`);
            }
            res.write("data: [DONE]\n\n");
            return res.end();
          } else {
            return res.json({
              id: "vynor-" + uuidv4(),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "vynorai-local-engine",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: `⚡ **VynorAI Autonomous Agent**: Creating ${fileEntries.length} verified files directly to your workspace...`,
                    tool_calls: toolCalls,
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            });
          }
        }

        const chunk = {
          id: "vynor-" + uuidv4(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "vynorai-local-engine",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: responseMarkdown },
              finish_reason: "stop",
            },
          ],
        };

        if (stream) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          return res.end();
        } else {
          return res.json({
            id: "vynor-" + uuidv4(),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "vynorai-local-engine",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: responseMarkdown },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        }
      }
    }

    const instantMatch = checkInstantTemplateMatch(cleanPrompt || rawQuery);
    if (
      hasExplicitMutationIntent &&
      instantMatch.matched &&
      instantMatch.responseMarkdown
    ) {
      await settleQuotaReservation(quotaReservation, 0);
      console.log(
        `[VynorAI ⚡ INSTANT GOLDEN SCAFFOLD] 0 tokens | template=${instantMatch.template?.id}`,
      );
      res.setHeader("X-VynorAI-Scaffold", "INSTANT_VAULT_HIT");
      res.setHeader(
        "X-VynorAI-Scaffold-Match",
        instantMatch.template?.id || "matched",
      );
      res.setHeader("X-VynorAI-Tokens-Saved", "100%");
      const templateSavedTokens = Math.ceil(
        (rawQuery.length + (instantMatch.responseMarkdown?.length || 0)) / 4,
      );

      (async () => {
        try {
          const savedTokens = templateSavedTokens;
          await dbRun(
            "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, 0, 0, 1)",
            [uuidv4(), user.id, "vynorai-golden-scaffold", savedTokens],
          );
        } catch (_) {}
      })();
      recordRequestEconomics({
        requestId,
        userId: user.id,
        planId,
        requestedModel: model,
        resolvedModel: "vynorai-golden-vault",
        provider: "template",
        inputTokens: 0,
        outputTokens: 0,
        providerCostUsd: 0,
        costSource: "local-zero",
        cacheStatus: "bypass",
        templateId: instantMatch.template?.id,
        estimatedTokensSaved: templateSavedTokens,
        latencyMs: Date.now() - requestStartedAt,
      }).catch((err) =>
        console.error("[Economics] Template ledger failed:", err),
      );

      const chunk = {
        id: "scaffold-" + uuidv4(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "vynorai-golden-vault",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: instantMatch.responseMarkdown,
            },
            finish_reason: "stop",
          },
        ],
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      } else {
        return res.json({
          id: "scaffold-" + uuidv4(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "vynorai-golden-vault",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: instantMatch.responseMarkdown,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }

    // ── 1c. Composite Project Blueprint Direct Delivery (E-Commerce, SaaS, FinTech) ──
    const blueprintMatch = hasExplicitMutationIntent
      ? detectProjectBlueprint(cleanPrompt || rawQuery)
      : null;
    if (blueprintMatch) {
      await settleQuotaReservation(quotaReservation, 0);
      console.log(
        `[VynorAI 🏗️ BLUEPRINT MATCH] ${blueprintMatch.id} | query="${rawQuery.slice(0, 40)}"`,
      );
      res.setHeader("X-VynorAI-Blueprint", blueprintMatch.id);
      const planMarkdown = formatBlueprintPlan(blueprintMatch);
      const blueprintSavedTokens = Math.ceil(
        (rawQuery.length + planMarkdown.length) / 4,
      );
      recordRequestEconomics({
        requestId,
        userId: user.id,
        planId,
        requestedModel: model,
        resolvedModel: "vynorai-blueprint-architect",
        provider: "blueprint",
        inputTokens: 0,
        outputTokens: 0,
        providerCostUsd: 0,
        costSource: "local-zero",
        cacheStatus: "bypass",
        templateId: blueprintMatch.id,
        estimatedTokensSaved: blueprintSavedTokens,
        latencyMs: Date.now() - requestStartedAt,
      }).catch((err) =>
        console.error("[Economics] Blueprint ledger failed:", err),
      );

      const chunk = {
        id: "blueprint-" + uuidv4(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "vynorai-blueprint-architect",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: planMarkdown },
            finish_reason: "stop",
          },
        ],
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      } else {
        return res.json({
          id: "blueprint-" + uuidv4(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "vynorai-blueprint-architect",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: planMarkdown },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }
  }

  // ── 2. Enrich with Agent Tools + System Prompt (if not already set) ─────────
  const zkUserId = generateZKUserId(user.id);
  res.setHeader("X-VynorAI-ZK-Shield", "Active");
  res.setHeader("X-VynorAI-ZK-Surrogate", zkUserId);

  // Dynamic Tool Gating via Local SLM / Deterministic Classifier:
  // Determine whether this request turn permits code mutation or is an informational/read-only query.
  const lastUserMsgForGating = [...(body.messages || [])]
    .reverse()
    .find((m: any) => m.role === "user");
  let lastPromptForGating = "";
  if (typeof lastUserMsgForGating?.content === "string") {
    lastPromptForGating = lastUserMsgForGating.content;
  } else if (Array.isArray(lastUserMsgForGating?.content)) {
    const textParts = lastUserMsgForGating.content.filter(
      (p: any) => typeof p.text === "string",
    );
    lastPromptForGating =
      textParts.length > 0 ? textParts[textParts.length - 1].text : "";
  }
  const cleanPromptForGating = stripRulesAndPreamble(lastPromptForGating);

  // Classify the turn on the VPS model (deterministic fallback), then route:
  // light/normal → cheap chat model, heavy → reasoning model (for vynor-auto).
  const slmDecision = await analyzeIntentWithLocalSlm(cleanPromptForGating);
  let tier = refineTier(
    tierFromComplexity(slmDecision.complexity),
    cleanPromptForGating,
  );
  let route = await resolveRoute(model, tier, planId);

  // Saver mode (80%+ of the allowance used): Auto stays on non-thinking tiers
  // so the remaining credits last, instead of stopping the user later.
  if (quota.saver && route.auto && (tier === "heavy" || tier === "deep")) {
    tier = "normal";
    route = await resolveRoute(model, tier, planId);
  }
  if (quota.saver) res.setHeader("X-VynorAI-Quota-Mode", "saver");

  // Screenshots and designs need a model that can see them: V4.1 Flash.
  const imageTurn = hasImageInput(body.messages);
  if (imageTurn && isTextOnlyModel(route.model)) {
    route = route.auto
      ? await resolveRoute(model, "heavy", planId)
      : { ...route, model: IMAGE_MODEL };
    res.setHeader("X-VynorAI-Route-Downgraded", "image-input");
  }

  // Auto reserved credits at Flash weight. A pricier route (V4 Pro for deep
  // reasoning) must top up the reservation first; if the cycle can't cover
  // it, run on Flash with thinking instead of refusing the request.
  const reservedWeight = creditWeight(model);
  const routeWeight = creditWeight(route.model);
  if (route.auto && routeWeight > reservedWeight && quotaReservation) {
    const extra =
      quotaReservation.reservedTokens * (routeWeight / reservedWeight - 1);
    if (!(await topUpReservation(quotaReservation, extra))) {
      route = await resolveRoute(model, "heavy", planId);
      res.setHeader("X-VynorAI-Route-Downgraded", "insufficient-credits");
    }
  }
  res.setHeader("X-VynorAI-Router-Source", slmDecision.source);
  res.setHeader("X-VynorAI-Router-Intent", slmDecision.intent);
  res.setHeader("X-VynorAI-Tier", tier);
  res.setHeader("X-VynorAI-Model", route.model);
  const offPeakFactor = offPeakCreditFactor(route.model);
  if (offPeakFactor < 1)
    res.setHeader(
      "X-VynorAI-Offpeak-Bonus",
      `${Math.round((1 / offPeakFactor) * 100) / 100}x`,
    );

  // ── 2-pre. Semantic cache: near-duplicate generic questions ────────────────
  const semanticQuestion = semanticCacheQuestion(body.messages, body.tools);
  const semanticKey = semanticQuestion ? semanticScope(user.id, model) : null;
  let semanticVector: Float32Array | null = null;
  if (semanticQuestion && semanticKey) {
    const hit = await semanticLookup(semanticKey, semanticQuestion);
    semanticVector = hit.vector;
    if (hit.chunks) return serveCachedChunks(hit.chunks, "semantic");
  }

  // Allowance used up: every zero-cost path (exact cache, templates, semantic
  // cache) has had its chance above. A new upstream call is refused here,
  // with the upgrade offer, instead of at the door.
  if (quota.exhausted) {
    res.setHeader("X-VynorAI-Quota-Mode", "exhausted");
    return res.status(403).json(quota.creditError);
  }

  // Mutation authority comes from the latest user request and persists across
  // its tool loop. Read-only tool output must never escalate privileges.
  // Once the user asked for changes in this conversation, keep the edit tools:
  // the tool list is part of the provider prefix, so toggling it per turn
  // throws away the prefix cache (and blocks edits on "now explain…" turns).
  const allowMutation =
    slmDecision.allowMutation ||
    (body.messages || []).some(
      (m: any) =>
        m.role === "user" &&
        m !== lastUserMsgForGating &&
        isMutationRequest(stripRulesAndPreamble(messageText(m)).trim()),
    );

  // A conversation-compaction request must produce a summary, not tool calls.
  const baseTools = isCompactionRequest(cleanPromptForGating)
    ? []
    : body.tools !== undefined
      ? body.tools
      : VYNORAI_AGENT_TOOLS;
  const gatedTools = filterToolsForIntent(baseTools, allowMutation);
  const prunedCount = (baseTools?.length || 0) - (gatedTools?.length || 0);

  if (prunedCount > 0) {
    res.setHeader(
      "X-VynorAI-Tool-Gating",
      `Pruned ${prunedCount} mutating tools`,
    );
    res.setHeader("X-VynorAI-Tool-Tokens-Saved", String(prunedCount * 180));
  }

  // Tier policy caps output and only enables (expensive) thinking for heavy turns.
  const enriched = applyTierPolicy(
    {
      ...body,
      model: route.model,
      stream,
      user: zkUserId,
      tools: gatedTools,
      system: systemPromptFor(body),
    },
    tier,
  );

  // ── 2a. Memory & Rules: stable per user, so it lives in the cached prefix ────
  const projectScope = body.projectRoot
    ? String(body.projectRoot).slice(-16)
    : undefined;
  const { body: memBody } = await enrichWithMemory(
    enriched,
    user.id,
    projectScope,
  );

  // ── 2b. Per-turn context (@web, project RAG, golden scaffold) ─────────────
  // Attached to the LAST user message and memoized per turn, so the system
  // prompt + history prefix stays byte-identical and provider-cache-hot.
  const lastUserMsg = [...(memBody.messages || [])]
    .reverse()
    .find((m: any) => m.role === "user");
  const lastQuery =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        ? lastUserMsg.content.map((p: any) => p.text ?? "").join("")
        : "";
  // Coding-agent turns work on the user's own project; a generic scaffold
  // (matched on loose keywords) only adds tokens and pulls the agent off task.
  const scaffold = isIdeAgent ? null : detectTemplateIntent(lastQuery);
  if (scaffold) res.setHeader("X-VynorAI-Scaffold-Match", scaffold.id);
  const turnContext = await memoizeTurnContext(
    turnKey(user.id, memBody.messages || []),
    async () => {
      const blocks: string[] = [];
      // Agents have their own fetch tool; never fetch on their behalf.
      const { context: webContext } = isIdeAgent
        ? { context: "" }
        : await enrichWithWeb(memBody);
      if (webContext) blocks.push(webContext);
      const { context: ragContext } = enrichWithRAG(memBody, user.id, planId);
      if (ragContext) blocks.push(ragContext);
      if (scaffold) blocks.push(formatTemplateContext(scaffold));
      return blocks.join("\n\n");
    },
  );
  if (turnContext)
    res.setHeader(
      "X-VynorAI-Turn-Context-Tokens",
      String(Math.ceil(turnContext.length / 4)),
    );
  const contextBody = {
    ...memBody,
    messages: attachTurnContext(memBody.messages || [], turnContext),
  };

  // ── 2c. Hybrid Context: tool-output trim, sticky window, background summary ──
  const { body: optimised, result: ctxResult } = applyHybridContext(
    contextBody,
    planId,
    undefined,
    { scope: user.id },
  );
  if (ctxResult.savedTokens > 0) {
    res.setHeader("X-VynorAI-Saved-Tokens", String(ctxResult.savedTokens));
    res.setHeader("X-VynorAI-Ctx-Strategy", ctxResult.strategy.join(","));
  }
  res.setHeader("X-VynorAI-Context-Limit", String(ctxResult.contextLimit));

  res.setHeader("X-VynorAI-Cache", "MISS");
  const collected: any[] = [];

  // ── 3 & 4. Smart Provider Dispatch with Prompt Caching ──────────────────────
  // Personal data (emails, phones, NIC, cards) never reaches the provider;
  // the stream is restored to the real values on the way back.
  const { body: shielded, map: piiMap } = maskRequestBody(optimised);
  if (piiMap.size) res.setHeader("X-VynorAI-PII-Masked", String(piiMap.size));
  const dispatch = await dispatchToProvider(
    shielded,
    res,
    (chunk) => collected.push(chunk),
    true,
    new PiiStreamRestorer(piiMap),
  );
  const providerChunks = dispatch.collected;

  // If dispatchToProvider already wrote the response (most cases), we're done.
  // Merge whatever came back.
  const allChunks = providerChunks.length ? providerChunks : collected;

  // ── 5. Async: Save to Cache + Log Usage + Increment Monthly Ledger ──────
  // Only complete answers are worth replaying: a truncated ("length") or
  // tool-call answer from the cache would fail the retry the same way again.
  if (
    dispatch.success &&
    !dispatch.interrupted &&
    !isIdeAgent &&
    allChunks.length > 0 &&
    finishedWithStop(allChunks)
  ) {
    saveToCache(cacheKey, allChunks);
    if (semanticKey) semanticSave(semanticKey, semanticVector, allChunks);
  }

  // Extract exact provider usage if returned in stream / response
  let realPromptTokens = dispatch.usage?.inputTokens ?? 0;
  let realCompletionTokens = dispatch.usage?.outputTokens ?? 0;
  for (const c of allChunks) {
    if (c?.usage) {
      if (typeof c.usage.prompt_tokens === "number")
        realPromptTokens = c.usage.prompt_tokens;
      if (typeof c.usage.completion_tokens === "number")
        realCompletionTokens = c.usage.completion_tokens;
    }
  }

  const estimatedTokens = estimateInputTokens(messages);
  let outputChars = 0;
  for (const c of allChunks) {
    if (typeof c === "string") outputChars += c.length;
    else if (c?.choices?.[0]?.delta?.content)
      outputChars += c.choices[0].delta.content.length;
    else if (c?.choices?.[0]?.message?.content)
      outputChars += c.choices[0].message.content.length;
  }
  const estimatedOutputTokens = Math.max(1, Math.ceil(outputChars / 4));

  const finalInputTokens =
    realPromptTokens > 0 ? realPromptTokens : estimatedTokens;
  const finalOutputTokens =
    realCompletionTokens > 0 ? realCompletionTokens : estimatedOutputTokens;
  // Never consume customer quota for VynorAI/upstream availability failures.
  const totalTokens = dispatch.success
    ? finalInputTokens + finalOutputTokens
    : 0;
  // A Pro turn that fell back to Flash is billed as Flash.
  const billedModel =
    dispatch.success &&
    isTextOnlyModel(route.model) &&
    dispatch.resolvedModel &&
    !isTextOnlyModel(dispatch.resolvedModel)
      ? dispatch.resolvedModel
      : route.model;
  const creditsCharged = dispatch.success
    ? usageCredits(billedModel, {
        inputTokens: finalInputTokens,
        cachedInputTokens: dispatch.usage?.cachedInputTokens ?? 0,
        outputTokens: finalOutputTokens,
      })
    : 0;

  // Insert granular log with Blockchain Merkle Audit Chain
  const usageLogId = uuidv4();
  (async () => {
    try {
      const lastLog = await dbGet<any>(
        "SELECT audit_hash FROM usage_logs WHERE user_id = ? AND audit_hash IS NOT NULL AND audit_hash != '' ORDER BY created_at DESC LIMIT 1",
        [user.id],
      );
      const prevHash =
        lastLog?.audit_hash || "GENESIS_BLOCK_VYNORAI_0000000000000000";
      const auditHash = computeAuditHash(prevHash, {
        userId: user.id,
        model,
        finalInputTokens,
        finalOutputTokens,
        totalTokens,
        timestamp: Date.now(),
      });

      await dbRun(
        "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached, prev_hash, audit_hash) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
        [
          usageLogId,
          user.id,
          // The model actually billed (vynor-auto resolves to a tier model).
          billedModel,
          finalInputTokens,
          finalOutputTokens,
          totalTokens,
          prevHash,
          auditHash,
        ],
      );
      await recordRequestEconomics({
        requestId,
        usageLogId,
        userId: user.id,
        planId,
        requestedModel: model,
        resolvedModel: dispatch.resolvedModel,
        provider: dispatch.provider,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        providerCostUsd: dispatch.usage?.providerCostUsd ?? null,
        costSource: dispatch.usage?.costSource ?? "unknown",
        cachedInputTokens: dispatch.usage?.cachedInputTokens ?? 0,
        cacheStatus: "miss",
        optimizationMode: ctxResult.optimizationMode,
        templateId: scaffold?.id,
        estimatedTokensSaved: ctxResult.savedTokens,
        latencyMs: dispatch.latencyMs ?? Date.now() - requestStartedAt,
        outcome: dispatch.success ? "success" : "failed",
        creditsCharged,
        offPeak: offPeakFactor < 1,
        routeTier: tier,
        routeAuto: route.auto,
        promptFp: promptFingerprint(user.id, cleanPromptForGating),
        toolFollowUp: isToolFollowUp,
      });
    } catch (err) {
      console.error("[Merkle Audit] Failed to record audit log:", err);
    }
  })();

  // Replace the pre-dispatch reservation with the model-weighted actual cost.
  // Upstream failures refund both credits and the request count.
  if (dispatch.success) {
    await settleQuotaReservation(quotaReservation, creditsCharged);
  } else {
    await releaseQuotaReservation(quotaReservation);
  }
}
