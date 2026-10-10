import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { runPanelCommand } from "./panelCommands";
import { rewindToUserMessage } from "./rewind";

const item = (role: string, text: string, taskId?: string): ChatHistoryItem =>
  ({
    message: { role, content: text, id: `${role}-${text}` },
    contextItems: [],
    ...(taskId ? { taskId } : {}),
  }) as any;

const history = [
  item("user", "one", "t1"),
  item("assistant", "a1"),
  item("user", "two", "t2"),
  item("assistant", "a2"),
  item("user", "three", "t3"),
  item("assistant", "a3"),
];

function setup() {
  const root = getEmptyRootState();
  const store = createMockStore({
    session: { ...root.session, id: "s1", history: history as any },
  });
  const restored: string[][] = [];
  store.mockIdeMessenger.responseHandlers["checkpoints/restoreTasks"] = async (
    data: any,
  ) => {
    restored.push(data.taskIds);
    return { restored: true, restoredFiles: 2 };
  };
  const texts = () =>
    (store.getState() as any).session.history.map(
      (h: ChatHistoryItem) => h.message.content,
    );
  return { store, restored, texts };
}

describe("rewind modes", () => {
  it("code only: restores files and leaves the conversation alone", async () => {
    const { store, restored, texts } = setup();
    const result = await (store.dispatch as any)(
      rewindToUserMessage({ index: 2, mode: "code" }),
    );
    expect(result.payload).toEqual({ rewound: true, restoredFiles: 2 });
    expect(restored).toEqual([["t2", "t3"]]);
    expect(texts()).toHaveLength(6);
  });

  it("chat only: drops the turns and touches no files", async () => {
    const { store, restored, texts } = setup();
    await (store.dispatch as any)(
      rewindToUserMessage({ index: 2, mode: "chat" }),
    );
    expect(restored).toEqual([]);
    expect(texts()).toEqual(["one", "a1"]);
  });
});

describe("/rewind [n] [chat|code]", () => {
  const run = (store: any, arg: string) =>
    store.dispatch(
      runPanelCommand({
        command: { name: "rewind", arg },
        modifiers: {} as any,
      }),
    );

  it("with no argument undoes the last prompt", async () => {
    const { store, restored, texts } = setup();
    await run(store, "");
    expect(restored).toEqual([["t3"]]);
    expect(texts()).toEqual(["one", "a1", "two", "a2"]);
  });

  it("a number picks an earlier prompt (2 = the one before the last)", async () => {
    const { store, restored, texts } = setup();
    await run(store, "2");
    expect(restored).toEqual([["t2", "t3"]]);
    expect(texts()).toEqual(["one", "a1"]);
  });

  it("'code' keeps the chat and 'chat' keeps the files", async () => {
    const a = setup();
    await run(a.store, "code");
    expect(a.restored).toEqual([["t3"]]);
    expect(a.texts()).toHaveLength(6);

    const b = setup();
    await run(b.store, "2 chat");
    expect(b.restored).toEqual([]);
    expect(b.texts()).toEqual(["one", "a1"]);
  });

  it("says so when the chat has fewer prompts than asked for", async () => {
    const { store, texts } = setup();
    await run(store, "9");
    expect((store.getState() as any).ui.showDialog).toBe(true);
    expect(texts()).toHaveLength(6);
  });
});
