import { describe, expect, it } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { deleteSession, syncHistoryAccount } from "./session";

function storeWithTabs(
  sessionId: string,
  historyAccount: string | null = "acct-a",
) {
  const base = createMockStore().getState() as any;
  return createMockStore({
    ...base,
    ui: { ...base.ui, historyAccount },
    session: {
      ...base.session,
      id: sessionId,
      history: [
        { message: { id: "u", role: "user", content: "hi" }, contextItems: [] },
      ],
    },
    tabs: {
      tabs: [
        { id: "t1", title: "Payments", isActive: false, sessionId: "s-old" },
        { id: "t2", title: "Auth", isActive: true, sessionId },
      ],
    },
  });
}

describe("syncHistoryAccount", () => {
  it("closes the previous account's tabs and chat when the account changes", async () => {
    const store = storeWithTabs("s-open");
    await (store.dispatch as any)(syncHistoryAccount("acct-b"));
    const state = store.getState() as any;
    expect(state.ui.historyAccount).toBe("acct-b");
    expect(state.tabs.tabs).toHaveLength(1);
    expect(state.tabs.tabs[0].sessionId).toBeUndefined();
    expect(state.session.history).toEqual([]);
  });

  it("keeps tabs when the same account comes back (e.g. editor restart)", async () => {
    const store = storeWithTabs("s-open", "acct-a");
    await (store.dispatch as any)(syncHistoryAccount("acct-a"));
    expect((store.getState() as any).tabs.tabs).toHaveLength(2);
  });

  it("does nothing while the login is still being checked", async () => {
    const store = storeWithTabs("s-open", "acct-a");
    await (store.dispatch as any)(syncHistoryAccount("pending"));
    const state = store.getState() as any;
    expect(state.ui.historyAccount).toBe("acct-a");
    expect(state.tabs.tabs).toHaveLength(2);
  });

  it("signing out hides the open chat", async () => {
    const store = storeWithTabs("s-open", "acct-a");
    await (store.dispatch as any)(syncHistoryAccount(null));
    expect((store.getState() as any).session.history).toEqual([]);
  });
});

describe("deleteSession", () => {
  it("closes tabs showing the deleted chat so it cannot be saved back", async () => {
    const store = storeWithTabs("s-open");
    await (store.dispatch as any)(deleteSession("s-old"));
    const tabs = (store.getState() as any).tabs.tabs;
    expect(tabs.map((t: any) => t.sessionId)).toEqual(["s-open"]);
    expect(tabs[0].isActive).toBe(true);
  });

  it("deleting the open chat starts a new one instead of reloading it", async () => {
    const store = storeWithTabs("s-open");
    await (store.dispatch as any)(deleteSession("s-open"));
    const state = store.getState() as any;
    expect(state.session.id).not.toBe("s-open");
    expect(state.session.history).toEqual([]);
    expect(state.tabs.tabs.map((t: any) => t.sessionId)).toEqual(["s-old"]);
  });
});
