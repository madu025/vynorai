import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import {
  MAX_TODO_GATES,
  openTodoGate,
  todoGatePrompt,
  TODO_GATE_MARKER,
} from "./todoGate";
import { unverifiedEdits } from "./verificationGate";

const item = (message: any, extra: any = {}) =>
  ({ message, contextItems: [], ...extra }) as ChatHistoryItem;
const user = (content: string, isAutoPrompt = false) =>
  item({ role: "user", content }, { isAutoPrompt });
const call = (name: string, parsedArgs: unknown) =>
  item(
    { role: "assistant", content: "" },
    {
      toolCallStates: [
        {
          status: "done",
          toolCall: {
            id: "t",
            type: "function",
            function: { name, arguments: "" },
          },
          parsedArgs,
        },
      ],
    },
  );
const todoCall = (todos: Array<[string, string]>) =>
  call("update_todo_list", {
    todos: todos.map(([content, status]) => ({ content, status })),
  });
const answer = (text: string) => item({ role: "assistant", content: text });

describe("openTodoGate", () => {
  it("returns the open items of the current prompt's latest list", () => {
    const history = [
      user("build a shop"),
      todoCall([
        ["db", "completed"],
        ["api", "in_progress"],
        ["readme", "pending"],
      ]),
      answer("Done."),
    ];
    const gate = openTodoGate(history)!;
    expect(gate.total).toBe(3);
    expect(gate.open.map((t) => t.content)).toEqual(["api", "readme"]);
    const prompt = todoGatePrompt(gate.open, gate.total);
    expect(prompt).toContain("2 of the 3 items");
    expect(prompt.startsWith(TODO_GATE_MARKER)).toBe(true);
  });

  it("is quiet when every item is completed or there is no list", () => {
    expect(
      openTodoGate([user("x"), todoCall([["a", "completed"]]), answer("ok")]),
    ).toBeUndefined();
    expect(openTodoGate([user("x"), answer("ok")])).toBeUndefined();
  });

  it("ignores a list that belongs to an earlier prompt", () => {
    const history = [
      user("first"),
      todoCall([["a", "pending"]]),
      answer("stopped"),
      user("another question"),
      answer("answer"),
    ];
    expect(openTodoGate(history)).toBeUndefined();
  });

  it("stops reminding after the limit", () => {
    const history: ChatHistoryItem[] = [
      user("build"),
      todoCall([["a", "pending"]]),
      answer("stop"),
    ];
    for (let i = 0; i < MAX_TODO_GATES; i++) {
      expect(openTodoGate(history)).toBeDefined();
      history.push(
        user(`${TODO_GATE_MARKER} finish`, true),
        call("create_new_file", { filepath: `src/${i}.js` }),
        answer("still not"),
      );
    }
    expect(openTodoGate(history)).toBeUndefined();
  });

  it("does not repeat a reminder that was answered in words only", () => {
    const history = [
      user("build"),
      todoCall([["deploy", "pending"]]),
      answer("stop"),
      user(`${TODO_GATE_MARKER} finish`, true),
      answer("Deploy cannot be done: there are no credentials."),
    ];
    expect(openTodoGate(history)).toBeUndefined();
  });

  it("uses the list as updated after a reminder", () => {
    const history = [
      user("build"),
      todoCall([["a", "pending"]]),
      answer("stop"),
      user(`${TODO_GATE_MARKER} finish`, true),
      todoCall([["a", "completed"]]),
      answer("now done"),
    ];
    expect(openTodoGate(history)).toBeUndefined();
  });
});

describe("verification after a todo reminder", () => {
  it("still asks for a check when files were edited after the reminder", () => {
    const history = [
      user("build"),
      todoCall([["a", "pending"]]),
      answer("stop"),
      user(`${TODO_GATE_MARKER} finish`, true),
      call("create_new_file", { filepath: "src/a.js" }),
      answer("done"),
    ];
    expect(unverifiedEdits(history)).toEqual({ files: ["src/a.js"] });
  });
});
