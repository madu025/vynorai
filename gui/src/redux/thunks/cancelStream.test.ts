import { describe, expect, it, vi } from "vitest";

import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import type { RootState } from "../store";
import { cancelStream } from "./cancelStream";

describe("cancelStream", () => {
  it("resets a reloaded webview without canceling the persisted agent task", async () => {
    const initial = getEmptyRootState();
    const store = createMockStore({
      session: {
        ...initial.session,
        activeTaskId: "00000000-0000-4000-8000-000000000001",
        activeTaskState: "executing",
        isStreaming: true,
      },
    });
    const requestSpy = vi.spyOn(store.mockIdeMessenger, "request");

    await store.dispatch(cancelStream({ cancelTask: false }) as never);

    expect(requestSpy).not.toHaveBeenCalledWith(
      "agent/task/cancel",
      expect.anything(),
    );
    const finalState = store.getState() as RootState;
    expect(finalState.session.isStreaming).toBe(false);
    expect(finalState.session.activeTaskState).toBe("executing");
  });
});
