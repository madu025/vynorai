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
// Search and listing results ARE the evidence: dropping their middle made
// agents conclude "nothing found". They get a larger cap, and anything cut is
// reported with a line count so the agent can narrow the query.
const SEARCH_TOOLS = new Set([
  "grep_search",
  "file_glob_search",
  "ls",
  "list_directory",
]);
const SEARCH_OUTPUT_CAP = 24000;
const ERROR_LINE =
  /\b(error|fail(ed|ure)?|exception|traceback|panic|cannot|undefined|not found|warn(ing)?)\b|✗|✖/i;

export function trimToolOutput(text: string, cap = TOOL_OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  const headChars = Math.floor(cap / 4);
  const tailChars = Math.floor(cap / 2);
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const middle = text
    .slice(headChars, -tailChars)
    .split("\n")
    .filter((l) => ERROR_LINE.test(l))
    .slice(0, 60);
  const omitted = text.length - head.length - tail.length;
  const omittedLines = text.slice(headChars, -tailChars).split("\n").length;
  return [
    head,
    `\n[... ${omitted} chars / ~${omittedLines} lines of output trimmed by VynorAI${middle.length ? "; error/warning lines kept below" : ""}. This is NOT the full result: narrow the query or read the specific file ...]\n`,
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
    const trimmed = trimToolOutput(
      text,
      SEARCH_TOOLS.has(name) ? SEARCH_OUTPUT_CAP : TOOL_OUTPUT_CAP,
    );
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

// ─── Layer 1: Append-only context with rare, stable compaction ───────────────
// DeepSeek bills a repeated prompt prefix at ~2% of the normal rate, so the
// history is never touched until it nears the budget (COMPACT_TRIGGER). Then
// one large block of the oldest turns is dropped (summarized in the
// background), leaving room for many more turns before the next drop.
//
// Compaction boundaries are computed from the start of the conversation and
// depend only on earlier messages, so they never move as turns are appended:
// between boundaries the prompt grows append-only and stays cache-hot.
const COMPACT_TRIGGER = 0.85; // drop when the conversation exceeds 85% of budget
const COMPACT_CHUNK = 0.5; // each boundary drops about half the budget
const PRESUMMARY_TRIGGER = 0.7; // start summarizing the next block here

/** First index at or after `from` where a window may start (never a tool result). */
function nextStart(convo: Msg[], from: number): number {
  for (let i = from; i < convo.length; i++) {
    if (convo[i].role === "user" || convo[i].role === "assistant") return i;
  }
  return convo.length;
}

/** Window start after every compaction boundary passed at `triggerChars`. */
function boundaryStart(
  convo: Msg[],
  sizes: number[],
  triggerChars: number,
  chunkChars: number,
): number {
  const tailChars = (from: number) =>
    sizes.slice(from).reduce((s, n) => s + n, 0);
  // Walk boundaries from the beginning; each depends only on earlier messages.
  let start = 0;
  while (tailChars(start) > triggerChars) {
    let acc = 0;
    let next = start;
    while (next < convo.length - 1 && acc < chunkChars) acc += sizes[next++];
    next = nextStart(convo, next);
    if (next >= convo.length - 1 || next <= start) break;
    start = next;
  }
  return start;
}

/** Kept and dropped messages for a window starting at `start`. */
function splitAt(convo: Msg[], start: number): { kept: Msg[]; dropped: Msg[] } {
  // A window that resumes mid tool-loop keeps the request that started it.
  let head: Msg[] = [];
  if (start > 0 && convo[start].role !== "user") {
    for (let i = start - 1; i >= 0; i--) {
      if (convo[i].role === "user") {
        head = [convo[i]];
        break;
      }
    }
  }
  const kept = [...head, ...convo.slice(start)];
  const keptSet = new Set(kept);
  return { kept, dropped: convo.filter((m) => !keptSet.has(m)) };
}

function applyWindowTruncation(
  messages: Msg[],
  budgetTokens: number,
): { messages: Msg[]; saved: number; dropped: Msg[]; upcoming: Msg[] } {
  const system = messages.filter((m: Msg) => m.role === "system");
  const convo = messages.filter((m: Msg) => m.role !== "system");
  const sizes = convo.map(charCount);
  const systemChars = system.reduce((s: number, m: Msg) => s + charCount(m), 0);
  const budgetChars = budgetTokens * CHARS_PER_TOKEN - systemChars;
  const chunkChars = Math.max(1, budgetChars * COMPACT_CHUNK);

  const start = boundaryStart(
    convo,
    sizes,
    budgetChars * COMPACT_TRIGGER,
    chunkChars,
  );
  const { kept, dropped } = splitAt(convo, start);

  // What the NEXT compaction will drop, once the context passes PRESUMMARY:
  // summarizing it now means the summary is ready the moment those turns go.
  const ahead = boundaryStart(
    convo,
    sizes,
    budgetChars * PRESUMMARY_TRIGGER,
    chunkChars,
  );
  const upcoming = ahead > start ? splitAt(convo, ahead).dropped : [];

  const saved = dropped.reduce((s: number, m: Msg) => s + charCount(m), 0);
  return { messages: [...system, ...kept], saved, dropped, upcoming };
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
    .map((m) => {
      const body = m.role === "tool" ? getText(m).slice(0, 400) : getText(m);
      // Assistant tool calls have empty text; without this the summary of an
      // agent loop saw nothing of what was actually done.
      const calls = Array.isArray(m.tool_calls)
        ? m.tool_calls
            .map(
              (c: any) =>
                `[tool ${c?.function?.name ?? "?"} ${String(c?.function?.arguments ?? "").slice(0, 200)}]`,
            )
            .join(" ")
        : "";
      return `${m.role.toUpperCase()}: ${[body, calls].filter(Boolean).join(" ")}`;
    })
    .join("\n\n");
}

async function drainSummaryQueue(): Promise<void> {
  if (summaryWorkerRunning) return;
  summaryWorkerRunning = true;
  try {
    // One at a time: background work, never worth parallel upstream calls.
    while (summaryQueue.length) {
      const job = summaryQueue.shift()!;
      const summary = await summarizeConversation(job.transcript);
      if (summary) {
        if (summaries.size >= SUMMARY_MAX) {
          const oldest = summaries.keys().next().value;
          if (oldest) summaries.delete(oldest);
        }
        summaries.set(job.key, summary);
        summaryFailures.delete(job.key);
      } else {
        recordSummaryFailure(job.key);
      }
      pendingSummaries.delete(job.key);
    }
  } finally {
    summaryWorkerRunning = false;
  }
}

// A failed summary used to be retried on every request, burning upstream tokens
// for nothing. Back off exponentially and give up after a few attempts: the
// verbatim requests and action list already carry the task.
const SUMMARY_MAX_FAILURES = 4;
const SUMMARY_BACKOFF_MS = 30_000;
const summaryFailures = new Map<string, { count: number; retryAt: number }>();

function recordSummaryFailure(key: string): void {
  if (summaryFailures.size >= SUMMARY_MAX) {
    const oldest = summaryFailures.keys().next().value;
    if (oldest) summaryFailures.delete(oldest);
  }
  const count = (summaryFailures.get(key)?.count ?? 0) + 1;
  summaryFailures.set(key, {
    count,
    retryAt: Date.now() + SUMMARY_BACKOFF_MS * 2 ** (count - 1),
  });
}

/** Test hook: forget failure state. */
export function resetSummaryFailures(): void {
  summaryFailures.clear();
}

function scheduleSummary(key: string, dropped: Msg[]): void {
  if (
    summaries.has(key) ||
    pendingSummaries.has(key) ||
    summaryQueue.length >= 50
  )
    return;
  const failed = summaryFailures.get(key);
  if (
    failed &&
    (failed.count >= SUMMARY_MAX_FAILURES || Date.now() < failed.retryAt)
  )
    return;
  pendingSummaries.add(key);
  summaryQueue.push({ key, transcript: transcriptOf(dropped) });
  void drainSummaryQueue();
}

/** Queue the summary of turns the next compaction will drop, ahead of time. */
function presummarize(upcoming: Msg[], scope?: string): void {
  if (!scope || upcoming.length === 0 || !config.localSlm.compactionEnabled)
    return;
  scheduleSummary(droppedKey(scope, upcoming), upcoming);
}

// The user's own requests are the goal and constraints of the task. They are
// small, so the dropped ones are kept verbatim (capped) instead of relying on
// a summary that only sees the tail of the dropped block. A pure function of
// the dropped messages, so the block is as stable as the window itself.
const REQUEST_FIRST_CAP = 2000;
const REQUEST_CAP = 1000;
const REQUESTS_TOTAL_CAP = 6000;

export function earlierUserRequests(dropped: Msg[]): string {
  const texts = dropped
    .filter((m) => m.role === "user")
    .map((m) => getText(m).trim())
    .filter(Boolean);
  if (texts.length === 0) return "";
  const clip = (t: string, cap: number) =>
    t.length <= cap ? t : `${t.slice(0, cap)} [...]`;
  // The first request always stays; newer ones fill the remaining budget.
  const first = clip(texts[0], REQUEST_FIRST_CAP);
  const rest: string[] = [];
  let used = first.length;
  for (let i = texts.length - 1; i >= 1; i--) {
    const item = clip(texts[i], REQUEST_CAP);
    if (used + item.length > REQUESTS_TOTAL_CAP) break;
    used += item.length;
    rest.unshift(item);
  }
  const omitted = texts.length - 1 - rest.length;
  return [
    first,
    ...(omitted > 0 ? [`[... ${omitted} earlier request(s) omitted ...]`] : []),
    ...rest,
  ]
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
}

// Tool + target of the dropped assistant tool calls, so the model still knows
// which files it already touched. Pure function of the dropped messages.
const ACTIONS_CAP = 40;
const ACTION_TARGET_KEYS = [
  "filepath",
  "file_path",
  "path",
  "filename",
  "dirpath",
  "pattern",
  "query",
  "command",
  "url",
];

export function earlierActions(dropped: Msg[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const msg of dropped) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      const name = call?.function?.name;
      if (!name) continue;
      let target = "";
      try {
        const args = JSON.parse(call.function.arguments ?? "{}");
        const key = ACTION_TARGET_KEYS.find(
          (k) => typeof args?.[k] === "string",
        );
        if (key) target = String(args[key]).replace(/\s+/g, " ").slice(0, 120);
      } catch {
        // unparsable arguments: keep the tool name only
      }
      const line = target ? `${name}: ${target}` : name;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  if (lines.length === 0) return "";
  const kept = lines.slice(-ACTIONS_CAP);
  const omitted = lines.length - kept.length;
  return [
    ...(omitted > 0 ? [`[... ${omitted} earlier action(s) omitted ...]`] : []),
    ...kept,
  ]
    .map((l) => `- ${l}`)
    .join("\n");
}

function applyCompaction(
  messages: Msg[],
  dropped: Msg[],
  scope?: string,
): { messages: Msg[]; used: boolean; requests: boolean } {
  const none = { messages, used: false, requests: false };
  if (dropped.length === 0) return none;
  const canSummarize = Boolean(scope) && config.localSlm.compactionEnabled;
  let summary: string | undefined;
  if (canSummarize) {
    const key = droppedKey(scope!, dropped);
    summary = summaries.get(key);
    if (!summary) scheduleSummary(key, dropped);
  }
  const requests = earlierUserRequests(dropped);
  const actions = earlierActions(dropped);
  if (!summary && !requests && !actions) return none;
  const idx = messages.findIndex((m) => m.role === "user");
  if (idx < 0) return none;
  const block =
    (summary
      ? `<earlier-conversation-summary>\n${summary}\n</earlier-conversation-summary>\n\n`
      : `<earlier-conversation-omitted>\n${dropped.length} earlier message(s) were removed to fit the context window. Do not assume you remember them; re-read files before editing.\n</earlier-conversation-omitted>\n\n`) +
    (requests
      ? `<earlier-user-requests>\nThe user's earlier requests and constraints, still in force unless a later message changes them:\n${requests}\n</earlier-user-requests>\n\n`
      : "") +
    (actions
      ? `<earlier-actions>\nTools already run in the omitted turns (results are gone; re-read before relying on them):\n${actions}\n</earlier-actions>\n\n`
      : "");
  const out = [...messages];
  const first = out[idx];
  out[idx] = Array.isArray(first.content)
    ? { ...first, content: [{ type: "text", text: block }, ...first.content] }
    : { ...first, content: block + (first.content ?? "") };
  return { messages: out, used: Boolean(summary), requests: Boolean(requests) };
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
      upcoming,
    } = applyWindowTruncation(trimmed, budgetTokens);
    presummarize(upcoming, options.scope);
    if (saved > 0) strategy.push(`window(~${toTokens(saved)}tok)`);
    const { messages: deduped, saved: sDedupe } = applyReadDedupe(windowed);
    if (sDedupe > 0) strategy.push(`read-dedupe(~${toTokens(sDedupe)}tok)`);
    const {
      messages: compacted,
      used,
      requests,
    } = applyCompaction(deduped, dropped, options.scope);
    if (used) strategy.push("summary");
    if (requests) strategy.push("user-requests");
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
    upcoming,
  } = applyWindowTruncation(toolTrimmed, budgetTokens);
  presummarize(upcoming, options.scope);
  if (s1 > 0) strategy.push(`window(~${toTokens(s1)}tok)`);
  totalSaved += s1;
  const { messages: dedupedRead, saved: s1c } = applyReadDedupe(windowedRaw);
  if (s1c > 0) strategy.push(`read-dedupe(~${toTokens(s1c)}tok)`);
  totalSaved += s1c;
  const {
    messages: windowed,
    used,
    requests,
  } = applyCompaction(dedupedRead, dropped, options.scope);
  if (used) strategy.push("summary");
  if (requests) strategy.push("user-requests");

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
