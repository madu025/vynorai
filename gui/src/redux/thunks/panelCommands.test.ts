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

describe("runPanelCommand", () => {
  it("/plan switches to plan mode without sending anything", async () => {
    const store = storeWithHistory();
    await (store.dispatch as any)(
      runPanelCommand({
        command: { name: "plan", arg: "" },
        modifiers: {} as any,
      }),
    );
    expect((store.getState() as any).session.mode).toBe("plan");
    expect((store.getState() as any).session.history).toHaveLength(2);
  });

  it("/compact compacts up to the last message and passes the focus text", async () => {
    const store = storeWithHistory();
    const requests: any[] = [];
    store.mockIdeMessenger.responseHandlers["conversation/compact"] = async (
      data: any,
    ) => {
      requests.push(data);
      return undefined;
    };
    await (store.dispatch as any)(
      runPanelCommand({
        command: { name: "compact", arg: "the auth bug" },
        modifiers: {} as any,
      }),
    );
    expect(requests).toEqual([
      { index: 1, sessionId: "s1", instructions: "the auth bug" },
    ]);
  });

  it("/clear opens a new empty session", async () => {
    const store = storeWithHistory();
    await (store.dispatch as any)(
      runPanelCommand({
        command: { name: "clear", arg: "" },
        modifiers: {} as any,
      }),
    );
    expect((store.getState() as any).session.history).toHaveLength(0);
  });
});
