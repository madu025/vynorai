import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
