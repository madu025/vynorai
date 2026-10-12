import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { roundsSincePrompt } from "./agentProgress";

const item = (message: any, extra: Partial<ChatHistoryItem> = {}) =>
  ({ message, contextItems: [], ...extra }) as ChatHistoryItem;
const user = (text: string, isAutoPrompt = false) =>
  item({ role: "user", content: text }, { isAutoPrompt } as any);
const tool = () => item({ role: "tool", content: "ok", toolCallId: "t" });

/** What a reasoning model's round leaves in history: "", thinking, answer. */
const reasoningRound = () => [
  item({ role: "assistant", content: "" }),
  item({ role: "thinking", content: "plan" }),
  item({
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "t", type: "function", function: { name: "ls", arguments: "{}" } },
    ],
  }),
  tool(),
];

describe("roundsSincePrompt", () => {
  it("counts one round per model answer for a reasoning model", () => {
    const history = [
      user("build it"),
      ...Array.from({ length: 23 }, reasoningRound).flat(),
    ];
    // History holds 46 assistant items; the model answered 23 times.
    expect(history.filter((h) => h.message.role === "assistant")).toHaveLength(
      46,
    );
    expect(roundsSincePrompt(history)).toBe(23);
  });

  it("counts a text-only answer and ignores an empty placeholder", () => {
    const history = [
      user("hi"),
      item({ role: "assistant", content: "" }),
      item({ role: "assistant", content: "Done." }),
    ];
    expect(roundsSincePrompt(history)).toBe(1);
  });

  it("starts again at a real prompt but not at an auto prompt", () => {
    const history = [
      user("first"),
      ...reasoningRound(),
      user("please verify", true),
      ...reasoningRound(),
    ];
    expect(roundsSincePrompt(history)).toBe(2);
    expect(
      roundsSincePrompt([...history, user("next"), ...reasoningRound()]),
    ).toBe(1);
  });
});
