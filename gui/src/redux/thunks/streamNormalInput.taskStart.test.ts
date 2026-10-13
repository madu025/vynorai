import { AssistantChatMessage, PromptLog } from "core";
import { serializeTool } from "core/tools";
import {
  runTerminalCommandTool,
  updateTodoListTool,
} from "core/tools/definitions";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
import { CONTINUE_TASK_PROMPT } from "../util/agentProgress";
import { TASK_SCOPE_MARKER } from "../util/taskScope";
import { streamNormalInput } from "./streamNormalInput";

const terminalTool = serializeTool(runTerminalCommandTool);
const terminalName = terminalTool.function.name;
const todoTool = serializeTool(updateTodoListTool);

/** The model's answers in order: a command to run, or a text. */
function answers(...list: Array<{ command: string } | string>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const answer = list[call++] ?? "done";
    return (async function* (): AsyncGenerator<
      AssistantChatMessage[],
      PromptLog
    > {
      yield typeof answer === "string"
        ? [{ role: "assistant", content: answer }]
        : [
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: `call-${call}`,
                  type: "function",
                  function: {
                    name: terminalName,
                    arguments: JSON.stringify(answer),
                  },
                },
              ],
            },
          ];
      return {
        prompt: "p",
        completion: "c",
        modelTitle: "Claude",
        modelProvider: "anthropic",
      };
    })();
  });
}

/**
 * A session whose last item is a new user prompt. `start` answers
 * `agent/task/start`; every request is recorded.
 */
function storeWith(
  history: unknown[],
  start: (data: any) => { status: string; [key: string]: unknown },
) {
  const state = getRootStateWithClaude();
  state.session.mode = "agent";
  state.session.isStreaming = true;
  state.session.activeTaskId = "task-1";
  state.config.config.tools = [terminalTool, todoTool];
  state.ui.toolSettings = {
    [terminalName]: "allowedWithoutPermission",
    [todoTool.function.name]: "allowedWithoutPermission",
  };
  state.session.history = history as any;
  const store = createMockStore(state);
  const messenger = store.mockIdeMessenger;
  messenger.responses["llm/compileChat"] = {
    compiledChatMessages: [],
    didPrune: false,
    contextPercentage: 0.1,
  };
  messenger.responseHandlers["workspace/getVerificationPlan"] = async () => [];
  const requests: Array<{ type: string; data: any }> = [];
  const base = messenger.request.bind(messenger);
  messenger.request = (async (type: string, data: unknown) => {
    requests.push({ type, data });
    if (type === "agent/task/start") return { ...start(data), done: true };
    if (type.startsWith("agent/") || type === "checkpoints/setActiveTask")
      return { status: "success", content: { state: "executing" }, done: true };
    return base(type as any, data as any);
  }) as typeof messenger.request;
  return { store, messenger, requests };
}

const user = (id: string, content: string) => ({
  message: { id, role: "user", content },
  contextItems: [],
});
const reply = (id: string, content: string) => ({
  message: { id, role: "assistant", content },
  contextItems: [],
});
const session = (store: ReturnType<typeof createMockStore>) =>
  (store.getState() as RootState).session;

