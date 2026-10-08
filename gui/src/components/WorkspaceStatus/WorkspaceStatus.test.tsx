import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceSnapshot } from "core/workspace/types";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import type { RootState } from "../../redux/store";
import { createMockStore } from "../../util/test/mockStore";
import { WorkspaceStatus } from "./WorkspaceStatus";

describe("WorkspaceStatus", () => {
  it("contains a workspace refresh transport failure", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responseHandlers["workspace/refreshSnapshot"] = async () => {
      throw new Error("extension host unavailable");
    };
    const store = createMockStore(
      {
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <WorkspaceStatus />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByTitle("Refresh workspace context"));

    await waitFor(() =>
      expect((store.getState() as RootState).workspace.error).toBe(
        "Could not refresh workspace state.",
      ),
    );
  });

  it("shows a root picker for multi-root workspaces and switches root", async () => {
    const messenger = new MockIdeMessenger();
    const base = messenger.responses["workspace/getSnapshot"];
    const multi = {
      ...base,
      roots: [
        { id: "r1", name: "alpha" },
        { id: "r2", name: "beta" },
      ],
      activeRootId: undefined,
    };
    let requested: unknown;
    messenger.responseHandlers["workspace/setActiveRoot"] = async (data) => {
      requested = data;
      return { ...multi, activeRootId: "r2" } as unknown as WorkspaceSnapshot;
    };
    const store = createMockStore(
      {
        workspace: {
          loading: false,
          snapshot: multi as unknown as WorkspaceSnapshot,
        },
      },
      messenger,
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <WorkspaceStatus />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    fireEvent.change(screen.getByLabelText("Active workspace root"), {
      target: { value: "r2" },
    });

    await waitFor(() =>
      expect(
        (store.getState() as RootState).workspace.snapshot?.activeRootId,
      ).toBe("r2"),
    );
    expect(requested).toEqual({ rootId: "r2" });
  });

  it("hides the root picker for a single root", () => {
    const messenger = new MockIdeMessenger();
    const store = createMockStore(
      {
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );
    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <WorkspaceStatus />
        </IdeMessengerContext.Provider>
      </Provider>,
    );
    expect(screen.queryByLabelText("Active workspace root")).toBeNull();
  });
});
