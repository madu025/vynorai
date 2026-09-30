/**
 * VynorAI Provider Router v3 — OpenRouter as Primary Upstream
 * 
 * Business Model:
 *   VynorAI buys tokens from OpenRouter at wholesale (market) rates.
 *   Users subscribe to VynorAI at a markup.
 *   VynorAI adds: caching layer, agentic tools, quota management, circuit breakers.
 *   Profit = subscription revenue - OpenRouter cost - infrastructure.
 *
 * Fallback Priority:
 *   1. OpenRouter (primary - 300+ models, single API key)
 *   2. Direct provider keys (optional cost optimisation)
 *   3. Ollama local (always available, free)
 */

import { Response } from "express";
import { config, resolveModelId, isOpenRouterModelId, DEFAULT_CHAT_MODEL, ProviderID } from "../config.js";
import { compressCodeSnippet } from "./tokenOptimizer.js";
import { canUseProvider, recordSuccess, recordFailure } from "./circuitBreaker.js";
import { v4 as uuidv4 } from "uuid";

// ─── Endpoint Info ────────────────────────────────────────────────────────────
interface EndpointInfo {
  baseUrl: string;
  headers: Record<string, string>;
  isAnthropic: boolean;
  isOllama: boolean;
  provider: ProviderID;
}

function buildEndpoints(): Partial<Record<ProviderID, EndpointInfo>> {
  const k = config.aiKeys;
  const eps: Partial<Record<ProviderID, EndpointInfo>> = {};

  // ── OpenRouter (primary – buy wholesale, sell retail) ─────────────────
  if (k.openrouter) {
    eps.openrouter = {
      baseUrl: "https://openrouter.ai/api/v1",
      headers: {
        Authorization: `Bearer ${k.openrouter}`,
        "HTTP-Referer": "https://vynorai.com",
        "X-Title": "VynorAI",
        "Content-Type": "application/json",
      },
      isAnthropic: false,
      isOllama: false,
      provider: "openrouter",
    };
  }

  // ── Direct providers (optional – override specific model families) ─────
  if (k.deepseek) eps.deepseek = {
    baseUrl: "https://api.deepseek.com/v1",
    headers: { Authorization: `Bearer ${k.deepseek}`, "Content-Type": "application/json" },
    isAnthropic: false, isOllama: false, provider: "deepseek",
  };

  if (k.openai) eps.openai = {
    baseUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${k.openai}`, "Content-Type": "application/json" },
    isAnthropic: false, isOllama: false, provider: "openai",
  };

  if (k.anthropic) eps.anthropic = {
    baseUrl: "https://api.anthropic.com/v1",
    headers: {
      "x-api-key": k.anthropic,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    isAnthropic: true, isOllama: false, provider: "anthropic",
  };

  if (k.groq) eps.groq = {
    baseUrl: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${k.groq}`, "Content-Type": "application/json" },
    isAnthropic: false, isOllama: false, provider: "groq",
  };

  // Ollama always available (local)
  eps.ollama = {
    baseUrl: k.ollama,
    headers: { "Content-Type": "application/json" },
    isAnthropic: false, isOllama: true, provider: "ollama",
  };

  return eps;
}

// ─── Provider selection per model ─────────────────────────────────────────────
function selectProviderChain(model: string): ProviderID[] {
  const eps = buildEndpoints();

  // For OpenRouter-format models (e.g. "anthropic/claude-sonnet-4-6") always
  // prefer OpenRouter. Direct-provider keys only used for Ollama local models.
  if (isOpenRouterModelId(model)) {
    const chain: ProviderID[] = ["openrouter"];
    if (eps.deepseek) chain.push("deepseek");
    if (eps.openai)   chain.push("openai");
    chain.push("ollama");
    return chain;
  }

  // Short-name model → still prefer OpenRouter
  const chain: ProviderID[] = [];
  if (eps.openrouter) chain.push("openrouter");
  if (eps.deepseek)   chain.push("deepseek");
  if (eps.openai)     chain.push("openai");
  chain.push("ollama");
  return chain;
}

// ─── Payload Builders ─────────────────────────────────────────────────────────
function buildAnthropicPayload(body: any, resolvedModel: string): any {
  const { messages = [], system, tools, max_tokens = 8192, stream = true } = body;
  const msgs = messages.map((msg: any, idx: number) => {
    let content = msg.content;
    if (typeof content === "string") content = compressCodeSnippet(content);
    const isLarge = typeof content === "string" && content.length > 1500;
    const isPenultimate = idx === messages.length - 2 && msg.role === "user";
    if (isLarge && isPenultimate)
      return { role: msg.role, content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }] };
    return { role: msg.role, content };
  });
  const systemBlocks = system ? [{ type: "text", text: typeof system === "string" ? system : JSON.stringify(system), cache_control: { type: "ephemeral" } }] : undefined;
  return { model: resolvedModel, max_tokens, stream, ...(systemBlocks ? { system: systemBlocks } : {}), messages: msgs };
}

