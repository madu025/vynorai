import { Response } from "express";
import { dbGet, dbRun } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { generateCacheKey, getFromCache, saveToCache } from "./cacheEngine.js";
import { VYNORAI_AGENT_TOOLS, VYNORAI_AGENT_SYSTEM_PROMPT } from "./agentEngine.js";
import { dispatchToProvider } from "./providerRouter.js";
import { estimateInputTokens } from "./quotaGuard.js";
import { DEFAULT_CHAT_MODEL } from "../config.js";
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
} from "./templateVault.js";
import { detectProjectBlueprint, formatBlueprintPlan } from "./scaffoldRegistry.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  apiKey: string;
  hasActiveSubscription: boolean;
  subscriptionPlan?: string;
  validUntil?: string;
}

export async function authenticateApiKey(authHeader?: string, clientIp?: string): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.replace("Bearer ", "").trim();

  const user = await dbGet<any>(
    "SELECT id, email, name, api_key as apiKey, COALESCE(is_suspended, 0) as is_suspended, allowed_ips FROM users WHERE api_key = ?",
    [apiKey]
  );
  if (!user) return null;
  if (user.is_suspended === 1) {
    console.warn(`[Security] Blocked request from suspended user: ${user.email}`);
    return null;
  }

  // Check IP whitelisting if configured (OpenAI Codex / Kimi Enterprise feature)
  if (user.allowed_ips && user.allowed_ips.trim() && clientIp) {
    const allowed = user.allowed_ips.split(",").map((s: string) => s.trim());
    if (!allowed.includes("*") && !allowed.includes(clientIp)) {
      console.warn(`[Security] IP ${clientIp} not in allowed_ips for user ${user.email}`);
      return null;
    }
  }

  const now = new Date().toISOString();
  const subscription = await dbGet<any>(
    `SELECT plan_name, valid_until FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND valid_until > ?
     ORDER BY valid_until DESC LIMIT 1`,
    [user.id, now]
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    apiKey: user.apiKey,
    hasActiveSubscription: true, // Free tier is active by default for all valid users
    subscriptionPlan: subscription?.plan_name || "free",
    validUntil: subscription?.valid_until || "lifetime",
  };
}


/**
 * Full pipeline:
 * 1. L1/L2 cache check → instant 0-token response
 * 2. Agent tools + system prompt injection
 * 3. Smart provider routing (OpenAI / Anthropic / DeepSeek / Gemini / Groq / Ollama)
 * 4. Anthropic ephemeral cache headers + code compression
 * 5. Async usage logging
 */
