import type { ChatMessage } from "core";

/**
 * Model output arrives in many tiny pieces. Dispatching each one re-renders
 * and re-parses the markdown of the whole chat every time, which blocked the
 * chat panel for tens of seconds on a long answer. Pieces are collected and
 * applied together at most once per interval; order is kept, and the rest is
 * applied by `flush` (end of stream, abort, error).
 */
export const STREAM_UPDATE_INTERVAL_MS = 80;

export function createStreamBatcher(
  apply: (messages: ChatMessage[]) => void,
  now: () => number = Date.now,
  intervalMs: number = STREAM_UPDATE_INTERVAL_MS,
) {
  let pending: ChatMessage[] = [];
  let lastApplied = 0;
  const flush = () => {
    if (pending.length > 0) {
      const batch = pending;
      pending = [];
      apply(batch);
    }
    lastApplied = now();
  };
  return {
    push(messages: ChatMessage[]) {
      pending.push(...messages);
      if (now() - lastApplied >= intervalMs) flush();
    },
    flush,
  };
}
