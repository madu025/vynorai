import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { sanitizeThinkingContent } from "../mainInput/belowMainInput/ThinkingBlockPeek";
import { deriveTurnStatus, turnUsedThinking } from "./turnStatus";

function item(
  partial: Partial<ChatHistoryItem> & { role?: string; content?: string },
): ChatHistoryItem {
  const { role = "assistant", content = "", ...rest } = partial;
  return {
    message: { role, content, id: Math.random().toString() } as any,
    contextItems: [],
    ...rest,
  };
}

function toolState(
  name: string,
  status: string,
  args: Record<string, unknown> = {},
): any {
  return {
    toolCallId: "t1",
    status,
    parsedArgs: args,
    toolCall: {
      id: "t1",
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  };
}

const user = item({ role: "user", content: "fix the login bug" });

describe("deriveTurnStatus", () => {
  it("is idle when nothing runs", () => {
    expect(
      deriveTurnStatus([user, item({ content: "done." })], false),
    ).toBeNull();
  });

  it("says Working (not Thinking) while waiting for the first token", () => {
    expect(deriveTurnStatus([user, item({})], true)?.phase).toBe("working");
  });

  it("says Thinking only while reasoning actually streams", () => {
    const thinking = item({
      reasoning: { active: true, text: "let me look", startAt: 1 },
    });
    expect(deriveTurnStatus([user, thinking], true)?.phase).toBe("thinking");
  });

  it("names the real tool target", () => {
    const editing = item({
      toolCallStates: [
        toolState("multi_edit", "calling", { filepath: "src/auth.ts" }),
      ],
    });
    expect(deriveTurnStatus([user, editing], true)?.label).toBe(
      "Editing src/auth.ts",
    );
    const terminal = item({
      toolCallStates: [toolState("run_terminal_command", "calling")],
    });
    expect(deriveTurnStatus([user, terminal], true)?.label).toBe(
      "Running a command",
    );
  });

  it("surfaces pending approval even when the stream has stopped", () => {
    const pending = item({
      toolCallStates: [toolState("run_terminal_command", "generated")],
    });
    expect(deriveTurnStatus([user, pending], false)?.phase).toBe("approval");
  });

  it("counts only the current turn's streamed text", () => {
    const old = item({ content: "x".repeat(4000) });
    const current = item({ content: "y".repeat(400) });
    const status = deriveTurnStatus([user, old, user, current], true);
    expect(status?.phase).toBe("writing");
    expect(status?.tokens).toBe(100);
  });
});

describe("turnUsedThinking", () => {
  it("detects reasoning anywhere in the turn but not in earlier turns", () => {
    const reasoned = item({
      reasoning: { active: false, text: "plan", startAt: 1, endAt: 2 },
    });
    const history = [
      user,
      reasoned,
      item({ content: "answer" }),
      user,
      item({ content: "quick" }),
    ];
    expect(turnUsedThinking(history, 2)).toBe(true);
    expect(turnUsedThinking(history, 4)).toBe(false);
  });
});

describe("sanitizeThinkingContent", () => {
  it("white-labels explicit model identifiers", () => {
    const out = sanitizeThinkingContent(
      "Local Qwen 2.5 Coder 3B planned it; DeepSeek V4.1 Flash wrote it via llama.cpp",
    );
    expect(out).not.toMatch(/Qwen|DeepSeek|llama\.cpp/);
  });

  it("leaves code and ambiguous words alone", () => {
    const text =
      "Call `DeepSeek R1` in `client.ts`, then check cell R1 and the DeepSeek SDK.\n```ts\nnew DeepSeek()\n```";
    expect(sanitizeThinkingContent(text)).toBe(text);
  });
});
