import { AssistantChatMessage, PromptLog } from "core";
import { serializeTool } from "core/tools";
import { runTerminalCommandTool } from "core/tools/definitions";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
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

/** A turn that already edited src/auth.ts in an earlier round. */
function storeAfterEdit(mode: "agent" | "chat" = "agent") {
  const state = getRootStateWithClaude();
  state.session.mode = mode;
  state.session.isStreaming = true;
  state.config.config.tools = [terminalTool];
  state.session.history = [
    {
      message: { id: "u1", role: "user", content: "fix the login bug" },
      contextItems: [],
    },
    {
      message: { id: "a1", role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "e1",
          status: "done",
          parsedArgs: { filepath: "src/auth.ts" },
          toolCall: {
            id: "e1",
            type: "function",
            function: { name: "single_find_and_replace", arguments: "{}" },
          },
        },
      ],
    },
    {
      message: { id: "t1", role: "tool", content: "edited", toolCallId: "e1" },
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
  messenger.responseHandlers["workspace/getVerificationPlan"] = async () => [
    {
      id: "c1",
      rootId: "r1",
      rootName: "app",
      kind: "test",
      command: "npm test",
      source: "package.json",
      confidence: "high",
      requiresApproval: true,
    },
  ];
  return { store, messenger };
}

function autoPrompts(store: ReturnType<typeof createMockStore>) {
  return (store.getState() as RootState).session.history.filter(
    (item) => item.isAutoPrompt,
  );
}

describe("verification gate", () => {
  it("asks once for a check when an agent turn ends with unverified edits", async () => {
    const { store, messenger } = storeAfterEdit();
    messenger.llmStreamChat = replies(
      "Fixed the bug.",
      "No test covers auth yet; manual check only.",
    );

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(2);
    const gates = autoPrompts(store);
    expect(gates).toHaveLength(1);
    const text = gates[0].message.content as string;
    expect(text.startsWith(VERIFICATION_GATE_MARKER)).toBe(true);
    expect(text).toContain("src/auth.ts");
    expect(text).toContain("`npm test`");
    expect((store.getState() as RootState).session.isStreaming).toBe(false);
  });

  it("does not gate outside agent mode", async () => {
    const { store, messenger } = storeAfterEdit("chat");
    messenger.llmStreamChat = replies("Here is the fix.");

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(1);
    expect(autoPrompts(store)).toHaveLength(0);
  });
});
