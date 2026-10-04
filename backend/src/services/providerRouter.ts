import type { PiiStreamRestorer } from "./piiShield.js";
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
import {
  config,
  resolveModelId,
  isOpenRouterModelId,
  DEFAULT_CHAT_MODEL,
  ProviderID,
} from "../config.js";
import { compressCodeSnippet } from "./tokenOptimizer.js";
import {
  canUseProvider,
  recordSuccess,
  recordFailure,
} from "./circuitBreaker.js";
import { v4 as uuidv4 } from "uuid";
import { extractProviderUsage, ProviderUsage } from "./costLedger.js";

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
        "X-Title": "VynorAI Enterprise",
        "Content-Type": "application/json",
      },
      isAnthropic: false,
      isOllama: false,
      provider: "openrouter",
    };
  }

  // ── Direct providers (optional – override specific model families) ─────
  if (k.deepseek)
    eps.deepseek = {
      baseUrl: "https://api.deepseek.com/v1",
      headers: {
        Authorization: `Bearer ${k.deepseek}`,
        "Content-Type": "application/json",
      },
      isAnthropic: false,
      isOllama: false,
      provider: "deepseek",
    };

  if (k.openai)
    eps.openai = {
      baseUrl: "https://api.openai.com/v1",
      headers: {
        Authorization: `Bearer ${k.openai}`,
        "Content-Type": "application/json",
      },
      isAnthropic: false,
      isOllama: false,
      provider: "openai",
    };

  if (k.anthropic)
    eps.anthropic = {
      baseUrl: "https://api.anthropic.com/v1",
      headers: {
        "x-api-key": k.anthropic,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      isAnthropic: true,
      isOllama: false,
      provider: "anthropic",
    };

  if (k.groq)
    eps.groq = {
      baseUrl: "https://api.groq.com/openai/v1",
      headers: {
        Authorization: `Bearer ${k.groq}`,
        "Content-Type": "application/json",
      },
      isAnthropic: false,
      isOllama: false,
      provider: "groq",
    };

  // Ollama always available (local)
  eps.ollama = {
    baseUrl: k.ollama,
    headers: { "Content-Type": "application/json" },
    isAnthropic: false,
    isOllama: true,
    provider: "ollama",
  };

  return eps;
}

// ─── Provider selection per model ─────────────────────────────────────────────
function selectProviderChain(model: string): ProviderID[] {
  const eps = buildEndpoints();

  // For OpenRouter-format models (e.g. "anthropic/claude-sonnet-4-6")
  if (isOpenRouterModelId(model)) {
    const directProvider: ProviderID | null = model.startsWith("deepseek/")
      ? "deepseek"
      : model.startsWith("openai/")
        ? "openai"
        : model.startsWith("anthropic/")
          ? "anthropic"
          : null;
    const directFirst =
      process.env.VYNOR_PROVIDER_STRATEGY !== "openrouter-first";
    const chain: ProviderID[] = [];
    if (directFirst && directProvider && eps[directProvider])
      chain.push(directProvider);
    if (eps.openrouter) chain.push("openrouter");
    if (!directFirst && directProvider && eps[directProvider])
      chain.push(directProvider);
    return chain;
  }

  // Short-name model (e.g. deepseek-chat, deepseek-r1)
  const chain: ProviderID[] = [];
  if (
    eps.deepseek &&
    (model.startsWith("deepseek/") || model.startsWith("deepseek-"))
  )
    chain.push("deepseek");
  if (eps.openrouter) chain.push("openrouter");
  if (eps.openai && model.startsWith("openai/")) chain.push("openai");
  if (!model.includes("/")) chain.push("ollama");
  return chain;
}

/** Legacy reasoning models: thinking is expected even if the request omits it. */
export function isReasoningModel(model: string): boolean {
  return /(^|[-/])(r1|reasoner)($|[-:])/i.test(model);
}

