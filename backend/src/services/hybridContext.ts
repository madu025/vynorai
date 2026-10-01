/**
 * VynorAI Hybrid Context Architecture
 * Minimises token consumption BEFORE the request reaches the AI provider.
 *
 * Layer 0a - Single-message hard cap    (plan-based: 8k–64k tokens/message)
 * Layer 0b - Duplicate message dedupe   (exact same content → keep once)
 * Layer 0c - Prompt-injection filter    (strip jailbreak patterns)
 * Layer 1  - Sliding window truncation  (keep last 12 turns, plan context budget)
 * Layer 2  - Code-block compression     (dedupe identical files, simple diffs)
 */

import { getContextLimitForPlan } from "./modelRegistry.js";

const CHARS_PER_TOKEN    = 4;
const SYSTEM_RESERVE     = 4000;    // always reserve for system prompt
const WINDOW_TURNS       = 12;
const MIN_COMPRESS_CHARS = 800;

// Per-message cap scales with plan context (25% of total budget per message)
function getMsgCapTokens(planContextTokens: number): number {
  return Math.floor(planContextTokens * 0.25);
}

// Patterns that signal prompt-injection attempts
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?(previous|prior|above|earlier) instructions?/gi,
  /disregard (all )?(previous|prior|above|earlier)/gi,
  /you are now (a |an )?(different|new|another|jailbreak)/gi,
  /pretend (you are|to be) (not |no longer )?an? (AI|assistant|language model)/gi,
  /do anything now/gi,
  /DAN mode/gi,
  /bypass (your )?(safety|restrictions|guidelines|filters)/gi,
  /forget (you are|your) (an? )?(AI|assistant|guidelines)/gi,
];

interface Msg { role: string; content: string | any[]; [k: string]: any; }
export type OptimizationMode = "safe" | "aggressive";
interface HybridResult { messages: Msg[]; savedTokens: number; strategy: string[]; contextLimit: number; optimizationMode: OptimizationMode; }

function charCount(msg: Msg): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content))
    return (msg.content as any[]).reduce((s: number, p: any) => s + (p.text?.length ?? 0), 0);
  return 0;
}

function getText(msg: Msg): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) return (msg.content as any[]).map((p: any) => p.text ?? "").join("");
  return "";
}

function setText(msg: Msg, text: string): Msg {
  if (typeof msg.content === "string") return { ...msg, content: text };
  const parts = Array.isArray(msg.content) ? [...(msg.content as any[])] : [];
  let replaced = false;
  const np = parts.map((p: any) => {
    if (p.type === "text" && !replaced) { replaced = true; return { ...p, text }; }
    return p;
  });
  return { ...msg, content: replaced ? np : text };
}

function toTokens(chars: number): number { return Math.ceil(chars / CHARS_PER_TOKEN); }

function compressBlock(code: string): string {
  return code
    .split("\n")
    .map((l: string) => l.trimEnd())
    .filter((l: string, i: number, arr: string[]) => !(l === "" && (arr[i - 1] ?? "") === ""))
    .join("\n");
}

interface Block { filename: string; content: string; start: number; end: number; }

function extractCodeBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /```[\w]*[ \t]*([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let filename = m[1].trim();
    const body = m[2];
    if (!filename) {
      const first = body.split("\n")[0].trim();
      const fn = first.match(/\/\/\s*(.+\.\w{1,6})/);
      if (fn) filename = fn[1].trim();
    }
    if (!filename) filename = `block_${blocks.length}`;
    blocks.push({ filename, content: body, start: m.index, end: m.index + m[0].length });
  }
  return blocks;
}

function simpleDiff(prev: string, curr: string): string | null {
  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  const removed = prevLines.filter((l: string) => !currLines.includes(l));
  const added   = currLines.filter((l: string) => !prevLines.includes(l));
  if (removed.length === 0 && added.length === 0) return null;
  return [...removed.map((l: string) => `- ${l}`), ...added.map((l: string) => `+ ${l}`)].join("\n");
}

function applyCodeCompression(messages: Msg[], seenFiles: Map<string, string>): { messages: Msg[]; saved: number } {
  let saved = 0;
  const out = messages.map((msg: Msg) => {
    const text = getText(msg);
    if (!text.includes("```")) return msg;
    const blocks = extractCodeBlocks(text);
    if (blocks.length === 0) return msg;

    let newText = text;
    for (const blk of [...blocks].reverse()) {
      const orig = blk.content.length;
      if (seenFiles.has(blk.filename)) {
        const prev = seenFiles.get(blk.filename)!;
        if (prev === blk.content) {
          const stub = `// [${blk.filename} - unchanged, ${blk.content.split("\n").length} lines]`;
          newText = newText.slice(0, blk.start) + "```\n" + stub + "\n```" + newText.slice(blk.end);
          saved += orig - stub.length;
        } else {
          const diff = simpleDiff(prev, blk.content);
          if (diff && diff.length < blk.content.length * 0.7) {
            newText = newText.slice(0, blk.start) + "```diff\n" + diff + "\n```" + newText.slice(blk.end);
            saved += orig - diff.length;
          } else {
            const c = compressBlock(blk.content);
            newText = newText.slice(0, blk.start) + "```\n" + c + "\n```" + newText.slice(blk.end);
            saved += orig - c.length;
          }
          seenFiles.set(blk.filename, blk.content);
        }
      } else {
        if (orig > MIN_COMPRESS_CHARS) {
          const c = compressBlock(blk.content);
          newText = newText.slice(0, blk.start) + "```\n" + c + "\n```" + newText.slice(blk.end);
          saved += orig - c.length;
        }
        seenFiles.set(blk.filename, blk.content);
      }
    }
    return setText(msg, newText);
  });
  return { messages: out, saved };
}

// ─── Layer 0a: Single-message hard cap ──────────────────────────────────────
function applyMessageCap(messages: Msg[], maxMsgTokens: number): { messages: Msg[]; saved: number } {
  const maxChars = maxMsgTokens * CHARS_PER_TOKEN;
  let saved = 0;
  const out = messages.map((msg: Msg) => {
    // Never truncate system messages
    if (msg.role === "system") return msg;
    const text = getText(msg);
    if (text.length <= maxChars) return msg;
    // Keep first 60% + last 40% so context + recent code both survive
    const keep60 = Math.floor(maxChars * 0.6);
    const keep40 = maxChars - keep60;
    const truncated = text.slice(0, keep60) +
      `\n\n// [...${toTokens(text.length - maxChars)} tokens trimmed...]\n\n` +
      text.slice(text.length - keep40);
    saved += text.length - truncated.length;
    return setText(msg, truncated);
  });
  return { messages: out, saved };
}

// ─── Layer 0b: Duplicate message dedupe ──────────────────────────────────────
function applyDedupe(messages: Msg[]): { messages: Msg[]; saved: number } {
  let saved = 0;
  const seen = new Set<string>();
  const out: Msg[] = [];
  for (const msg of messages) {
    // Always keep system messages
    if (msg.role === "system") { out.push(msg); continue; }
    const key = `${msg.role}::${getText(msg).trim()}`;
    if (seen.has(key)) {
      saved += charCount(msg);
      continue; // drop exact duplicate
    }
    seen.add(key);
    out.push(msg);
  }
  return { messages: out, saved };
}

// ─── Layer 0c: Prompt-injection filter ───────────────────────────────────────
function applyInjectionFilter(messages: Msg[]): { messages: Msg[]; cleaned: number } {
  let cleaned = 0;
  const out = messages.map((msg: Msg) => {
    // Only scan user messages
    if (msg.role !== "user") return msg;
    const text = getText(msg);
    let newText = text;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(newText)) {
        newText = newText.replace(pattern, "[filtered]");
        cleaned++;
      }
    }
    return newText !== text ? setText(msg, newText) : msg;
  });
  return { messages: out, cleaned };
}

