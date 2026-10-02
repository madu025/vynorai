import type { ChatHistoryItem, ToolCallState } from "core";

export function hasRecordedToolResult(
  history: ChatHistoryItem[],
  toolCallId: string,
): boolean {
  return history.some(
    (item) =>
      item.message.role === "tool" && item.message.toolCallId === toolCallId,
  );
}

/** One completed parallel batch must produce one, and only one, continuation. */
export function selectBatchContinuation(
  toolCalls: ToolCallState[],
): ToolCallState | undefined {
  return toolCalls.at(-1);
}
