import { Response } from "express";
import { dbGet, dbRun } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { generateCacheKey, getFromCache, saveToCache } from "./cacheEngine.js";
import { VYNORAI_AGENT_TOOLS, VYNORAI_AGENT_SYSTEM_PROMPT } from "./agentEngine.js";
import { dispatchToProvider } from "./providerRouter.js";
import { estimateInputTokens } from "./quotaGuard.js";
import { DEFAULT_CHAT_MODEL } from "../config.js";
import { applyHybridContext } from "./hybridContext.js";
import { enrichWithRAG } from "./ragEngine.js";
import { enrichWithWeb } from "./webSearch.js";
import { enrichWithMemory } from "./memoryEngine.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  apiKey: string;
  hasActiveSubscription: boolean;
  subscriptionPlan?: string;
  validUntil?: string;
}

export async function authenticateApiKey(authHeader?: string): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.replace("Bearer ", "").trim();

  const user = await dbGet<any>(
    "SELECT id, email, name, api_key as apiKey FROM users WHERE api_key = ?",
    [apiKey]
  );
  if (!user) return null;

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
      return res.json(cached.responseChunks[0] || {});
    }
  }

  // ── 2. Enrich with Agent Tools + System Prompt (if not already set) ─────────
  const enriched = {
    ...body,
    model,
    stream,
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

  // ── 2d. Hybrid Context: plan-aware trim + compress ────────────────────────
  const { body: optimised, result: ctxResult } = applyHybridContext(ragBody, planId);
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

  const estimatedTokens = estimateInputTokens(messages);
  // Estimate output tokens based on returned chunks
  let outputChars = 0;
  for (const c of allChunks) {
    if (typeof c === "string") outputChars += c.length;
    else if (c?.choices?.[0]?.delta?.content) outputChars += c.choices[0].delta.content.length;
    else if (c?.choices?.[0]?.message?.content) outputChars += c.choices[0].message.content.length;
  }
  const estimatedOutputTokens = Math.max(1, Math.ceil(outputChars / 4));
  const totalTokens = estimatedTokens + estimatedOutputTokens;

  // Insert granular log
  dbRun(
    "INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [uuidv4(), user.id, model, estimatedTokens, estimatedOutputTokens, totalTokens]
  ).catch(console.error);

  // Increment monthly ledger atomically
  import("./monthlyQuota.js").then(({ incrementMonthlyUsage }) => {
    incrementMonthlyUsage(user.id, totalTokens, 1).catch(console.error);
  });
}

