import { describe, expect, it } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { runPanelCommand } from "./panelCommands";

function storeWithHistory() {
  const root = getEmptyRootState();
  const item = (role: string, text: string) => ({
    message: { role, content: text, id: `${role}-${text}` },
    contextItems: [],
  });
  return createMockStore({
    session: {
      ...root.session,
      id: "s1",
      history: [item("user", "hi"), item("assistant", "hello")] as any,
    },
  });
}

describe("review fixes: panel commands", () => {
  it("/permissions rejects Object.prototype names instead of storing them", async () => {
    const store = storeWithHistory();
    for (const arg of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      await (store.dispatch as any)(
        runPanelCommand({
          command: { name: "permissions", arg },
          modifiers: {} as any,
        }),
      );
    }
    expect(["ask", "edits", "auto", "full", undefined]).toContain(
      (store.getState() as any).ui.permissionMode,
    );
  });

  it("/compact brings the saved summary into the open chat", async () => {
    const store = storeWithHistory();
    const summarized = {
      sessionId: "s1",
      title: "t",
      workspaceDirectory: "",
      history: [
        {
          message: { role: "user", content: "hi", id: "user-hi" },
          contextItems: [],
        },
        {
          message: {
            role: "assistant",
            content: "hello",
            id: "assistant-hello",
          },
          contextItems: [],
          conversationSummary: "SUMMARY",
        },
      ],
    };
    store.mockIdeMessenger.responseHandlers["conversation/compact"] =
      async () => undefined;
    store.mockIdeMessenger.responseHandlers["history/load"] = async () =>
      summarized as any;
    await (store.dispatch as any)(
      runPanelCommand({
        command: { name: "compact", arg: "" },
        modifiers: {} as any,
      }),
    );
    const history = (store.getState() as any).session.history;
    expect(history[1].conversationSummary).toBe("SUMMARY");
  });
});
