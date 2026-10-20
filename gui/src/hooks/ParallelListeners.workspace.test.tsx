import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MockIdeMessenger } from "../context/MockIdeMessenger";
import { renderWithProviders } from "../util/test/render";

describe("ParallelListeners workspace snapshot", () => {
  it("retries the first workspace snapshot when it gets no answer", async () => {
    const messenger = new MockIdeMessenger();
    const snapshot = messenger.responses["workspace/getSnapshot"]!;
    let calls = 0;
    messenger.responseHandlers["workspace/getSnapshot"] = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("workspace/getSnapshot timed out after 25000ms");
      }
      return snapshot;
    };

    const { store } = await renderWithProviders(<div />, {
      mockIdeMessenger: messenger,
    });

    await waitFor(
      () => expect(store.getState().workspace.snapshot?.id).toBe(snapshot.id),
      { timeout: 5_000 },
    );
    expect(store.getState().workspace.loading).toBe(false);
    expect(store.getState().workspace.error).toBeUndefined();
    expect(calls).toBe(2);
  });
});
