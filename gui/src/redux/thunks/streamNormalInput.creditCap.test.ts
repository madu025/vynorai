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
    // The capped round runs without tools.
    const options = (messenger.llmStreamChat as any).mock.calls[0][0];
    expect(options.completionOptions.tools ?? []).toHaveLength(0);
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
