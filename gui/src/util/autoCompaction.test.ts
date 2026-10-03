import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { AUTO_COMPACT_THRESHOLD, shouldAutoCompact } from "./autoCompaction";

function item(
  role: string,
  extra: Partial<ChatHistoryItem> = {},
): ChatHistoryItem {
  return {
    message: { role, content: "x", id: Math.random().toString() } as any,
    contextItems: [],
    ...extra,
  };
}

const turns = [
  item("user"),
  item("assistant"),
  item("user"),
  item("assistant"),
];

describe("shouldAutoCompact", () => {
  it("compacts between turns once context crosses the threshold", () => {
    expect(shouldAutoCompact(turns, false, AUTO_COMPACT_THRESHOLD, false)).toBe(
      true,
    );
    expect(
      shouldAutoCompact(turns, false, AUTO_COMPACT_THRESHOLD - 0.01, false),
    ).toBe(false);
  });

  it("never interrupts a running turn, a pending tool, or a compaction", () => {
    expect(shouldAutoCompact(turns, true, 0.9, false)).toBe(false);
    expect(shouldAutoCompact(turns, false, 0.9, true)).toBe(false);
    const pending = [
      ...turns.slice(0, 3),
      item("assistant", { toolCallStates: [{ status: "generated" } as any] }),
    ];
    expect(shouldAutoCompact(pending, false, 0.9, false)).toBe(false);
  });

  it("does not re-compact an already summarized point or a short chat", () => {
    const summarized = [
      ...turns.slice(0, 3),
      item("assistant", { conversationSummary: "s" }),
    ];
    expect(shouldAutoCompact(summarized, false, 0.9, false)).toBe(false);
    expect(shouldAutoCompact(turns.slice(0, 2), false, 0.9, false)).toBe(false);
    expect(shouldAutoCompact([...turns, item("user")], false, 0.9, false)).toBe(
      false,
    );
  });
});