// ─── Layer 1: Sliding window truncation ──────────────────────────────────────
function applyWindowTruncation(messages: Msg[], budgetTokens: number): { messages: Msg[]; saved: number } {
  const system   = messages.filter((m: Msg) => m.role === "system");
  const convo    = messages.filter((m: Msg) => m.role !== "system");
  const windowed = convo.length > WINDOW_TURNS * 2 ? convo.slice(-(WINDOW_TURNS * 2)) : convo;
  const savedChars = convo
    .slice(0, convo.length - windowed.length)
    .reduce((s: number, m: Msg) => s + charCount(m), 0);

  const budgetChars = budgetTokens * CHARS_PER_TOKEN;
  let total = [...system, ...windowed].reduce((s: number, m: Msg) => s + charCount(m), 0);
  let trimIdx = 0;
  while (total > budgetChars && trimIdx < windowed.length - 1) {
    total -= charCount(windowed[trimIdx]);
    trimIdx++;
  }
  const budgetTrimmedChars = windowed
    .slice(0, trimIdx)
    .reduce((s: number, m: Msg) => s + charCount(m), 0);
  return { messages: [...system, ...windowed.slice(trimIdx)], saved: savedChars + budgetTrimmedChars };
}

export function applyHybridContext(
  body: any,
  planId = "free",
  mode: OptimizationMode = body.optimization_mode === "aggressive" ? "aggressive" : "safe",
): { body: any; result: HybridResult } {
  const messages: Msg[] = (body.messages ?? []).map((m: any) => ({ ...m }));
  if (messages.length === 0) return { body, result: { messages, savedTokens: 0, strategy: [], contextLimit: 0, optimizationMode: mode } };

  const strategy: string[] = [];
  let totalSaved = 0;

  const ctxLimit    = getContextLimitForPlan(planId);   // 32k / 128k / 256k
  const budgetTokens = ctxLimit - SYSTEM_RESERVE;
  const msgCapTokens = getMsgCapTokens(ctxLimit);

  // Safe mode preserves every message verbatim unless the provider context
  // budget would be exceeded. It never rewrites user instructions or code.
  if (mode === "safe") {
    const { messages: windowed, saved } = applyWindowTruncation(messages, budgetTokens);
    if (saved > 0) strategy.push(`overflow-window(~${toTokens(saved)}tok)`);
    return {
      body: { ...body, messages: windowed },
      result: {
        messages: windowed,
        savedTokens: toTokens(saved),
        strategy,
        contextLimit: ctxLimit,
        optimizationMode: mode,
      },
    };
  }

  // Layer 0a — single-message cap (plan-scaled)
  const { messages: capped, saved: s0a } = applyMessageCap(messages, msgCapTokens);
  if (s0a > 0) strategy.push(`cap(~${toTokens(s0a)}tok)`);
  totalSaved += s0a;

  // Layer 0b — duplicate dedupe
  const { messages: deduped, saved: s0b } = applyDedupe(capped);
  if (s0b > 0) strategy.push(`dedupe(~${toTokens(s0b)}tok)`);
  totalSaved += s0b;

  // Layer 0c — injection filter
  const { messages: filtered, cleaned } = applyInjectionFilter(deduped);
  if (cleaned > 0) strategy.push(`injection(${cleaned}hits)`);

  // Layer 1 — sliding window (uses plan budget)
  const { messages: windowed, saved: s1 } = applyWindowTruncation(filtered, budgetTokens);
  if (s1 > 0) strategy.push(`window(~${toTokens(s1)}tok)`);
  totalSaved += s1;

  // Layer 2 — code block compression
  const { messages: compressed, saved: s2 } = applyCodeCompression(windowed, new Map<string, string>());
  if (s2 > 0) strategy.push(`compress(~${toTokens(s2)}tok)`);
  totalSaved += s2;

  if (totalSaved > 0 || cleaned > 0) {
    console.log(
      `[HybridCtx] Saved ~${toTokens(totalSaved)} tokens | ` +
      `turns: ${messages.length}->${compressed.length} | ` +
      strategy.join(", ")
    );
  }

  return {
    body: { ...body, messages: compressed },
    result: { messages: compressed, savedTokens: toTokens(totalSaved), strategy, contextLimit: ctxLimit, optimizationMode: mode },
  };
}
