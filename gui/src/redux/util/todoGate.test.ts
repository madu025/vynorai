import type { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import {
  CONTINUE_TASK_PROMPT,
  jobStartIndex,
  PAUSE_MARKER,
  progressPause,
  STALL_LIMIT,
} from "./agentProgress";
import { missingTodoGate } from "./completionGate";
import { PREMORTEM_MARKER } from "./judgment";
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

describe("the todo gate after other prompts", () => {
  it("does not ask again because of a call made for a later prompt", () => {
    const history = [
      user("build"),
      todoCall([["deploy", "pending"]]),
      answer("stop"),
      user(`${TODO_GATE_MARKER} finish`, true),
      answer("Deploy cannot be done: there are no credentials."),
      user(`${PREMORTEM_MARKER} review your change`, true),
      call("grep_search", { query: "deploy" }),
      answer("Nothing else uses it."),
    ];
    // The search answered the pre-mortem; the open item was already
    // explained, and asking about it again got the same answer.
    expect(openTodoGate(history)).toBeUndefined();
  });

  it("asks again after an edit or a list update that left items open", () => {
    const reminded = [
      user("build"),
      todoCall([
        ["api", "pending"],
        ["deploy", "pending"],
      ]),
      answer("stop"),
      user(`${TODO_GATE_MARKER} finish`, true),
    ];
    expect(
      openTodoGate([
        ...reminded,
        call("create_new_file", { filepath: "src/api.js" }),
        answer("api written"),
      ])?.open,
    ).toHaveLength(2);
    expect(
      openTodoGate([
        ...reminded,
        todoCall([
          ["api", "completed"],
          ["deploy", "pending"],
        ]),
        answer("api done"),
      ])?.open.map((t) => t.content),
    ).toEqual(["deploy"]);
  });
});

describe("a job continued after a pause", () => {
  const paused = [
    user("build the shop"),
    todoCall([
      ["db", "completed"],
      ["api", "in_progress"],
      ["readme", "pending"],
    ]),
    call("create_new_file", { filepath: "src/db.js" }),
    call("create_new_file", { filepath: "src/api.js" }),
    user(`${PAUSE_MARKER} Your last several steps failed.`, true),
    answer("Done: db. Left: api, readme. Blocked: nothing."),
  ];

  it("keeps the job's todo list and request across Continue", () => {
    const history = [
      ...paused,
      user(CONTINUE_TASK_PROMPT),
      answer("Everything is finished."),
    ];
    // Continue is a real user message. The gates started at it, so the list
    // from before the pause was gone: the turn ended with two items open.
    expect(openTodoGate(history)?.open.map((t) => t.content)).toEqual([
      "api",
      "readme",
    ]);
    // ...and after two edits a new plan was asked for, quoting the Continue
    // text as the request.
    expect(missingTodoGate(history)).toBe(false);
    expect(history[jobStartIndex(history)].message.content).toBe(
      "build the shop",
    );
  });

  it("knows Continue as the editor sends it, and a second Continue", () => {
    const fromEditor = item({
      role: "user",
      content: [{ type: "text", text: CONTINUE_TASK_PROMPT }],
    });
    const history = [...paused, fromEditor, answer("x"), fromEditor];
    expect(jobStartIndex(history)).toBe(0);
  });

  it("starts a new job at any other user message", () => {
    const history = [...paused, user("now add a wishlist"), answer("ok")];
    expect(jobStartIndex(history)).toBe(paused.length);
    expect(openTodoGate(history)).toBeUndefined();
  });

  it("still starts the stall and same-failure counts again at Continue", () => {
    const stalled = [
      user("build the shop"),
      ...Array.from({ length: STALL_LIMIT }, () =>
        item(
          { role: "assistant", content: "" },
          {
            toolCallStates: [
              {
                status: "errored",
                toolCall: {
                  id: "t",
                  type: "function",
                  function: { name: "read_file", arguments: "" },
                },
                parsedArgs: { filepath: "missing.js" },
              },
            ],
          },
        ),
      ),
    ];
    expect(progressPause(stalled)).toBe("stalled");
    expect(
      progressPause([...stalled, user(CONTINUE_TASK_PROMPT)]),
    ).toBeUndefined();
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
