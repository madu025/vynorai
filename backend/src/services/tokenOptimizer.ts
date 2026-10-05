/**
 * Token Optimization & Prompt Caching Service for VynorAI
 * Implements:
 * 1. Anthropic Ephemeral Prompt Caching (90% input token discount)
 * 2. DeepSeek / OpenAI Prefix Alignment (automatic 50-75% discount)
 * 3. Smart Code Compression (pruning duplicate whitespace and empty lines)
 */

import crypto from "crypto";

// ─── Prefix-cache layout ──────────────────────────────────────────────────────
// DeepSeek / OpenAI / OpenRouter bill a repeated prompt *prefix* at a fraction
// of the normal input price. The prefix is: system prompt → tools → history.
// Anything that changes per request (RAG hits, web results, scaffold hints)
// must therefore ride on the LAST user message, never on the system message.

const TURN_CONTEXT_MAX = 1000;
const TURN_CONTEXT_TTL_MS = 30 * 60_000;
const turnContextMemo = new Map<string, { text: string; at: number }>();

function messageText(msg: any): string {
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content))
    return msg.content.map((p: any) => p?.text ?? "").join("");
  return "";
}

/** Stable identity of the current user turn (same across its whole tool loop). */
export function turnKey(scope: string, messages: any[]): string {
  const lastUser = [...(messages ?? [])]
    .reverse()
    .find((m: any) => m.role === "user");
  return crypto
    .createHash("sha256")
    .update(`${scope}\u0000${messageText(lastUser)}`)
    .digest("hex");
}

/**
 * Compute per-turn context once and replay it for every request in the same
 * turn, so tool-loop follow-ups send a byte-identical prefix.
 */
export async function memoizeTurnContext(
  key: string,
  compute: () => Promise<string>,
): Promise<string> {
  const hit = turnContextMemo.get(key);
  if (hit && Date.now() - hit.at < TURN_CONTEXT_TTL_MS) return hit.text;
  const text = await compute();
  if (turnContextMemo.size >= TURN_CONTEXT_MAX) {
    const oldest = turnContextMemo.keys().next().value;
    if (oldest) turnContextMemo.delete(oldest);
  }
  turnContextMemo.set(key, { text, at: Date.now() });
  return text;
}

/**
 * Append per-turn context to the end of the last message. Upstream prefix
 * caching matches from the start, so the block must sit after everything the
 * next request will resend unchanged. Inside the last *user* message it made
 * the next turn differ from that message on, and the whole previous tool loop
 * was billed again as uncached input.
 */
export function attachTurnContext(messages: any[], context: string): any[] {
  if (!context.trim() || messages.length === 0) return messages;
  const idx = messages.length - 1;
  const msg = messages[idx];
  if (msg.role !== "user" && msg.role !== "tool") return messages;
  const block = `

<vynor-context note="background context added by VynorAI, not part of the message above">
${context.trim()}
</vynor-context>`;
  const content = Array.isArray(msg.content)
    ? [...msg.content, { type: "text", text: block }]
    : (msg.content ?? "") + block;
  const out = [...messages];
  out[idx] = { ...msg, content };
  return out;
}

export interface OptimizedRequest {
  messages: any[];
  system?: any;
  tools?: any[];
  estimatedSavedTokens: number;
}

/**
 * Compress code content by stripping redundant whitespace and trailing lines
 * while preserving strict indentation and code integrity.
 */
export function compressCodeSnippet(code: string): string {
  if (!code || typeof code !== "string") return code;

  // Replace 3+ consecutive newlines with a single empty line
  let compressed = code.replace(/\n\s*\n\s*\n+/g, "\n\n");

  // Remove trailing whitespace on each line
  compressed = compressed
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  return compressed;
}

/**
 * Optimizes request payload specifically for Anthropic Claude (Claude 3.7 / 3.5 Sonnet)
 * Injects `cache_control: { type: "ephemeral" }` on system instructions, tools, and repo context.
 */
export function optimizeForAnthropic(body: any): any {
  const { messages = [], system, tools, ...rest } = body;
  let savedTokens = 0;

  // 1. Structure System Prompt with Anthropic Prompt Caching
  let optimizedSystem = system;
  if (typeof system === "string" && system.length > 500) {
    optimizedSystem = [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ];
    savedTokens += Math.floor(system.length / 4);
  }

  // 2. Add Prompt Cache breakpoint on tools declarations
  let optimizedTools = tools;
  if (Array.isArray(tools) && tools.length > 0) {
    optimizedTools = tools.map((tool, idx) => {
      // Mark the last tool with ephemeral cache control
      if (idx === tools.length - 1) {
        return {
          ...tool,
          cache_control: { type: "ephemeral" },
        };
      }
      return tool;
    });
  }

  // 3. Optimize messages and place cache breakpoint on long context messages
  const optimizedMessages = messages.map((msg: any, idx: number) => {
    let content = msg.content;

    // Compress code snippets within content
    if (typeof content === "string") {
      content = compressCodeSnippet(content);
    } else if (Array.isArray(content)) {
      content = content.map((part: any) => {
        if (part.type === "text" && typeof part.text === "string") {
          return { ...part, text: compressCodeSnippet(part.text) };
        }
        return part;
      });
    }

    // Add cache control to large user context (e.g. codebase context, files)
    const isLargeContext =
      typeof content === "string" ? content.length > 2000 : false;

    // Place cache breakpoint on the 2nd to last message if it has large context
    if (isLargeContext && idx === messages.length - 2) {
      if (typeof content === "string") {
        return {
          ...msg,
          content: [
            {
              type: "text",
              text: content,
              cache_control: { type: "ephemeral" },
            },
          ],
        };
      }
    }

    return { ...msg, content };
  });

  return {
    ...rest,
    system: optimizedSystem,
    tools: optimizedTools,
    messages: optimizedMessages,
  };
}

/**
 * Optimizes request payload for OpenAI / DeepSeek
 * DeepSeek & OpenAI use automatic prefix caching. We ensure all invariant messages
 * (system prompt, rules, codebase index) stay strictly at the start of the prompt.
 */
export function optimizeForOpenAI(body: any): any {
  const { messages = [], ...rest } = body;

  const optimizedMessages = messages.map((msg: any) => {
    let content = msg.content;
    if (typeof content === "string") {
      content = compressCodeSnippet(content);
    }
    return { ...msg, content };
  });

  return {
    ...rest,
    messages: optimizedMessages,
  };
}
