import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it } from "vitest";

import { IdeMessengerContext } from "../context/IdeMessenger";
import { MockIdeMessenger } from "../context/MockIdeMessenger";
import { createMockStore } from "../util/test/mockStore";
import ErrorPage from "./error";

describe("ErrorPage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps persisted session data and stores a redacted diagnostic", async () => {
    const messenger = new MockIdeMessenger();
    const store = createMockStore(undefined, messenger);
    window.localStorage.setItem("persist:root", "kept-session-state");
    window.localStorage.setItem("inputHistory_chat", "kept-input-history");
    const router = createMemoryRouter(
      [
        { path: "/", element: <p>Home</p> },
        {
          path: "/broken",
          loader: () => {
            throw new Error(
              "apiKey=sk-secret C:\\Users\\person\\project failed",
            );
          },
          element: <p>Broken</p>,
          errorElement: <ErrorPage />,
        },
      ],
      { initialEntries: ["/broken"] },
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <RouterProvider router={router} />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    expect(
      await screen.findByText("apiKey: [REDACTED] [LOCAL_PATH]", {
        selector: "code",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        window.localStorage.getItem("vynorai.runtimeDiagnostics.v1"),
      ).toContain("[REDACTED]"),
    );
    expect(window.localStorage.getItem("persist:root")).toBe(
      "kept-session-state",
    );
    expect(window.localStorage.getItem("inputHistory_chat")).toBe(
      "kept-input-history",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(window.localStorage.getItem("persist:root")).toBe(
      "kept-session-state",
    );
    expect(window.localStorage.getItem("inputHistory_chat")).toBe(
      "kept-input-history",
    );
  });
});
