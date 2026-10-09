import type { MessageContent } from "core";

/**
 * The exact tokenizer (js-tiktoken with every vocabulary, about 5.5 MB) used to
 * be bundled into the webview's main script, so every panel open parsed it.
 * It is now a separate chunk, fetched in the background after startup and always
 * awaited before a prompt is built, so counts that decide what gets truncated
 * stay exact. Until it has loaded (only the first moments of a session), a
 * cautious character estimate is used.
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

function textLength(content: MessageContent): number {
  if (typeof content === "string") return content.length;
  return content.reduce(
    (sum, part) => sum + (part.type === "text" ? part.text.length : 0),
    0,
  );
}

/** Slightly above chars/4 so an item is never kept longer than its budget. */
export function estimateTokenCount(content: MessageContent): number {
  return Math.ceil(textLength(content) / 3.5);
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