export async function handleChatCompletions(
  user: AuthenticatedUser,
  body: any,
  res: Response
) {
  const {
    model = DEFAULT_CHAT_MODEL,
    messages = [],
    stream = true,
    temperature = 0,
  } = body;

  // ── 1. Cache Lookup ─────────────────────────────────────────────────────────
  const cacheKey = generateCacheKey(model, messages, temperature);
  const cached   = await getFromCache(cacheKey);

  if (cached?.responseChunks?.length) {
    console.log(`[VynorAI ⚡ CACHE HIT] 0 tokens | key=${cacheKey.slice(0, 10)}…`);
    res.setHeader("X-VynorAI-Cache", "HIT");

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for (const chunk of cached.responseChunks)
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    } else {
    }
  }

  // ── 1b. 5-Layer Deterministic Local Engineering Engine (0 Tokens & 100% Deterministic) ──
  const lastUserMsgEarly = [...(messages || [])].reverse().find((m: any) => m.role === "user");
  const rawQuery = typeof lastUserMsgEarly?.content === "string"
    ? lastUserMsgEarly.content
    : Array.isArray(lastUserMsgEarly?.content) ? lastUserMsgEarly.content.map((p: any) => p.text ?? "").join("") : "";

  if (rawQuery) {
    const engineResult = await executeVynorEngine(rawQuery, {});
    if (engineResult.status === "SUCCESS" || engineResult.status === "VALIDATION_FAILED") {
      const responseMarkdown = formatOrchestrationToMarkdown(engineResult);
      console.log(`[VynorAI ⚡ 5-LAYER ENGINE] 0 tokens | status=${engineResult.status} | workflow=${engineResult.workflowId}`);
      res.setHeader("X-VynorAI-Engine", "5-LAYER-LOCAL");
      res.setHeader("X-VynorAI-Workflow", engineResult.workflowId || "none");
      res.setHeader("X-VynorAI-Tokens-Saved", "100%");

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
          choices: [{ index: 0, message: { role: "assistant", content: responseMarkdown }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    }
  }

  const instantMatch = checkInstantTemplateMatch(rawQuery);
  if (instantMatch.matched && instantMatch.responseMarkdown) {
    console.log(`[VynorAI ⚡ INSTANT GOLDEN SCAFFOLD] 0 tokens | template=${instantMatch.template?.id}`);
    res.setHeader("X-VynorAI-Scaffold", "INSTANT_VAULT_HIT");
    res.setHeader("X-VynorAI-Scaffold-Match", instantMatch.template?.id || "matched");
    res.setHeader("X-VynorAI-Tokens-Saved", "100%");

    const chunk = {
      id: "scaffold-" + uuidv4(),
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "vynorai-golden-vault",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: instantMatch.responseMarkdown },
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
        choices: [{ index: 0, message: { role: "assistant", content: instantMatch.responseMarkdown }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  }

  // ── 1c. Composite Project Blueprint Direct Delivery (E-Commerce, SaaS, FinTech) ──
  const blueprintMatch = detectProjectBlueprint(rawQuery);
  if (blueprintMatch) {
    console.log(`[VynorAI 🏗️ BLUEPRINT MATCH] ${blueprintMatch.id} | query="${rawQuery.slice(0, 40)}"`);
    res.setHeader("X-VynorAI-Blueprint", blueprintMatch.id);
    const planMarkdown = formatBlueprintPlan(blueprintMatch);

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
        choices: [{ index: 0, message: { role: "assistant", content: planMarkdown }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  }

  // ── 2. Enrich with Agent Tools + System Prompt (if not already set) ─────────
  const zkUserId = generateZKUserId(user.id);
  res.setHeader("X-VynorAI-ZK-Shield", "Active");
  res.setHeader("X-VynorAI-ZK-Surrogate", zkUserId);

  const enriched = {
    ...body,
    model,
    stream,
    user: zkUserId,
    tools: body.tools ?? VYNORAI_AGENT_TOOLS,
    system: body.system ?? VYNORAI_AGENT_SYSTEM_PROMPT,
  };

  // ── 2a. Memory & Rules: inject user's persistent rules + remembered facts ────
  const planId = user.subscriptionPlan || "free";
  const projectScope = body.projectRoot ? String(body.projectRoot).slice(-16) : undefined;
  const { body: memBody } = await enrichWithMemory(enriched, user.id, projectScope);

  // ── 2b. @Web Search: fetch URLs / @web queries in user message ────────────
  const { body: webBody, webResult } = await enrichWithWeb(memBody);
  if (webResult) res.setHeader("X-VynorAI-Web-Results", String(webResult.results.length));

  // ── 2c. Smart RAG: index code files, inject top-K relevant chunks ─────────
  const { body: ragBody, rag } = enrichWithRAG(webBody, user.id, planId);
  if (rag) {
    res.setHeader("X-VynorAI-RAG-Chunks",  String(rag.chunks.length));
    res.setHeader("X-VynorAI-RAG-Saved",   String(rag.savedTokens));
  }

  // ── 2c-2. Golden Scaffold & Template Vault (0-Token Deterministic Injection) ────
  const lastUserMsg = [...(ragBody.messages || [])].reverse().find((m: any) => m.role === "user");
  const lastQuery = typeof lastUserMsg?.content === "string"
    ? lastUserMsg.content
    : Array.isArray(lastUserMsg?.content) ? lastUserMsg.content.map((p: any) => p.text ?? "").join("") : "";
  const scaffold = detectTemplateIntent(lastQuery);
  let scaffoldBody = ragBody;
  if (scaffold) {
    res.setHeader("X-VynorAI-Scaffold-Match", scaffold.id);
    res.setHeader("X-VynorAI-Scaffold-Saved", "80%");
    const scaffoldContext = formatTemplateContext(scaffold);
    const systemIdx = (scaffoldBody.messages || []).findIndex((m: any) => m.role === "system");
    const updatedMessages = [...(scaffoldBody.messages || [])];
    if (systemIdx >= 0) {
      updatedMessages[systemIdx] = {
        ...updatedMessages[systemIdx],
        content: updatedMessages[systemIdx].content + "\n\n" + scaffoldContext,
      };
    } else {
      updatedMessages.unshift({ role: "system", content: scaffoldContext });
    }
    scaffoldBody = { ...scaffoldBody, messages: updatedMessages };
  }

  // ── 2d. Hybrid Context: plan-aware trim + compress ────────────────────────
  const { body: optimised, result: ctxResult } = applyHybridContext(scaffoldBody, planId);
  if (ctxResult.savedTokens > 0) {
    res.setHeader("X-VynorAI-Saved-Tokens",  String(ctxResult.savedTokens));
    res.setHeader("X-VynorAI-Ctx-Strategy",  ctxResult.strategy.join(","));
  }
  res.setHeader("X-VynorAI-Context-Limit", String(ctxResult.contextLimit));

  res.setHeader("X-VynorAI-Cache", "MISS");
  const collected: any[] = [];

  // ── 3 & 4. Smart Provider Dispatch with Prompt Caching ──────────────────────
  const { collected: providerChunks } = await dispatchToProvider(
    optimised,
    res,
    (chunk) => collected.push(chunk)
  );

  // If dispatchToProvider already wrote the response (most cases), we're done.
  // Merge whatever came back.
  const allChunks = providerChunks.length ? providerChunks : collected;

  // ── 5. Async: Save to Cache + Log Usage + Increment Monthly Ledger ──────
  if (allChunks.length > 0) {
    saveToCache(cacheKey, allChunks);
  }

  // Extract exact provider usage if returned in stream / response
  let realPromptTokens = 0;
  let realCompletionTokens = 0;
  for (const c of allChunks) {
    if (c?.usage) {
      if (typeof c.usage.prompt_tokens === "number") realPromptTokens = c.usage.prompt_tokens;
      if (typeof c.usage.completion_tokens === "number") realCompletionTokens = c.usage.completion_tokens;
    }
  }

  const estimatedTokens = estimateInputTokens(messages);
  let outputChars = 0;
  for (const c of allChunks) {
    if (typeof c === "string") outputChars += c.length;
    else if (c?.choices?.[0]?.delta?.content) outputChars += c.choices[0].delta.content.length;
    else if (c?.choices?.[0]?.message?.content) outputChars += c.choices[0].message.content.length;
  }
  const estimatedOutputTokens = Math.max(1, Math.ceil(outputChars / 4));

  const finalInputTokens = realPromptTokens > 0 ? realPromptTokens : estimatedTokens;
  const finalOutputTokens = realCompletionTokens > 0 ? realCompletionTokens : estimatedOutputTokens;
  const totalTokens = finalInputTokens + finalOutputTokens;

  // Insert granular log with Blockchain Merkle Audit Chain
  (async () => {
    try {
      const lastLog = await dbGet<any>(
        "SELECT audit_hash FROM usage_logs WHERE user_id = ? AND audit_hash IS NOT NULL AND audit_hash != '' ORDER BY created_at DESC LIMIT 1",
        [user.id]
      );
      const prevHash = lastLog?.audit_hash || "GENESIS_BLOCK_VYNORAI_0000000000000000";
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
        [uuidv4(), user.id, model, finalInputTokens, finalOutputTokens, totalTokens, prevHash, auditHash]
      );
    } catch (err) {
      console.error("[Merkle Audit] Failed to record audit log:", err);
    }
  })();

  // Increment monthly ledger atomically
  import("./monthlyQuota.js").then(({ incrementMonthlyUsage }) => {
    incrementMonthlyUsage(user.id, totalTokens, 1).catch(console.error);
  });
}

