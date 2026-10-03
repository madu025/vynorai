/**
 * Where VynorAI's own background LLM jobs run (not customer chat turns).
 *
 * Today every role runs on DeepSeek V4.1 Flash with thinking off: cheap,
 * fast and far better than a CPU model. When a GPU server is added, point
 * LOCAL_LLM_URL at any OpenAI-compatible server (vLLM, llama.cpp, Ollama's
 * /v1) and list the roles to move there:
 *
 *   LOCAL_LLM_URL=http://10.0.0.5:8000/v1
 *   LOCAL_LLM_MODEL=qwen2.5-coder-14b-instruct
 *   LOCAL_LLM_ROLES=compaction
 *
 * A role on the local server falls back to DeepSeek when that server fails,
 * so a GPU outage never breaks the product.
 */
import { config } from "../config.js";

export type BackgroundRole = "compaction";

interface Target {
  name: "local" | "deepseek";
  url: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  extra: Record<string, unknown>;
}

function localTarget(role: BackgroundRole): Target | null {
  const url = process.env.LOCAL_LLM_URL;
  const roles = (process.env.LOCAL_LLM_ROLES || "")
    .split(",")
    .map((r) => r.trim());
  if (!url || !roles.includes(role)) return null;
  return {
    name: "local",
    url: url.replace(/\/+$/, ""),
    model: process.env.LOCAL_LLM_MODEL || "local",
    apiKey: process.env.LOCAL_LLM_API_KEY,
    timeoutMs: parseInt(process.env.LOCAL_LLM_TIMEOUT_MS || "60000", 10),
    extra: {},
  };
}

function deepseekTarget(): Target | null {
  const apiKey = config.aiKeys.deepseek;
  if (!apiKey) return null;
  return {
    name: "deepseek",
    url: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiKey,
    timeoutMs: 30_000,
    // Background jobs never need reasoning tokens.
    extra: { thinking: { type: "disabled" } },
  };
}

async function callTarget(
  target: Target,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  try {
    const res = await fetch(`${target.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: target.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...target.extra,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run a background job on the local GPU server if it owns the role, else DeepSeek. */
export async function runBackgroundLlm(
  role: BackgroundRole,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<{ text: string; target: Target["name"] } | null> {
  for (const target of [localTarget(role), deepseekTarget()]) {
    if (!target) continue;
    const text = await callTarget(target, messages, maxTokens);
    if (text) return { text, target: target.name };
  }
  return null;
}
