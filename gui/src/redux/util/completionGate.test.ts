import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import {
  missingTodoGate,
  completionGatePrompt,
  COMPLETION_GATE_MARKER,
} from "./completionGate";

const item = (message: any, extra: any = {}) =>
  ({ message, contextItems: [], ...extra }) as ChatHistoryItem;
const user = (content: string, isAutoPrompt = false) =>
  item({ role: "user", content }, { isAutoPrompt });
const editCall = (filepath: string) =>
  item(
    { role: "assistant", content: "" },
    {
      toolCallStates: [
        {
          status: "done",
          toolCall: {
            id: "t",
            type: "function",
            function: { name: "edit_existing_file", arguments: "" },
          },
          parsedArgs: { filepath },
        },
      ],
    },
  );
const todoCall = (todos: Array<[string, string]>) =>
  item(
    { role: "assistant", content: "" },
    {
      toolCallStates: [
        {
          status: "done",
          toolCall: {
            id: "t",
            type: "function",
            function: { name: "update_todo_list", arguments: "" },
          },
          parsedArgs: {
            todos: todos.map(([content, status]) => ({ content, status })),
          },
        },
      ],
    },
  );
const answer = (text: string) => item({ role: "assistant", content: text });

describe("missingTodoGate", () => {
  it("fires when 2+ files are edited but no todo list exists", () => {
    const history = [
      user("build an app"),
      editCall("index.ts"),
      editCall("style.css"),
      answer("Done."),
    ];
    expect(missingTodoGate(history)).toBe(true);
  });

  it("does not fire for a single-file edit", () => {
    const history = [
      user("fix the bug"),
      editCall("index.ts"),
      answer("Done."),
    ];
    expect(missingTodoGate(history)).toBe(false);
  });

  it("does not fire when a todo list exists", () => {
    const history = [
      user("build an app"),
      todoCall([["setup", "in_progress"]]),
      editCall("index.ts"),
      editCall("style.css"),
      answer("Done."),
    ];
    expect(missingTodoGate(history)).toBe(false);
  });

  it("does not fire when there are no edits", () => {
    const history = [user("explain the code"), answer("It does X.")];
    expect(missingTodoGate(history)).toBe(false);
  });

  it("fires at most once per prompt", () => {
    const history = [
      user("build an app"),
      editCall("index.ts"),
      editCall("style.css"),
      answer("I started."),
      user(
        `${COMPLETION_GATE_MARKER} You started working but did not create a todo list.`,
        true,
      ),
      editCall("app.ts"),
      answer("More done."),
    ];
    expect(missingTodoGate(history)).toBe(false);
  });

  it("does not look past the current prompt", () => {
    const history = [
      user("fix bug"),
      editCall("bug.ts"),
      editCall("test.ts"),
      answer("Fixed."),
      user("explain the fix"),
      answer("The fix changed X."),
    ];
    expect(missingTodoGate(history)).toBe(false);
  });
});

describe("completionGatePrompt", () => {
  it("includes the marker and the user request", () => {
    const prompt = completionGatePrompt("build an e-commerce app");
    expect(prompt.startsWith(COMPLETION_GATE_MARKER)).toBe(true);
    expect(prompt).toContain("build an e-commerce app");
    expect(prompt).toContain("update_todo_list");
  });

  it("truncates a long request", () => {
    const long = "x".repeat(800);
    const prompt = completionGatePrompt(long);
    expect(prompt).toContain("…");
    expect(prompt.length).toBeLessThan(long.length + 200);
  });
});
