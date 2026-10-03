/**
 * VynorAI Semantic Cache
 * ----------------------
 * Answers repeated *generic* questions ("how do I debounce in React?") from a
 * near-duplicate earlier answer, using a small embedding model on the VPS
 * (~150MB RAM, a few ms per query on CPU).
 *
 * Deliberately narrow: only first-turn questions with no code, no attached
 * project context and no tool history are eligible. Anything touching the
 * user's code must reach a real model, because a "similar" question about
 * different code needs a different answer.
 */
import { config } from "../config.js";

interface Entry {
  scope: string;
  vector: Float32Array;
  chunks: any[];
  at: number;
}

const MAX_ENTRIES = 3000;
const TTL_MS = 7 * 24 * 60 * 60_000;
const entries: Entry[] = [];

function textOf(msg: any): string {
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content))
    return msg.content.map((p: any) => p?.text ?? "").join("\n");
  return "";
}

/** Returns the normalized question if this request may use the semantic cache. */
export function semanticCacheQuestion(
  messages: any[],
  tools?: unknown,
): string | null {
  // With tools the model is expected to act on the workspace (agent turns,
  // subagents); a near-duplicate's text answer would skip the work entirely.
  if (Array.isArray(tools) && tools.length > 0) return null;
  const convo = (messages ?? []).filter((m: any) => m.role !== "system");
  if (convo.length !== 1 || convo[0].role !== "user") return null;
  const text = textOf(convo[0]).replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 500) return null;
  // Code, attached files, or context tags mean the answer depends on the user's project.
  if (
    /```|<\/?(file|context|vynor-context|code)\b|@(codebase|file|folder)\b/i.test(
      text,
    )
  )
    return null;
  return text.toLowerCase();
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i++) dot += a[i] * b[i];
  return dot; // vectors are unit-normalized on insert/lookup
}

function normalize(values: number[]): Float32Array {
  const v = Float32Array.from(values);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

async function embed(text: string): Promise<Float32Array | null> {
  const { embedUrl, embedModel, timeoutMs } = config.semanticCache;
  try {
    const res = await fetch(`${embedUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, input: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const vector = data?.data?.[0]?.embedding;
    return Array.isArray(vector) && vector.length ? normalize(vector) : null;
  } catch {
    return null;
  }
}

export function semanticScope(userId: string, model: string): string {
  return config.semanticCache.scope === "global"
    ? `global:${model}`
    : `user:${userId}:${model}`;
}

/** Look up a near-duplicate answer. The vector is returned so a miss can be saved without re-embedding. */
export async function semanticLookup(
  scope: string,
  question: string,
): Promise<{
  chunks: any[] | null;
  vector: Float32Array | null;
  similarity: number;
}> {
  if (!config.semanticCache.enabled)
    return { chunks: null, vector: null, similarity: 0 };
  const vector = await embed(question);
  if (!vector) return { chunks: null, vector: null, similarity: 0 };

  const now = Date.now();
  let best: Entry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (entry.scope !== scope || now - entry.at > TTL_MS) continue;
    const score = cosine(vector, entry.vector);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (best && bestScore >= config.semanticCache.threshold) {
    return { chunks: best.chunks, vector, similarity: bestScore };
  }
  return { chunks: null, vector, similarity: bestScore };
}

/** Store a plain-text answer. Responses that call tools are never cached. */
export function semanticSave(
  scope: string,
  vector: Float32Array | null,
  chunks: any[],
): void {
  if (!config.semanticCache.enabled || !vector || chunks.length === 0) return;
  const callsTools = chunks.some(
    (c) =>
      c?.choices?.[0]?.delta?.tool_calls ||
      c?.choices?.[0]?.message?.tool_calls,
  );
  if (callsTools) return;
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push({ scope, vector, chunks, at: Date.now() });
}