// DeepSeek's direct API serves one hybrid V4 model family ("deepseek-flash",
// "deepseek-v4-pro"); thinking is a per-request switch, not a separate model.
// Older ids (V3, Coder V2, R1) are served by Flash with the matching mode.
function resolveProviderModel(
  provider: ProviderID,
  model: string,
): string | null {
  if (provider === "openrouter") {
    // Direct-API-only ids: degrade to a known OpenRouter model if DeepSeek is down.
    if (/^deepseek\/(deepseek-flash|deepseek-v4-pro)$/.test(model))
      return (
        process.env.OPENROUTER_DEEPSEEK_FALLBACK ||
        "deepseek/deepseek-chat-v3-0324"
      );
    return model;
  }
  if (provider === "openai" && model.startsWith("openai/"))
    return model.slice("openai/".length);
  if (provider === "anthropic" && model.startsWith("anthropic/"))
    return model.slice("anthropic/".length);
  if (
    provider === "deepseek" &&
    (model.startsWith("deepseek/") || model.startsWith("deepseek-"))
  ) {
    if (/v4-pro/i.test(model))
      return process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro";
    return process.env.DEEPSEEK_CHAT_MODEL || "deepseek-flash";
  }
  if (provider === "ollama" && !model.includes("/")) return model;
  return null;
}

// ─── Payload Builders ─────────────────────────────────────────────────────────
export function buildAnthropicPayload(body: any, resolvedModel: string): any {
  const {
    messages = [],
    system,
    tools,
    max_tokens = 8192,
    stream = true,
  } = body;
  const msgs = messages.map((msg: any, idx: number) => {
    if (msg.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id || msg.toolCallId,
            content:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          },
        ],
      };
    }
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      const text =
        typeof msg.content === "string" && msg.content
          ? [{ type: "text", text: msg.content }]
          : [];
      return {
        role: "assistant",
        content: [
          ...text,
          ...msg.tool_calls.map((call: any) => ({
            type: "tool_use",
            id: call.id,
            name: call.function?.name,
            input: (() => {
              try {
                return JSON.parse(call.function?.arguments || "{}");
              } catch {
                return {};
              }
            })(),
          })),
        ],
      };
    }
    let content = msg.content;
    if (typeof content === "string") content = compressCodeSnippet(content);
    const isLarge = typeof content === "string" && content.length > 1500;
    const isPenultimate = idx === messages.length - 2 && msg.role === "user";
    if (isLarge && isPenultimate)
      return {
        role: msg.role,
        content: [
          { type: "text", text: content, cache_control: { type: "ephemeral" } },
        ],
      };
    return { role: msg.role, content };
  });
  const systemBlocks = system
    ? [
        {
          type: "text",
          text: typeof system === "string" ? system : JSON.stringify(system),
          cache_control: { type: "ephemeral" },
        },
      ]
    : undefined;
  const anthropicTools = Array.isArray(tools)
    ? tools.map((tool: any) => ({
        name: tool.function?.name,
        description: tool.function?.description,
        input_schema: tool.function?.parameters ?? {
          type: "object",
          properties: {},
        },
      }))
    : undefined;
  return {
    model: resolvedModel,
    max_tokens,
    stream,
    ...(systemBlocks ? { system: systemBlocks } : {}),
    ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    messages: msgs,
  };
}

/**
 * Translate the generic thinking policy ({ thinking: { type }, reasoning_effort })
 * into each provider's dialect. Thinking is opt-in everywhere: DeepSeek V4
 * defaults it ON, which would bill reasoning tokens on every autocomplete.
 */
export function reasoningParams(
  body: any,
  provider: ProviderID,
): Record<string, any> {
  const requested = body.thinking?.type;
  const enabled =
    requested === "enabled" ||
    (requested === undefined && isReasoningModel(String(body.model ?? "")));
  const effort =
    typeof body.reasoning_effort === "string" ? body.reasoning_effort : "high";

  if (provider === "deepseek") {
    if (!enabled) return { thinking: { type: "disabled" } };
    // DeepSeek accepts low | high | max; budget_tokens is not supported.
    return {
      thinking: { type: "enabled" },
      reasoning_effort:
        effort === "max" ? "max" : effort === "low" ? "low" : "high",
    };
  }
  if (provider === "openrouter") {
    return enabled
      ? { reasoning: { effort: effort === "max" ? "high" : effort } }
      : { reasoning: { enabled: false } };
  }
  return enabled && provider === "openai"
    ? { reasoning_effort: effort === "max" ? "high" : effort }
    : {};
}

/**
 * DeepSeek thinking mode with tools returns 400 unless every prior assistant
 * turn carries reasoning_content. Clients may send it as `reasoning`.
 */
function withReasoningContent(messages: any[]): any[] {
  return messages.map((msg: any) => {
    if (msg.role !== "assistant") return msg;
    const { reasoning, reasoning_details: _details, ...rest } = msg;
    return {
      ...rest,
      reasoning_content: msg.reasoning_content ?? reasoning ?? "",
    };
  });
}

