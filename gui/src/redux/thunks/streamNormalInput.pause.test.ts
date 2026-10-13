import { AssistantChatMessage, ChatHistoryItem, PromptLog } from "core";
import { MAX_AUTONOMOUS_STEPS } from "core/agent/guardErrors";
import { serializeTool } from "core/tools";
import { runTerminalCommandTool } from "core/tools/definitions";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
import { queueBackgroundCommandResult } from "../slices/sessionSlice";
import {
  SAME_FAILURE_MARKER,
  SAME_FAILURE_NUDGE,
  STALL_LIMIT,
} from "../util/agentProgress";
import { TODO_GATE_MARKER } from "../util/todoGate";
import { VERIFICATION_GATE_MARKER } from "../util/verificationGate";
import { streamNormalInput } from "./streamNormalInput";

const terminalTool = serializeTool(runTerminalCommandTool);

function replies(...texts: string[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const text = texts[call++] ?? "done";
    return (async function* (): AsyncGenerator<
      AssistantChatMessage[],
      PromptLog
    > {
      yield [{ role: "assistant", content: text }];
      return {
        prompt: "p",
        completion: text,
        modelTitle: "Claude",
        modelProvider: "anthropic",
      };
    })();
  });
}

let id = 0;
/** One finished tool round: the assistant item and its tool result. */
const call = (
  name: string,
  parsedArgs: object,
  status = "done",
  output?: object[],
) =>
  [
    {
      message: {
        id: `a${++id}`,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: `c${id}`,
            type: "function",
            function: { name, arguments: "{}" },
          },
        ],
      },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: `c${id}`,
          status,
          parsedArgs,
          output,
          toolCall: {
            id: `c${id}`,
            type: "function",
            function: { name, arguments: "{}" },
          },
        },
      ],
    },
    {
      message: {
        id: `t${id}`,
        role: "tool",
        content: "result",
        toolCallId: `c${id}`,
      },
      contextItems: [],
    },
  ] as unknown as ChatHistoryItem[];
const failedTest = () =>
  call("run_terminal_command", { command: "npm test" }, "done", [
    {
      name: "Terminal",
      description: "Terminal command output",
      status: "Command failed with exit code 1",
      content: "1 failed: cart total is NaN",
    },
  ]);

/** `rounds` may be nested; every round is an assistant item and its result. */
function storeWith(rounds: unknown[]) {
  const history = (rounds as any[]).flat(3) as ChatHistoryItem[];
  const state = getRootStateWithClaude();
  state.session.mode = "agent";
  state.session.isStreaming = true;
  state.config.config.tools = [terminalTool];
  state.session.history = [
    {
      message: { id: "u1", role: "user", content: "build the shop" },
      contextItems: [],
    },
    ...history,
  ] as any;
  const store = createMockStore(state);
  const messenger = store.mockIdeMessenger;
  messenger.responses["llm/compileChat"] = {
    compiledChatMessages: [],
    didPrune: false,
    contextPercentage: 0.1,
  };
  messenger.responseHandlers["workspace/getVerificationPlan"] = async () => [];
  return { store, messenger };
}

const session = (store: ReturnType<typeof createMockStore>) =>
  (store.getState() as RootState).session;
const autoPrompts = (store: ReturnType<typeof createMockStore>) =>
  session(store)
    .history.filter((item) => item.isAutoPrompt)
    .map((item) => String(item.message.content));
const toolsSent = (messenger: any, n = 0) =>
  messenger.llmStreamChat.mock.calls[n][0].completionOptions.tools ?? [];

