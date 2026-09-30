/**
 * VynorAI Provider Health Monitor
 * 
 * Runs lightweight probes every 60s against each configured provider.
 * Updates circuit breakers BEFORE user requests arrive.
 * Users never hit a cold-failing provider.
 */

import { config, ProviderID } from "../config.js";
import { recordSuccess, recordFailure, canUseProvider } from "./circuitBreaker.js";

interface ProbeConfig {
  provider: ProviderID;
  url: string;
  headers: Record<string, string>;
  body: object;
}

function buildProbes(): ProbeConfig[] {
  const probes: ProbeConfig[] = [];
  const k = config.aiKeys;

  if (k.deepseek) probes.push({
    provider: "deepseek",
    url: "https://api.deepseek.com/v1/chat/completions",
    headers: { Authorization: `Bearer ${k.deepseek}`, "Content-Type": "application/json" },
    body: { model: "deepseek-chat", max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
  });

  if (k.openai) probes.push({
    provider: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    headers: { Authorization: `Bearer ${k.openai}`, "Content-Type": "application/json" },
    body: { model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
  });

  if (k.anthropic) probes.push({
    provider: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": k.anthropic,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: { model: "claude-3-haiku", max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
  });

  if (k.groq) probes.push({
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: { Authorization: `Bearer ${k.groq}`, "Content-Type": "application/json" },
    body: { model: "llama-3.1-8b", max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
  });

  if (k.gemini) probes.push({
    provider: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: { Authorization: `Bearer ${k.gemini}`, "Content-Type": "application/json" },
    body: { model: "gemini-2.5-flash", max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
  });

  return probes;
}

async function probeProvider(probe: ProbeConfig): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(probe.url, {
      method: "POST",
      headers: probe.headers,
      body: JSON.stringify(probe.body),
      signal: AbortSignal.timeout(8000), // 8s max
    });

    const latency = Date.now() - t0;

    if (res.ok || res.status === 400) {
      // 400 on minimal payload is still "provider is alive"
      recordSuccess(probe.provider, latency);
    } else if (res.status === 401 || res.status === 403) {
      // Auth error – API key invalid (config problem, not provider down)
      console.warn(`[Health ${probe.provider}] Auth error ${res.status} – check your API key`);
    } else if (res.status >= 500) {
      recordFailure(probe.provider, `HTTP ${res.status}`);
    }
  } catch (err: any) {
    recordFailure(probe.provider, err.message || "network error");
  }
}

let monitorHandle: NodeJS.Timeout | null = null;

export function startHealthMonitor(intervalMs = 60_000) {
  if (monitorHandle) return; // already running

  console.log("[VynorAI Health Monitor] Starting – probing providers every", intervalMs / 1000, "s");

  const runProbes = async () => {
    const probes = buildProbes();
    if (probes.length === 0) return;
    await Promise.allSettled(probes.map(probeProvider));
  };

  // First probe immediately on startup
  runProbes();

  monitorHandle = setInterval(runProbes, intervalMs);
}

export function stopHealthMonitor() {
  if (monitorHandle) {
    clearInterval(monitorHandle);
    monitorHandle = null;
  }
}
