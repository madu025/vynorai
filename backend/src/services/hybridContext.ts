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

import crypto from "crypto";
import { config } from "../config.js";
import { getContextLimitForPlan } from "./modelRegistry.js";
import { summarizeConversation } from "./localSlmRouter.js";

const CHARS_PER_TOKEN = 4;
const SYSTEM_RESERVE = 4000; // always reserve for system prompt
const WINDOW_TURNS = 12;
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

interface Msg {
  role: string;
  content: string | any[];
  [k: string]: any;
}
export type OptimizationMode = "safe" | "aggressive";
interface HybridResult {
  messages: Msg[];
  savedTokens: number;
  strategy: string[];
  contextLimit: number;
  optimizationMode: OptimizationMode;
}

function charCount(msg: Msg): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content))
    return (msg.content as any[]).reduce(
      (s: number, p: any) => s + (p.text?.length ?? 0),
      0,
    );
  return 0;
}

function getText(msg: Msg): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content))
    return (msg.content as any[]).map((p: any) => p.text ?? "").join("");
  return "";
}

function setText(msg: Msg, text: string): Msg {
  if (typeof msg.content === "string") return { ...msg, content: text };
  const parts = Array.isArray(msg.content) ? [...(msg.content as any[])] : [];
  let replaced = false;
  const np = parts.map((p: any) => {
    if (p.type === "text" && !replaced) {
      replaced = true;
      return { ...p, text };
    }
    return p;
  });
  return { ...msg, content: replaced ? np : text };
}

function toTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function compressBlock(code: string): string {
  return code
    .split("\n")
    .map((l: string) => l.trimEnd())
    .filter(
      (l: string, i: number, arr: string[]) =>
        !(l === "" && (arr[i - 1] ?? "") === ""),
    )
    .join("\n");
}

interface Block {
  filename: string;
  content: string;
  start: number;
  end: number;
}

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
    blocks.push({
      filename,
      content: body,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return blocks;
}

function simpleDiff(prev: string, curr: string): string | null {
  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  const removed = prevLines.filter((l: string) => !currLines.includes(l));
  const added = currLines.filter((l: string) => !prevLines.includes(l));
  if (removed.length === 0 && added.length === 0) return null;
  return [
    ...removed.map((l: string) => `- ${l}`),
    ...added.map((l: string) => `+ ${l}`),
  ].join("\n");
}

function applyCodeCompression(
  messages: Msg[],
  seenFiles: Map<string, string>,
): { messages: Msg[]; saved: number } {
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
          newText =
            newText.slice(0, blk.start) +
            "```\n" +
            stub +
            "\n```" +
            newText.slice(blk.end);
          saved += orig - stub.length;
        } else {
          const diff = simpleDiff(prev, blk.content);
          if (diff && diff.length < blk.content.length * 0.7) {
            newText =
              newText.slice(0, blk.start) +
              "```diff\n" +
              diff +
              "\n```" +
              newText.slice(blk.end);
            saved += orig - diff.length;
          } else {
            const c = compressBlock(blk.content);
            newText =
              newText.slice(0, blk.start) +
              "```\n" +
              c +
              "\n```" +
              newText.slice(blk.end);
            saved += orig - c.length;
          }
          seenFiles.set(blk.filename, blk.content);
        }
      } else {
        if (orig > MIN_COMPRESS_CHARS) {
          const c = compressBlock(blk.content);
          newText =
            newText.slice(0, blk.start) +
            "```\n" +
            c +
            "\n```" +
            newText.slice(blk.end);
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
function applyMessageCap(
  messages: Msg[],
  maxMsgTokens: number,
): { messages: Msg[]; saved: number } {
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
    const truncated =
      text.slice(0, keep60) +
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
    // Always keep system messages and tool exchanges (each call needs its result).
    if (
      msg.role === "system" ||
      msg.role === "tool" ||
      Array.isArray(msg.tool_calls)
    ) {
      out.push(msg);
      continue;
    }
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
function applyInjectionFilter(messages: Msg[]): {
  messages: Msg[];
  cleaned: number;
} {
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

// ─── Layer 0d: Deterministic tool-output trimming ────────────────────────────
// Terminal/search output is mostly noise. Trimming is a pure function of the
// content, so the same tool result always trims identically and the cached
// prompt prefix survives. File reads are never trimmed: edits need exact text.
const TRIMMABLE_TOOLS = new Set([
  "run_terminal_command",
  "run_command",
  "grep_search",
  "file_glob_search",
  "ls",
  "list_directory",
  "fetch_url_content",
  "search_web",
]);
const TOOL_OUTPUT_CAP = 6000;
const ERROR_LINE =
  /\b(error|fail(ed|ure)?|exception|traceback|panic|cannot|undefined|not found|warn(ing)?)\b|✗|✖/i;

export function trimToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP) return text;
  const head = text.slice(0, 1500);
  const tail = text.slice(-3000);
  const middle = text
    .slice(1500, -3000)
    .split("\n")
    .filter((l) => ERROR_LINE.test(l))
    .slice(0, 60);
  const omitted = text.length - head.length - tail.length;
  return [
    head,
    `\n[... ${omitted} chars of output trimmed by VynorAI${middle.length ? "; error/warning lines kept below" : ""} ...]\n`,
    ...middle,
    middle.length ? "\n[...]\n" : "",
    tail,
  ].join("\n");
}

function toolNamesById(messages: Msg[]): Map<string, string> {
  const toolNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      if (call?.id) toolNames.set(call.id, call.function?.name ?? "");
    }
  }
  return toolNames;
}

