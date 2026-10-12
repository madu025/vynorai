import { AssistantChatMessage, PromptLog } from "core";
import { serializeTool } from "core/tools";
import { runTerminalCommandTool } from "core/tools/definitions";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
import { streamNormalInput } from "./streamNormalInput";

function reply(text: string) {
  return vi.fn().mockImplementation(() =>
    (async function* (): AsyncGenerator<AssistantChatMessage[], PromptLog> {
      yield [{ role: "assistant", content: text }];
      return {
        prompt: "p",
        completion: text,
        modelTitle: "Claude",
        modelProvider: "anthropic",
      };
    })(),
  );
}

function storeMidTask(cap: number, creditsUsedNow: number | null) {
  const state = getRootStateWithClaude();
  state.session.mode = "agent";
  state.session.isStreaming = true;
  state.config.config.tools = [serializeTool(runTerminalCommandTool)];
  state.session.turnCredits = { start: 1_000, used: 0 };
  state.ui.taskCreditCap = cap;
  state.session.history = [
    {
      message: { id: "u1", role: "user", content: "refactor billing" },
      contextItems: [],
    },
  ] as any;
  const store = createMockStore(state);
  const messenger = store.mockIdeMessenger;
  messenger.responses["llm/compileChat"] = {
    compiledChatMessages: [],
    didPrune: false,
    contextPercentage: 0.1,
  };
  messenger.responseHandlers["vynor/usage"] = async () =>
    creditsUsedNow === null
      ? null
      : { used: creditsUsedNow, limit: 8_000_000, plan: "starter" };
  messenger.llmStreamChat = reply("Done so far: models split. Left: 1. tests");
  return { store, messenger };
}

describe("task credit cap", () => {
  it("pauses the task with a summary once the prompt passes the cap", async () => {
    const { store, messenger } = storeMidTask(50_000, 61_000);
    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));
    const session = (store.getState() as RootState).session;
    expect(session.turnCredits?.used).toBe(60_000);
    expect(session.toolBudgetPausedAfter).toBe(1);
    expect(session.toolBudgetPauseReason).toBe("credits");
    // The capped round keeps its tools and system message (prompt cache, and
    // a request without tools made the model say its tools were switched
    // off); the pause is told as the last message instead.
    const options = (messenger.llmStreamChat as any).mock.calls[0][0];
    expect(options.completionOptions.tools).toHaveLength(1);
    const told = session.history.filter(
      (item) =>
        item.isAutoPrompt &&
        String(item.message.content).startsWith("[paused]"),
    );
    expect(told).toHaveLength(1);
    expect(String(told[0].message.content)).toContain("TASK CREDIT LIMIT");
  });

  it("never runs a tool the model calls on the paused round", async () => {
    const { store, messenger } = storeMidTask(50_000, 61_000);
    const toolCall = {
      id: "c1",
      type: "function" as const,
      function: {
        name: "run_terminal_command",
        arguments: JSON.stringify({ command: "npm test" }),
      },
    };
    messenger.llmStreamChat = vi.fn().mockImplementation(() =>
      (async function* (): AsyncGenerator<AssistantChatMessage[], PromptLog> {
        yield [{ role: "assistant", content: "", toolCalls: [toolCall] }];
        return {
          prompt: "p",
          completion: "",
          modelTitle: "Claude",
          modelProvider: "anthropic",
        };
      })(),
    );
    const ran = vi.fn(async () => ({ contextItems: [] }));
    messenger.responseHandlers["tools/call"] = ran as any;

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    const session = (store.getState() as RootState).session;
    expect(ran).not.toHaveBeenCalled();
    // One more round for the report, then the turn ends: no loop.
    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(2);
    expect(session.toolBudgetPauseReason).toBe("credits");
    expect(session.isStreaming).toBe(false);
    // Told once, and every refused call has a result, so "Continue" sends a
    // valid history.
    expect(
      session.history.filter((item) =>
        String(item.message.content).startsWith("[paused]"),
      ),
    ).toHaveLength(1);
    const calls = session.history.flatMap((item) => item.toolCallStates ?? []);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.status === "errored")).toBe(true);
    expect(
      session.history.filter((item) => item.message.role === "tool"),
    ).toHaveLength(2);
  });

  it("keeps going under the cap, with no cap, and for non-VynorAI models", async () => {
    for (const [cap, used] of [
      [50_000, 20_000],
      [0, 900_000],
      [50_000, null],
    ] as const) {
      const { store } = storeMidTask(cap, used);
      await (store.dispatch as any)(streamNormalInput({ depth: 1 }));
      expect(
        (store.getState() as RootState).session.toolBudgetPausedAfter,
      ).toBeUndefined();
    }
  });
});
