import type { MessageContent } from "core";

/**
 * The exact tokenizer (js-tiktoken with every vocabulary, about 5.5 MB) used to
 * be bundled into the webview's main script, so every panel open parsed it.
 * It is now a separate chunk, fetched in the background shortly after startup
 * and waited for (a few seconds at most) before a prompt is built, so counts
 * that decide what gets truncated are exact. If it is not ready in time, a
 * conservative estimate is used for that prompt: it never counts fewer tokens
 * than a character is likely to cost, so context is trimmed too much rather
 * than too little.
 */
type Counter = (content: MessageContent, model?: string) => number;

let exactCounter: Counter | undefined;
let loading: Promise<void> | undefined;

/** Fetch the exact tokenizer once; safe to call repeatedly. */
export function ensureTokenizerLoaded(): Promise<void> {
  loading ??= import("core/llm/countTokens")
    .then((module) => {
      exactCounter = module.countTokens as Counter;
    })
    .catch((error) => {
      // Estimation keeps working; try again on the next call.
      console.warn("Could not load the exact tokenizer, estimating", error);
      loading = undefined;
    });
  return loading;
}

/**
 * Waits for the exact tokenizer, but never longer than `maxMs`: a prompt must
 * not sit behind a 6 MB module on a slow or busy machine. After the wait the
 * estimate is used, which is slightly generous, and loading continues.
 */
export async function waitForTokenizer(maxMs = 4_000): Promise<void> {
  if (exactCounter) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    ensureTokenizerLoaded(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function textOf(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * ASCII text costs about one token per 3.5 characters (a little above the
 * usual 4, so code is not under-counted); every other character (Sinhala,
 * Tamil, CJK, emoji) is counted as a whole token, which is what they cost in
 * the worst case.
 */
export function estimateTokenCount(content: MessageContent): number {
  let ascii = 0;
  let other = 0;
  for (const char of textOf(content)) {
    if (char.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.5 + other);
}

export function countTokens(content: MessageContent, model?: string): number {
  return exactCounter
    ? exactCounter(content, model)
    : estimateTokenCount(content);
}

/** Test hook: forget the loaded tokenizer. */
export function resetTokenizerForTests(): void {
  exactCounter = undefined;
  loading = undefined;
}