function applyToolOutputTrim(messages: Msg[]): {
  messages: Msg[];
  saved: number;
} {
  const toolNames = toolNamesById(messages);
  let saved = 0;
  const out = messages.map((msg: Msg) => {
    if (msg.role !== "tool") return msg;
    const name = toolNames.get(msg.tool_call_id ?? msg.toolCallId ?? "") ?? "";
    if (!TRIMMABLE_TOOLS.has(name)) return msg;
    const text = getText(msg);
    const trimmed = trimToolOutput(text);
    if (trimmed === text) return msg;
    saved += text.length - trimmed.length;
    return setText(msg, trimmed);
  });
  return { messages: out, saved };
}

// ─── Layer 1c: Repeated-read dedupe ──────────────────────────────────────────
// Agents re-read the same unchanged file many times in one task. When a read
// returns byte-identical output to an earlier result that is still in the
// window, the LATER copy becomes a short pointer. The earlier copy is never
// modified, so the cached prefix survives. Runs after windowing, so the
// referenced original is guaranteed to still be in context.
const DEDUPE_TOOLS = new Set([
  "read_file",
  "read_file_range",
  "read_currently_open_file",
  "view_repo_map",
  "view_subdirectory",
  "ls",
  "list_directory",
  "view_diff",
]);
const DEDUPE_MIN_CHARS = 400;

export function applyReadDedupe(messages: Msg[]): {
  messages: Msg[];
  saved: number;
} {
  const toolNames = toolNamesById(messages);
  const seen = new Set<string>();
  let saved = 0;
  const out = messages.map((msg: Msg) => {
    if (msg.role !== "tool") return msg;
    const name = toolNames.get(msg.tool_call_id ?? msg.toolCallId ?? "") ?? "";
    if (!DEDUPE_TOOLS.has(name)) return msg;
    const text = getText(msg);
    if (text.length < DEDUPE_MIN_CHARS) return msg;
    const key = crypto.createHash("sha256").update(text).digest("hex");
    if (!seen.has(key)) {
      seen.add(key);
      return msg;
    }
    const stub =
      `[Unchanged: identical to an earlier ${name} result in this conversation ` +
      `(${text.split("\n").length} lines). Use that earlier output.]`;
    saved += text.length - stub.length;
    return setText(msg, stub);
  });
  return { messages: out, saved };
}

// ─── Layer 1: Sticky, turn-aligned window ────────────────────────────────────
// The window start only moves in WINDOW_STEP jumps, so for WINDOW_STEP turns in
// a row the prompt prefix is byte-identical and stays provider-cache-hot.
const WINDOW_MESSAGES = WINDOW_TURNS * 2;
const WINDOW_STEP = 12;

/** Never start mid tool-exchange: a tool result without its call is rejected upstream. */
function alignWindowStart(
  convo: Msg[],
  desired: number,
): { head: Msg[]; start: number } {
  for (let i = desired; i < convo.length; i++) {
    if (convo[i].role === "user") return { head: [], start: i };
  }
  // Inside one long tool loop: keep the user's request, resume at an assistant turn.
  const lastUser = convo.map((m) => m.role).lastIndexOf("user");
  if (lastUser < 0) return { head: [], start: desired };
  for (let i = Math.max(desired, lastUser + 1); i < convo.length; i++) {
    if (convo[i].role === "assistant")
      return { head: [convo[lastUser]], start: i };
  }
  return { head: [], start: lastUser };
}

