import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import ContextStatus from "./ContextStatus";

function storeWith(contextPercentage: number | undefined, isPruned = false) {
  const root = createMockStore().getState() as any;
  return createMockStore({
    session: {
      ...root.session,
      contextPercentage,
      isPruned,
      history: [
        {
          message: { id: "u1", role: "user", content: "hi" },
          contextItems: [],
        },
      ],
    },
  });
}

describe("ContextStatus", () => {
  it("is hidden while there is plenty of room", () => {
    render(
      <Provider store={storeWith(0.3)}>
        <ContextStatus />
      </Provider>,
    );
    expect(screen.queryByTestId("context-percent")).toBeNull();
  });

  it("shows the number once the context is 60% full, so the user sees compaction coming", () => {
    render(
      <Provider store={storeWith(0.75)}>
        <ContextStatus />
      </Provider>,
    );
    expect(screen.getByTestId("context-percent").textContent).toBe("75%");
  });
});