export function buildOpenAIPayload(
  body: any,
  resolvedModel: string,
  provider: ProviderID,
): any {
  const {
    messages = [],
    system,
    projectRoot: _projectRoot,
    optimization_mode: _optimizationMode,
    routing_mode: _routingMode,
    thinking: _thinking,
    reasoning_effort: _reasoningEffort,
    extra_body: _extraBody,
    ...rest
  } = body;
  const isStream = body.stream !== false;
  const reasoning = reasoningParams(body, provider);
  const outMessages =
    provider === "deepseek" ? withReasoningContent(messages) : messages;
  const systemText = system
    ? typeof system === "string"
      ? system
      : JSON.stringify(system)
    : null;
  // DeepSeek/OpenAI cache prefixes automatically; Anthropic models routed via
  // OpenRouter only cache content explicitly marked with cache_control.
  const systemContent =
    systemText &&
    provider === "openrouter" &&
    resolvedModel.startsWith("anthropic/")
      ? [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral" },
          },
        ]
      : systemText;
  return {
    ...rest,
    ...reasoning,
    model: resolvedModel,
    ...(isStream ? { stream_options: { include_usage: true } } : {}),
    ...(provider === "openrouter"
      ? {
          usage: { include: true },
          provider: {
            ...(typeof rest.provider === "object" ? rest.provider : {}),
            data_collection: "deny",
            zdr: true,
          },
        }
      : {}),
    messages: [
      ...(systemContent ? [{ role: "system", content: systemContent }] : []),
      ...outMessages.map((msg: any) => ({
        ...msg,
        content:
          typeof msg.content === "string"
            ? compressCodeSnippet(msg.content)
            : msg.content,
      })),
    ],
  };
}