function applyWindowTruncation(
  messages: Msg[],
  budgetTokens: number,
): { messages: Msg[]; saved: number; dropped: Msg[] } {
  const system = messages.filter((m: Msg) => m.role === "system");
  const convo = messages.filter((m: Msg) => m.role !== "system");
  const budgetChars = budgetTokens * CHARS_PER_TOKEN;
  const total = (list: Msg[]) =>
    list.reduce((s: number, m: Msg) => s + charCount(m), 0);

  let desired =
    convo.length > WINDOW_MESSAGES
      ? Math.floor((convo.length - WINDOW_MESSAGES) / WINDOW_STEP) * WINDOW_STEP
      : 0;
  let { head, start } = alignWindowStart(convo, desired);
  while (
    total([...system, ...head, ...convo.slice(start)]) > budgetChars &&
    desired < convo.length - 1
  ) {
    desired += WINDOW_STEP;
    ({ head, start } = alignWindowStart(
      convo,
      Math.min(desired, convo.length - 1),
    ));
  }

  const kept = [...head, ...convo.slice(start)];
  const keptSet = new Set(kept);
  const dropped = convo.filter((m) => !keptSet.has(m));
  return { messages: [...system, ...kept], saved: total(dropped), dropped };
}

// ─── Layer 1b: Background compaction of dropped turns ────────────────────────
// Dropped turns are summarized by the VPS model off the request path. Until a
// summary exists the turns are simply dropped (previous behaviour). Because the
// window is sticky, the dropped block — and so its summary — is stable too.
const SUMMARY_MAX = 500;
const summaries = new Map<string, string>();
const pendingSummaries = new Set<string>();
const summaryQueue: Array<{ key: string; transcript: string }> = [];
let summaryWorkerRunning = false;

function droppedKey(scope: string, dropped: Msg[]): string {
  const payload = dropped.map((m) => `${m.role}:${getText(m)}`).join("\u0000");
  return crypto
    .createHash("sha256")
    .update(`${scope}\u0000${payload}`)
    .digest("hex");
}

function transcriptOf(dropped: Msg[]): string {
  return dropped
    .map(
      (m) =>
        `${m.role.toUpperCase()}: ${m.role === "tool" ? getText(m).slice(0, 400) : getText(m)}`,
    )
    .join("\n\n");
}

async function drainSummaryQueue(): Promise<void> {
  if (summaryWorkerRunning) return;
  summaryWorkerRunning = true;
  try {
    // One at a time: the VPS model has two slots and routing needs the other.
    while (summaryQueue.length) {
      const job = summaryQueue.shift()!;
      const summary = await summarizeConversation(job.transcript);
      if (summary) {
        if (summaries.size >= SUMMARY_MAX) {
          const oldest = summaries.keys().next().value;
          if (oldest) summaries.delete(oldest);
        }
        summaries.set(job.key, summary);
      }
      pendingSummaries.delete(job.key);
    }
  } finally {
    summaryWorkerRunning = false;
  }
}

function scheduleSummary(key: string, dropped: Msg[]): void {
  if (
    summaries.has(key) ||
    pendingSummaries.has(key) ||
    summaryQueue.length >= 50
  )
    return;
  pendingSummaries.add(key);
  summaryQueue.push({ key, transcript: transcriptOf(dropped) });
  void drainSummaryQueue();
}

function applyCompaction(
  messages: Msg[],
  dropped: Msg[],
  scope?: string,
): { messages: Msg[]; used: boolean } {
  if (!scope || dropped.length === 0 || !config.localSlm.compactionEnabled)
    return { messages, used: false };
  const key = droppedKey(scope, dropped);
  const summary = summaries.get(key);
  if (!summary) {
    scheduleSummary(key, dropped);
    return { messages, used: false };
  }
  const idx = messages.findIndex((m) => m.role === "user");
  if (idx < 0) return { messages, used: false };
  const block = `<earlier-conversation-summary>\n${summary}\n</earlier-conversation-summary>\n\n`;
  const out = [...messages];
  const first = out[idx];
  out[idx] = Array.isArray(first.content)
    ? { ...first, content: [{ type: "text", text: block }, ...first.content] }
    : { ...first, content: block + (first.content ?? "") };
  return { messages: out, used: true };
}

export interface HybridOptions {
  /** Per-user scope for background summaries; omit to disable compaction. */
  scope?: string;
}