function buildOpenAIPayload(body: any, resolvedModel: string): any {
  const { messages = [], ...rest } = body;
  return {
    ...rest,
    model: resolvedModel,
    messages: messages.map((msg: any) => ({
      ...msg,
      content: typeof msg.content === "string" ? compressCodeSnippet(msg.content) : msg.content,
    })),
  };
}

// ─── Execute request against one provider ────────────────────────────────────
async function executeWithEndpoint(
  endpoint: EndpointInfo,
  resolvedModel: string,
  body: any,
  res: Response,
  onChunk?: (c: any) => void
): Promise<any[]> {
  const isStream = body.stream !== false;

  const payload  = endpoint.isAnthropic
    ? buildAnthropicPayload(body, resolvedModel)
    : buildOpenAIPayload(body, resolvedModel);

  const fetchUrl = endpoint.isAnthropic
    ? `${endpoint.baseUrl}/messages`
    : `${endpoint.baseUrl}/chat/completions`;

  const t0 = Date.now();
  const response = await fetch(fetchUrl, {
    method: "POST",
    headers: endpoint.headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(new Error(`${endpoint.provider} HTTP ${response.status}: ${text.slice(0, 300)}`), { status: response.status });
  }

  const collected: any[] = [];

  if (isStream) {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-VynorAI-Provider", endpoint.provider);

    if (response.body) {
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (endpoint.isAnthropic) {
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                const chunk = { id: `chatcmpl-${uuidv4()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }] };
                collected.push(chunk); onChunk?.(chunk);
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              } else if (evt.type === "message_stop") {
                res.write("data: [DONE]\n\n");
              }
            } catch {}
          }
        } else {
          // OpenRouter / OpenAI / Groq native SSE passthrough
          res.write(value);
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try { const c = JSON.parse(line.slice(6)); collected.push(c); onChunk?.(c); } catch {}
            }
          }
        }
      }
      res.end();
    }
  } else {
    const data = await response.json();
    if (endpoint.isAnthropic) {
      const norm = { id: data.id || uuidv4(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: resolvedModel, choices: [{ index: 0, message: { role: "assistant", content: data.content?.[0]?.text || "" }, finish_reason: "stop" }], usage: data.usage || {} };
      collected.push(norm); res.json(norm);
    } else {
      collected.push(data); res.json(data);
    }
  }

  recordSuccess(endpoint.provider, Date.now() - t0);
  return collected;
}

// ─── Public Dispatch ─────────────────────────────────────────────────────────
export async function dispatchToProvider(
  body: any,
  res: Response,
  onChunk?: (c: any) => void
): Promise<{ success: boolean; collected: any[]; provider?: ProviderID }> {
  const rawModel     = body.model || DEFAULT_CHAT_MODEL;
  const resolvedModel = resolveModelId(rawModel);   // "deepseek-v3" → "deepseek/deepseek-chat-v3-0324"
  const chain        = selectProviderChain(resolvedModel);
  const endpoints    = buildEndpoints();

  for (const providerKey of chain) {
    const endpoint = endpoints[providerKey];
    if (!endpoint) continue;

    if (!canUseProvider(providerKey)) {
      console.warn(`[Router] Circuit OPEN for ${providerKey} — skipping`);
      continue;
    }

    try {
      const collected = await executeWithEndpoint(endpoint, resolvedModel, body, res, onChunk);
      console.log(`[Router] ✅ ${providerKey} → "${resolvedModel}"`);
      return { success: true, collected, provider: providerKey };
    } catch (err: any) {
      if (err.status !== 401 && err.status !== 403) recordFailure(providerKey, err.message);
      console.warn(`[Router] ⚠️  ${providerKey} failed: ${err.message} — trying next…`);
    }
  }

  return sendServiceUnavailable(body, resolvedModel, res);
}

async function sendServiceUnavailable(
  body: any,
  resolvedModel: string,
  res: Response
): Promise<{ success: boolean; collected: any[] }> {
  const isStream = body.stream !== false;
  const msg = `⚡ **VynorAI**: Service temporarily unavailable for \`${resolvedModel}\`. Auto-recovering — please retry in 30s.`;
  const chunk = {
    id: `chatcmpl-${uuidv4()}`,
    object: isStream ? "chat.completion.chunk" : "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    choices: [{ index: 0, [isStream ? "delta" : "message"]: { role: "assistant", content: msg }, finish_reason: "stop" }],
  };
  if (isStream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.status(503).json(chunk);
  }
  return { success: false, collected: [chunk] };
}

export { buildEndpoints };
