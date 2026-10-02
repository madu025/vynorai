import type { ChatHistoryItem, ToolCallState } from "core";
import {
  hasRecordedToolResult,
  selectBatchContinuation,
} from "./toolLoopGuards";

test("recognizes an already-recorded tool result", () => {
  const history = [
    {
      message: { role: "tool", content: "done", toolCallId: "call-1" },
      contextItems: [],
    },
  ] as ChatHistoryItem[];

  expect(hasRecordedToolResult(history, "call-1")).toBe(true);
  expect(hasRecordedToolResult(history, "call-2")).toBe(false);
});

test("selects exactly one continuation for a parallel tool batch", () => {
  const calls = [
    { toolCallId: "call-1" },
    { toolCallId: "call-2" },
    { toolCallId: "call-3" },
  ] as ToolCallState[];

  expect(selectBatchContinuation(calls)?.toolCallId).toBe("call-3");
  expect(selectBatchContinuation([])).toBeUndefined();
});
