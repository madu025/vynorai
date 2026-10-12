import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWER_MARKER,
  EMPTY_ANSWER_PROMPT,
  emptyAnswerGate,
} from "./emptyAnswerGate";

const item = (message: any, extra: any = {}) =>
  ({ message, contextItems: [], ...extra }) as ChatHistoryItem;
const user = (content: string, isAutoPrompt = false) =>
  item({ role: "user", content }, { isAutoPrompt });
const answer = (content: string) => item({ role: "assistant", content });
const thinking = (content: string) => item({ role: "thinking", content });
const toolCall = () =>
  item(
    { role: "assistant", content: "" },
    {
      toolCallStates: [
        {
          status: "done",
          toolCall: {
            id: "t",
            type: "function",
            function: { name: "run_terminal_command", arguments: "" },
          },
        },
      ],
    },
  );
const toolResult = () => item({ role: "tool", content: "ok", toolCallId: "t" });

describe("emptyAnswerGate", () => {
  it("fires when the answer after a tool result is only thinking", () => {
    const history = [
      user("build an app"),
      toolCall(),
      toolResult(),
      answer(""),
      thinking("let me plan the schema"),
      answer(""),
    ];
    expect(emptyAnswerGate(history)).toBe(true);
  });

  it("does not fire when the answer has text", () => {
    const history = [user("build an app"), thinking("hm"), answer("Done.")];
    expect(emptyAnswerGate(history)).toBe(false);
  });

  it("does not fire when the answer calls a tool", () => {
    const history = [user("build an app"), thinking("hm"), toolCall()];
    expect(emptyAnswerGate(history)).toBe(false);
  });

  it("does not fire before the model has answered", () => {
    expect(emptyAnswerGate([user("build an app")])).toBe(false);
  });

  it("stops after two reminders for one prompt", () => {
    const history = [
      user("build an app"),
      answer(""),
      user(EMPTY_ANSWER_PROMPT, true),
      answer(""),
    ];
    expect(emptyAnswerGate(history)).toBe(true);
    history.push(user(EMPTY_ANSWER_PROMPT, true), answer(""));
    expect(emptyAnswerGate(history)).toBe(false);
  });

  it("counts reminders for the current prompt only", () => {
    const history = [
      user("first"),
      answer(""),
      user(EMPTY_ANSWER_PROMPT, true),
      answer(""),
      user(EMPTY_ANSWER_PROMPT, true),
      answer("ok"),
      user("second"),
      answer(""),
    ];
    expect(emptyAnswerGate(history)).toBe(true);
  });

  it("starts the prompt with the marker", () => {
    expect(EMPTY_ANSWER_PROMPT.startsWith(EMPTY_ANSWER_MARKER)).toBe(true);
  });
});