describe("a turn with no round cap", () => {
  it("appends a pending background result before the next model round", async () => {
    const { store, messenger } = storeWith([]);
    const originalUser = session(store).history[0].message;
    messenger.llmStreamChat = replies("I will repair the failed command.");
    store.dispatch(
      queueBackgroundCommandResult({
        toolCallId: "background-1",
        contextItems: [
          {
            name: "Terminal",
            description: "Background command result",
            content: "server failed",
            status: "Background command failed with exit code 1",
          },
        ],
      }),
    );

    await (store.dispatch as any)(streamNormalInput({}));

    expect(session(store).history[0].message).toEqual(originalUser);
    expect(autoPrompts(store)).toContainEqual(
      expect.stringContaining("[background-command-result]"),
    );
    expect(session(store).pendingBackgroundCommandResults).toEqual([]);
    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(1);
  });

  it("keeps its tools after far more than 40 rounds of real work", async () => {
    const { store, messenger } = storeWith(
      Array.from({ length: 90 }, (_, i) => [
        call("create_new_file", { filepath: `src/f${i}.js` }),
        call("run_terminal_command", { command: "npm test" }, "done", [
          {
            name: "Terminal",
            description: "Terminal command output",
            status: "Command completed",
            content: `${i} passed, 0 failed`,
          },
        ]),
      ]).flat(),
    );
    messenger.llmStreamChat = replies("All done.");

    await (store.dispatch as any)(streamNormalInput({}));

    expect(toolsSent(messenger).length).toBeGreaterThan(0);
    expect(session(store).toolBudgetPausedAfter).toBeUndefined();
  });

  it("pauses a stuck turn: one answer without tools, then the banner", async () => {
    const { store, messenger } = storeWith(
      Array.from({ length: STALL_LIMIT }, () =>
        call("read_file", { filepath: "missing.js" }, "errored"),
      ),
    );
    messenger.llmStreamChat = replies(
      "Done so far: nothing. Blocked: no file.",
    );

    await (store.dispatch as any)(streamNormalInput({}));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(1);
    // The paused round keeps its tools (the request is the same as the round
    // before, so the prompt cache holds, and the model is not told its tools
    // were switched off). The pause is told as the last message.
    expect(toolsSent(messenger).length).toBeGreaterThan(0);
    expect(session(store).toolBudgetPauseReason).toBe("stalled");
    expect(session(store).toolBudgetPausedAfter).toBeDefined();
    // A paused turn is not sent back by a gate: the only automatic prompt is
    // the pause itself.
    expect(autoPrompts(store)).toHaveLength(1);
    expect(autoPrompts(store)[0]).toMatch(/^\[paused\] /);
    expect(session(store).isStreaming).toBe(false);
  });

  it("pauses at the action limit when the prompt has no task to count for it", async () => {
    // No task here (its start failed), so nothing in the core counts calls.
    const { store, messenger } = storeWith(
      Array.from({ length: MAX_AUTONOMOUS_STEPS }, (_, i) =>
        call("create_new_file", { filepath: `src/f${i}.js` }),
      ),
    );
    messenger.llmStreamChat = replies("Done so far: 200 files.");

    await (store.dispatch as any)(streamNormalInput({}));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(1);
    expect(session(store).toolBudgetPauseReason).toBe("actions");
    expect(session(store).toolBudgetPausedAfter).toBeDefined();
    expect(autoPrompts(store)[0]).toMatch(/^\[paused\] /);
  });

  it("tells the model once about a check that keeps failing, without pausing", async () => {
    const { store, messenger } = storeWith(
      Array.from({ length: SAME_FAILURE_NUDGE }, (_, i) => [
        call("create_new_file", { filepath: `src/f${i}.js` }),
        failedTest(),
      ]).flat(),
    );
    messenger.llmStreamChat = replies("I will look again.", "Still failing.");

    await (store.dispatch as any)(streamNormalInput({}));

    const notes = autoPrompts(store).filter((p) =>
      p.startsWith(SAME_FAILURE_MARKER),
    );
    expect(notes).toHaveLength(1);
    expect(toolsSent(messenger).length).toBeGreaterThan(0);
    expect(session(store).toolBudgetPausedAfter).toBeUndefined();
  });
});

describe("the gates at the end of a turn", () => {
  it("run in order, each once, when the model answers in words", async () => {
    const { store, messenger } = storeWith([
      call("update_todo_list", {
        todos: [
          { content: "api", status: "completed" },
          { content: "deploy", status: "pending" },
        ],
      }),
      call("create_new_file", { filepath: "src/api.js" }),
    ]);
    messenger.llmStreamChat = replies(
      "Done.",
      "Deploy cannot be done: no credentials.",
      "No check applies to this file.",
      "unexpected extra round",
    );

    await (store.dispatch as any)(streamNormalInput({}));

    const prompts = autoPrompts(store);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].startsWith(TODO_GATE_MARKER)).toBe(true);
    expect(prompts[1].startsWith(VERIFICATION_GATE_MARKER)).toBe(true);
    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(3);
    // The work ended; it did not pause as "no progress".
    expect(session(store).toolBudgetPausedAfter).toBeUndefined();
    expect(session(store).isStreaming).toBe(false);
  });
});
