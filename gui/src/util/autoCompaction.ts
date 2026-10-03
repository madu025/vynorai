import { ChatHistoryItem } from "core";
import { useEffect, useRef } from "react";
import { useAppSelector } from "../redux/hooks";
import { useCompactConversation } from "./compactConversation";

/** Compact once the prompt fills this share of the model's context window. */
export const AUTO_COMPACT_THRESHOLD = 0.7;
const MIN_HISTORY_ITEMS = 4;

/**
 * Decide whether to compact automatically after a turn. Only between turns:
 * never while streaming, while a tool awaits approval or runs, or right
 * after a compaction (the last item already carries a summary).
 */
export function shouldAutoCompact(
  history: ChatHistoryItem[],
  isStreaming: boolean,
  contextPercentage: number | undefined,
  isCompacting: boolean,
): boolean {
  if (isStreaming || isCompacting) return false;
  if ((contextPercentage ?? 0) < AUTO_COMPACT_THRESHOLD) return false;
  if (history.length < MIN_HISTORY_ITEMS) return false;
  const last = history[history.length - 1];
  if (last.message.role === "user" || last.conversationSummary) return false;
  const toolBusy = last.toolCallStates?.some(
    (s) =>
      s.status === "generating" ||
      s.status === "generated" ||
      s.status === "calling",
  );
  return !toolBusy;
}

/**
 * Summarize older turns automatically when the context gets full, so later
 * requests send a summary instead of the whole history (the same idea as
 * Claude Code's auto-compact). The manual "Compact conversation" action
 * remains available.
 */
export function useAutoCompaction(): void {
  const history = useAppSelector((state) => state.session.history);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const contextPercentage = useAppSelector(
    (state) => state.session.contextPercentage,
  );
  const sessionId = useAppSelector((state) => state.session.id);
  const isCompacting = useAppSelector(
    (state) => Object.keys(state.session.compactionLoading).length > 0,
  );
  const compactConversation = useCompactConversation();
  const lastAttempt = useRef<string | null>(null);

  useEffect(() => {
    if (
      !shouldAutoCompact(history, isStreaming, contextPercentage, isCompacting)
    )
      return;
    // At most one attempt per history state, even if compaction fails.
    const attemptKey = `${sessionId}:${history.length}`;
    if (lastAttempt.current === attemptKey) return;
    lastAttempt.current = attemptKey;
    void compactConversation(history.length - 1);
  }, [history, isStreaming, contextPercentage, isCompacting, sessionId]);
}
