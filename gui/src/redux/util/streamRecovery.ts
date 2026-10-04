import { ChatHistoryItem } from "core";

/**
 * Mid-response network failures (a dropped connection, an upstream timeout or
 * a 502/503/504 from the gateway) should not throw the whole turn away. The
 * partial reply is kept and the model is asked once to continue from it.
 */
export const STREAM_RECOVERY_MARKER = "[stream-recovery]";

const TRANSIENT =
  /premature close|econnreset|econnrefused|etimedout|epipe|socket hang up|network ?error|fetch failed|timed? ?out|timeout|terminated|other side closed|stream (was )?(ended|closed|interrupted)|\b50[234]\b|bad gateway|service unavailable|gateway time-?out/i;

/** True for errors worth one automatic continue (never a user abort). */
export function isTransientStreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return TRANSIENT.test(`${error.name} ${error.message}`);
}

/** The latest user turn is already a recovery prompt: do not loop. */
export function alreadyRecovered(history: ChatHistoryItem[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.message.role !== "user") continue;
    const content = item.message.content;
    return (
      !!item.isAutoPrompt &&
      typeof content === "string" &&
      content.startsWith(STREAM_RECOVERY_MARKER)
    );
  }
  return false;
}

/** Text of the last assistant message, if any (the partial reply). */
export function partialReply(history: ChatHistoryItem[]): string {
  const last = history[history.length - 1];
  if (!last || last.message.role !== "assistant") return "";
  const content = last.message.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.map((p) => (p.type === "text" ? p.text : "")).join("")
    : "";
}

export function streamRecoveryPrompt(hadPartialReply: boolean): string {
  return hadPartialReply
    ? `${STREAM_RECOVERY_MARKER} Your previous reply was cut off by a network error. Continue exactly where it stopped. Do not repeat what you already wrote. If you were about to call a tool, call it now.`
    : `${STREAM_RECOVERY_MARKER} The connection dropped before you replied. Answer the previous request now.`;
}