// ─── Execute request against one provider ────────────────────────────────────
async function executeWithEndpoint(
  endpoint: EndpointInfo,
  resolvedModel: string,
  body: any,
  res: Response,
  onChunk?: (c: any) => void,
  pii?: PiiStreamRestorer,
): Promise<any[]> {
  const isStream = body.stream !== false;

  const payload = endpoint.isAnthropic
    ? buildAnthropicPayload(body, resolvedModel)
    : buildOpenAIPayload(body, resolvedModel, endpoint.provider);

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
    throw Object.assign(
      new Error(
        `${endpoint.provider} HTTP ${response.status}: ${text.slice(0, 300)}`,
      ),
      { status: response.status },
    );
  }

  const collected: any[] = [];

  if (isStream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-VynorAI-Provider", endpoint.provider);

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        sseBuffer += text;
        const completeLines = sseBuffer.split(/\r?\n/);
        sseBuffer = completeLines.pop() ?? "";
        if (endpoint.isAnthropic) {
          for (const line of completeLines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "content_block_delta" && evt.delta?.text) {
                const chunk = {
                  id: `chatcmpl-${uuidv4()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: resolvedModel,
                  choices: [
                    {
                      index: 0,
                      delta: { content: evt.delta.text },
                      finish_reason: null,
                    },
                  ],
                };
                const out = pii?.active ? pii.restoreChunk(chunk) : chunk;
                collected.push(out);
                onChunk?.(out);
                res.write(`data: ${JSON.stringify(out)}\n\n`);
              } else if (evt.type === "message_stop") {
                res.write("data: [DONE]\n\n");
              }
            } catch {}
          }
        } else if (pii?.active) {
          // Personal data was masked: rewrite each event so the user gets
          // the real values back (placeholders split across events are held).
          for (const line of completeLines) {
            if (!line.startsWith("data: ")) continue;
            if (line.includes("[DONE]")) {
              res.write("data: [DONE]\n\n");
              continue;
            }
            try {
              const c = pii.restoreChunk(JSON.parse(line.slice(6)));
              collected.push(c);
              onChunk?.(c);
              res.write(`data: ${JSON.stringify(c)}\n\n`);
            } catch {}
          }
        } else {
          // OpenRouter / OpenAI / Groq native SSE passthrough
          res.write(value);
          for (const line of completeLines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const c = JSON.parse(line.slice(6));
                collected.push(c);
                onChunk?.(c);
              } catch {}
            }
          }
        }
      }
      // A final event without a trailing newline is still in the buffer.
      if (
        pii?.active &&
        sseBuffer.startsWith("data: ") &&
        !sseBuffer.includes("[DONE]")
      ) {
        try {
          const c = pii.restoreChunk(JSON.parse(sseBuffer.slice(6)));
          collected.push(c);
          onChunk?.(c);
          res.write(`data: ${JSON.stringify(c)}

`);
        } catch {}
      }
      res.end();
    }
  } else {
    const data = await response.json();
    if (endpoint.isAnthropic) {
      const norm = {
        id: data.id || uuidv4(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: resolvedModel,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: data.content?.[0]?.text || "",
            },
            finish_reason: "stop",
          },
        ],
        usage: data.usage || {},
      };
      collected.push(norm);
      res.json(norm);
    } else {
      const out = pii?.active ? pii.restoreFull(data) : data;
      collected.push(out);
      res.json(out);
    }
  }

  recordSuccess(endpoint.provider, Date.now() - t0);
  return collected;
}

// ─── Public Dispatch ─────────────────────────────────────────────────────────
export async function dispatchToProvider(
  body: any,
  res: Response,
  onChunk?: (c: any) => void,
  allowProFallback = true,
  pii?: PiiStreamRestorer,
): Promise<{
  success: boolean;
  collected: any[];
  provider?: ProviderID;
  resolvedModel?: string;
  usage?: ProviderUsage;
  latencyMs?: number;
}> {
  const rawModel = body.model || DEFAULT_CHAT_MODEL;
  const resolvedModel = resolveModelId(rawModel); // "deepseek-v3" → "deepseek/deepseek-chat-v3-0324"
  const chain = selectProviderChain(resolvedModel);
  const endpoints = buildEndpoints();

  for (const providerKey of chain) {
    const endpoint = endpoints[providerKey];
    if (!endpoint) continue;

    if (!canUseProvider(providerKey)) {
      console.warn(`[Router] Circuit OPEN for ${providerKey} — skipping`);
      continue;
    }

    try {
      const providerModel = resolveProviderModel(providerKey, resolvedModel);
      if (!providerModel) continue;
      const startedAt = Date.now();
      const collected = await executeWithEndpoint(
        endpoint,
        providerModel,
        body,
        res,
        onChunk,
        pii,
      );
      const latencyMs = Date.now() - startedAt;
      console.log(`[Router] ✅ ${providerKey} → "${resolvedModel}"`);
      return {
        success: true,
        collected,
        provider: providerKey,
        resolvedModel: providerModel,
        usage: extractProviderUsage(collected),
        latencyMs,
      };
    } catch (err: any) {
      if (err.status !== 401 && err.status !== 403)
        recordFailure(providerKey, err.message);
      console.warn(
        `[Router] ⚠️  ${providerKey} failed: ${err.message} — trying next…`,
      );
    }
  }

  // DeepSeek keeps V4 Pro "until further notice". If it is unavailable, run
  // the turn on V4.1 Flash at maximum thinking instead of failing it.
  if (
    allowProFallback &&
    /deepseek-v4-pro/i.test(resolvedModel) &&
    !res.headersSent
  ) {
    console.warn(
      "[Router] V4 Pro unavailable — retrying on V4.1 Flash (max effort)",
    );
    return dispatchToProvider(
      {
        ...body,
        model: PRO_FALLBACK_MODEL,
        thinking: { type: "enabled" },
        reasoning_effort: "max",
      },
      res,
      onChunk,
      false,
      pii,
    );
  }

  return sendServiceUnavailable(body, resolvedModel, res);
}

const PRO_FALLBACK_MODEL = "deepseek/deepseek-flash";

/** Models that cannot read image input. DeepSeek V4.1 Flash can; V4 Pro cannot. */
export function isTextOnlyModel(model: string): boolean {
  return /deepseek-v4-pro|deepseek-coder|qwen-2\.5-coder|llama-3/i.test(model);
}

/** True when any message carries an image part (OpenAI-style content array). */
export function hasImageInput(messages: any[] | undefined): boolean {
  return (messages || []).some(
    (m: any) =>
      Array.isArray(m?.content) &&
      m.content.some(
        (p: any) => p?.type === "image_url" || p?.type === "image",
      ),
  );
}

async function sendServiceUnavailable(
  body: any,
  resolvedModel: string,
  res: Response,
): Promise<{ success: boolean; collected: any[] }> {
  const isStream = body.stream !== false;
  const msg = `⚡ **VynorAI**: Service temporarily unavailable for \`${resolvedModel}\`. Auto-recovering — please retry in 30s.`;
  const chunk = {
    id: `chatcmpl-${uuidv4()}`,
    object: isStream ? "chat.completion.chunk" : "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    choices: [
      {
        index: 0,
        [isStream ? "delta" : "message"]: { role: "assistant", content: msg },
        finish_reason: "stop",
      },
    ],
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
