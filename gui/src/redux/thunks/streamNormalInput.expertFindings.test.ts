import { AssistantChatMessage, PromptLog } from "core";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import {
  getRootStateWithClaude,
  mockClaudeModel,
} from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
import { streamNormalInput } from "./streamNormalInput";

const FINDINGS = "\n\nEXPERT FINDINGS\n- security: hash the passwords";

vi.mock("../../util/subagentOrchestrator", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  runExpertCouncil: vi.fn(async () => ({ tasks: [], findings: [] })),
  formatSubagentFindings: () => FINDINGS,
}));

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

describe("the expert council's findings", () => {
  it("stay in the system message on every round of the prompt", async () => {
    const state = getRootStateWithClaude();
    state.session.mode = "agent";
    state.session.isStreaming = true;
    state.session.expertTeamEnabled = true;
    state.session.expertCouncilDepth = "smart";
    state.config.config.selectedModelByRole.subagent = mockClaudeModel;
    state.session.history = [
      {
        message: { id: "u1", role: "user", content: "add a login form" },
        contextItems: [],
      },
    ] as any;
    const store = createMockStore(state);
    const messenger = store.mockIdeMessenger;
    const systemMessages: unknown[] = [];
    messenger.responseHandlers["llm/compileChat"] = async (data) => {
      systemMessages.push(
        data.messages.find((message) => message.role === "system")?.content,
      );
      return {
        compiledChatMessages: [],
        didPrune: false,
        contextPercentage: 0.1,
      };
    };
    // An empty first answer sends the model back for a second round.
    messenger.llmStreamChat = replies("", "The form is added.");

    await (store.dispatch as any)(streamNormalInput({}));

    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0]).toContain(FINDINGS);
    // The findings were filled on the first round only: from the second
    // round on the system message was another one, and the model had lost
    // what the council found.
    expect(systemMessages[1]).toBe(systemMessages[0]);
    expect((store.getState() as RootState).session.isStreaming).toBe(false);
  });
});