export function applyHybridContext(
  body: any,
  planId = "free",
  mode: OptimizationMode = body.optimization_mode === "aggressive"
    ? "aggressive"
    : "safe",
  options: HybridOptions = {},
): { body: any; result: HybridResult } {
  const messages: Msg[] = (body.messages ?? []).map((m: any) => ({ ...m }));
  if (messages.length === 0)
    return {
      body,
      result: {
        messages,
        savedTokens: 0,
        strategy: [],
        contextLimit: 0,
        optimizationMode: mode,
      },
    };

  const strategy: string[] = [];
  let totalSaved = 0;

  const ctxLimit = getContextLimitForPlan(planId); // 32k / 128k / 256k
  const budgetTokens = ctxLimit - SYSTEM_RESERVE;
  const msgCapTokens = getMsgCapTokens(ctxLimit);

  // Safe mode never rewrites user instructions or code. It only trims noisy
  // terminal/search output and drops (or summarizes) turns beyond the window.
  if (mode === "safe") {
    const { messages: trimmed, saved: sTool } = applyToolOutputTrim(messages);
    if (sTool > 0) strategy.push(`tool-trim(~${toTokens(sTool)}tok)`);
    const {
      messages: windowed,
      saved,
      dropped,
    } = applyWindowTruncation(trimmed, budgetTokens);
    if (saved > 0) strategy.push(`window(~${toTokens(saved)}tok)`);
    const { messages: deduped, saved: sDedupe } = applyReadDedupe(windowed);
    if (sDedupe > 0) strategy.push(`read-dedupe(~${toTokens(sDedupe)}tok)`);
    const { messages: compacted, used } = applyCompaction(
      deduped,
      dropped,
      options.scope,
    );
    if (used) strategy.push("summary");
    return {
      body: { ...body, messages: compacted },
      result: {
        messages: compacted,
        savedTokens: toTokens(saved + sTool + sDedupe),
        strategy,
        contextLimit: ctxLimit,
        optimizationMode: mode,
      },
    };
  }

  // Layer 0a — single-message cap (plan-scaled)
  const { messages: capped, saved: s0a } = applyMessageCap(
    messages,
    msgCapTokens,
  );
  if (s0a > 0) strategy.push(`cap(~${toTokens(s0a)}tok)`);
  totalSaved += s0a;

  // Layer 0b — duplicate dedupe
  const { messages: deduped, saved: s0b } = applyDedupe(capped);
  if (s0b > 0) strategy.push(`dedupe(~${toTokens(s0b)}tok)`);
  totalSaved += s0b;

  // Layer 0c — injection filter
  const { messages: filtered, cleaned } = applyInjectionFilter(deduped);
  if (cleaned > 0) strategy.push(`injection(${cleaned}hits)`);

  // Layer 0d — terminal/search output trim
  const { messages: toolTrimmed, saved: s0d } = applyToolOutputTrim(filtered);
  if (s0d > 0) strategy.push(`tool-trim(~${toTokens(s0d)}tok)`);
  totalSaved += s0d;

  // Layer 1 — sticky window (uses plan budget) + background summary
  const {
    messages: windowedRaw,
    saved: s1,
    dropped,
  } = applyWindowTruncation(toolTrimmed, budgetTokens);
  if (s1 > 0) strategy.push(`window(~${toTokens(s1)}tok)`);
  totalSaved += s1;
  const { messages: dedupedRead, saved: s1c } = applyReadDedupe(windowedRaw);
  if (s1c > 0) strategy.push(`read-dedupe(~${toTokens(s1c)}tok)`);
  totalSaved += s1c;
  const { messages: windowed, used } = applyCompaction(
    dedupedRead,
    dropped,
    options.scope,
  );
  if (used) strategy.push("summary");

  // Layer 2 — code block compression
  const { messages: compressed, saved: s2 } = applyCodeCompression(
    windowed,
    new Map<string, string>(),
  );
  if (s2 > 0) strategy.push(`compress(~${toTokens(s2)}tok)`);
  totalSaved += s2;

  if (totalSaved > 0 || cleaned > 0) {
    console.log(
      `[HybridCtx] Saved ~${toTokens(totalSaved)} tokens | ` +
        `turns: ${messages.length}->${compressed.length} | ` +
        strategy.join(", "),
    );
  }

  return {
    body: { ...body, messages: compressed },
    result: {
      messages: compressed,
      savedTokens: toTokens(totalSaved),
      strategy,
      contextLimit: ctxLimit,
      optimizationMode: mode,
    },
  };
}
