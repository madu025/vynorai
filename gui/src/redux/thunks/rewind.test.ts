import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { rewindToUserMessage, taskIdsFrom } from "./rewind";

function item(role: string, text: string, taskId?: string): ChatHistoryItem {
  return {
    message: { role, content: text, id: `${role}-${text}` } as any,
    contextItems: [],
    ...(taskId ? { taskId } : {}),
  };
}

const history = [
  item("user", "add login", "task-1"),
  item("assistant", "done"),
  item("user", "add tests", "task-2"),
  item("assistant", "done"),
  item("user", "fix lint", "task-3"),
  item("assistant", "done"),
];

function storeWith(h: ChatHistoryItem[], isStreaming = false) {
  const root = getEmptyRootState();
  // Test items carry message ids; the cast only satisfies the stricter session type.
  return createMockStore({
    session: { ...root.session, history: h as any, isStreaming, id: "s1" },
  });
}

describe("taskIdsFrom", () => {
  it("collects the prompt's task and every later one, in order", () => {
    expect(taskIdsFrom(history, 2)).toEqual(["task-2", "task-3"]);
    expect(taskIdsFrom(history, 4)).toEqual(["task-3"]);
  });
});

describe("rewindToUserMessage", () => {
  it("restores files for this and later prompts, then truncates and refills the input", async () => {
    const store = storeWith(history);
    const calls: any[] = [];
    store.mockIdeMessenger.responseHandlers["checkpoints/restoreTasks"] =
      async (data: any) => {
        calls.push(data);
        return { restored: true, restoredFiles: 3 };
      };

    const result = await (store.dispatch as any)(
      rewindToUserMessage({ index: 2 }),
    );

    expect(calls).toEqual([{ taskIds: ["task-2", "task-3"] }]);
    expect(result.payload).toEqual({ rewound: true, restoredFiles: 3 });
    const state = store.getState() as any;
    expect(
      state.session.history.map((h: ChatHistoryItem) => h.message.content),
    ).toEqual(["add login", "done"]);
    expect(JSON.stringify(state.session.mainEditorContentTrigger)).toContain(
      "add tests",
    );
  });

  it("keeps the conversation when the user declines to overwrite newer changes", async () => {
    const store = storeWith(history);
    store.mockIdeMessenger.responseHandlers["checkpoints/restoreTasks"] =
      async () => ({
        restored: false,
        restoredFiles: 0,
        reason: "Task restore canceled to protect newer changes.",
      });

    const result = await (store.dispatch as any)(
      rewindToUserMessage({ index: 2 }),
    );

    expect(result.payload.rewound).toBe(false);
    expect((store.getState() as any).session.history).toHaveLength(6);
  });

  it("rewinds a prompt that changed no files", async () => {
    const store = storeWith(history);
    store.mockIdeMessenger.responseHandlers["checkpoints/restoreTasks"] =
      async () => ({
        restored: false,
        restoredFiles: 0,
        reason: "No checkpoints were recorded for this task.",
      });

    const result = await (store.dispatch as any)(
      rewindToUserMessage({ index: 4 }),
    );

    expect(result.payload).toEqual({ rewound: true, restoredFiles: 0 });
    expect((store.getState() as any).session.history).toHaveLength(4);
  });

  it("refuses while streaming or on a non-prompt item", async () => {
    expect(
      (
        await (storeWith(history, true).dispatch as any)(
          rewindToUserMessage({ index: 2 }),
        )
      ).payload.rewound,
    ).toBe(false);
    expect(
      (
        await (storeWith(history).dispatch as any)(
          rewindToUserMessage({ index: 1 }),
        )
      ).payload.rewound,
    ).toBe(false);
  });
});
