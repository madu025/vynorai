import { describe, expect, it } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { cancelStream } from "./cancelStream";

// Stop ends the current turn. It must not reach cloud background agents or
// commands the user already moved to the background: those are separate jobs.
describe("Stop (cancelStream)", () => {
  it("cancels this turn's task and subagents and touches nothing else", async () => {
    const root = getEmptyRootState();
    const store = createMockStore({
      session: {
        ...root.session,
        isStreaming: true,
        activeTaskId: "task-1",
        history: [
          {
            message: { role: "user", content: "go", id: "u1" },
            contextItems: [],
          },
        ] as any,
      },
    });

    const posted: string[] = [];
    const requested: string[] = [];
    store.mockIdeMessenger.post = ((type: string) => {
      posted.push(type);
    }) as any;
    store.mockIdeMessenger.responseHandlers["agent/task/cancel"] =
      (async () => ({ state: "canceled" })) as any;
    // any other request goes through the real mock and is recorded here
    const originalRequest = store.mockIdeMessenger.request.bind(
      store.mockIdeMessenger,
    );
    store.mockIdeMessenger.request = (async (type: string, data: any) => {
      requested.push(type);
      return originalRequest(type as any, data);
    }) as any;

    await (store.dispatch as any)(cancelStream());

    expect(requested).toEqual(["agent/task/cancel"]);
    expect(posted).toEqual(["tools/abort"]);
    expect(
      [...requested, ...posted].some((type) => type.startsWith("background")),
    ).toBe(false);
    expect((store.getState() as any).session.isStreaming).toBe(false);
  });
});