describe("a prompt whose task could not be started", () => {
  it("runs one semantic scope preflight and appends its decision to the job", async () => {
    const { store, messenger, requests } = storeWith(
      [user("u1", "build a complete booking platform")],
      () => ({
        status: "success",
        content: { id: "task-2", state: "planning" },
      }),
    );
    messenger.responses["llm/complete"] =
      '{"scope":"complex","confidence":0.96,"impliedDeliverables":["booking","admin"],"reason":"Multiple roles and workflows."}';
    messenger.llmStreamChat = answers("I will plan the implementation.");

    await (store.dispatch as any)(streamNormalInput({}));

    const scopeRequests = requests.filter((r) => r.type === "llm/complete");
    expect(scopeRequests).toHaveLength(1);
    expect(scopeRequests[0].data.completionOptions.requestKind).toBe(
      "task_scope",
    );
    expect(scopeRequests[0].data.completionOptions.cachePolicy).toBe("bypass");
    expect(
      session(store).history.some(
        (item) =>
          item.isAutoPrompt &&
          String(item.message.content).startsWith(TASK_SCOPE_MARKER) &&
          String(item.message.content).includes("scope=complex"),
      ),
    ).toBe(true);
    expect(requests.find((r) => r.type === "agent/task/start")?.data.goal).toBe(
      "build a complete booking platform",
    );
  });

  it("refuses non-todo tools until a complex task has a todo list", async () => {
    const { store, messenger, requests } = storeWith(
      [user("u1", "build a complete booking platform")],
      () => ({
        status: "success",
        content: { id: "task-2", state: "planning" },
      }),
    );
    messenger.responses["llm/complete"] =
      '{"scope":"complex","confidence":0.96,"impliedDeliverables":["booking","admin"],"reason":"Multiple roles and workflows."}';
    messenger.llmStreamChat = answers(
      { command: "git status" },
      "I need to create the todo list first.",
    );

    await (store.dispatch as any)(streamNormalInput({}));

    expect(requests.filter((r) => r.type === "tools/call")).toHaveLength(0);
    expect(
      session(store).history.some((item) =>
        item.toolCallStates?.some(
          (call) =>
            call.toolCall.function.name === terminalName &&
            call.status === "errored",
        ),
      ),
    ).toBe(true);
  });

  it("never runs its tool calls under the task of the prompt before", async () => {
    const { store, messenger, requests } = storeWith(
      [
        user("u1", "fix the login bug"),
        reply("a1", "Fixed."),
        user("u2", "now add a logout button"),
      ],
      () => ({ status: "error", error: "Request timed out" }),
    );
    messenger.llmStreamChat = answers({ command: "git status" }, "Added.");

    await (store.dispatch as any)(streamNormalInput({}));

    // The command did run...
    expect(requests.filter((r) => r.type === "tools/call")).toHaveLength(1);
    // ...and not under task-1. That task was kept when the start failed: if
    // it had ended, every call of the new prompt was refused with "Task is
    // terminal"; if not, the new prompt took over its step count.
    expect(
      requests.filter(
        (r) => r.type.startsWith("agent/") && r.data?.taskId === "task-1",
      ),
    ).toEqual([]);
    expect(session(store).activeTaskId).toBeUndefined();
  });

  it("uses the new task when the start succeeds", async () => {
    const { store, messenger, requests } = storeWith(
      [
        user("u1", "fix the login bug"),
        reply("a1", "Fixed."),
        user("u2", "now add a logout button"),
      ],
      () => ({
        status: "success",
        content: { id: "task-2", state: "planning" },
      }),
    );
    messenger.llmStreamChat = answers({ command: "git status" }, "Added.");

    await (store.dispatch as any)(streamNormalInput({}));

    const authorized = requests.filter(
      (r) => r.type === "agent/task/authorizeAction",
    );
    expect(authorized.map((r) => r.data.taskId)).toEqual(["task-2"]);
    expect(session(store).activeTaskId).toBe("task-2");
  });
});

describe("the task of a job continued after a pause", () => {
  it("has the job's request as its goal and hangs on the Continue message", async () => {
    const { store, messenger, requests } = storeWith(
      [
        user("u1", "build the shop"),
        reply("a1", "Done: db. Left: api."),
        user("u2", CONTINUE_TASK_PROMPT),
      ],
      () => ({
        status: "success",
        content: { id: "task-2", state: "planning" },
      }),
    );
    messenger.llmStreamChat = answers("The api is written.");

    await (store.dispatch as any)(streamNormalInput({}));

    const start = requests.find((r) => r.type === "agent/task/start")!;
    // The goal was "Continue the task from where you stopped."
    expect(start.data.goal).toBe("build the shop");
    // Continue is still its own prompt for rewind: the task is tagged on it,
    // and the first prompt keeps the task it had.
    const history = session(store).history;
    expect(history.find((h) => h.message.id === "u2")?.taskId).toBe("task-2");
    expect(history.find((h) => h.message.id === "u1")?.taskId).toBeUndefined();
  });
});
