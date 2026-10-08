import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { APPROVE_PLAN_PROMPT, PlanApprovalBanner } from "./PlanApprovalBanner";

const LONG_PLAN =
  "Plan:\n1. Extract token parsing into auth/token.ts\n2. Update the three callers in api/\n3. Add unit tests for expiry and refresh\n4. Run tsc and the auth test suite\nRisks: session cookies keep the old format until the next login, so keep a fallback parser for one release.";

function storeWith(opts: {
  mode: string;
  isStreaming?: boolean;
  last?: { role: "user" | "assistant"; content: string };
}) {
  const root = createMockStore().getState() as any;
  const history = opts.last
    ? [
        {
          message: { id: "u1", role: "user", content: "refactor auth" },
          contextItems: [],
        },
        {
          message: {
            id: "m2",
            role: opts.last.role,
            content: opts.last.content,
          },
          contextItems: [],
        },
      ]
    : [];
  return createMockStore({
    ...root,
    session: {
      ...root.session,
      mode: opts.mode,
      isStreaming: opts.isStreaming ?? false,
      history,
    },
  });
}

function renderBanner(store: ReturnType<typeof createMockStore>) {
  const onApprove = vi.fn();
  render(
    <Provider store={store}>
      <PlanApprovalBanner onApprove={onApprove} />
    </Provider>,
  );
  return onApprove;
}

describe("PlanApprovalBanner", () => {
  it("is hidden outside plan mode", () => {
    for (const mode of ["chat", "agent", "background"]) {
      renderBanner(
        storeWith({ mode, last: { role: "assistant", content: LONG_PLAN } }),
      );
      expect(screen.queryByTestId("plan-approval-banner")).toBeNull();
    }
  });

  it("is hidden while streaming, with no reply yet, or after a short clarifying question", () => {
    renderBanner(
      storeWith({
        mode: "plan",
        isStreaming: true,
        last: { role: "assistant", content: LONG_PLAN },
      }),
    );
    expect(screen.queryByTestId("plan-approval-banner")).toBeNull();

    renderBanner(storeWith({ mode: "plan" }));
    expect(screen.queryByTestId("plan-approval-banner")).toBeNull();

    renderBanner(
      storeWith({
        mode: "plan",
        last: { role: "assistant", content: "Which database do you use?" },
      }),
    );
    expect(screen.queryByTestId("plan-approval-banner")).toBeNull();

    renderBanner(
      storeWith({ mode: "plan", last: { role: "user", content: LONG_PLAN } }),
    );
    expect(screen.queryByTestId("plan-approval-banner")).toBeNull();
  });

  it("shows after a finished plan and executes nothing until approved", () => {
    const store = storeWith({
      mode: "plan",
      last: { role: "assistant", content: LONG_PLAN },
    });
    const onApprove = renderBanner(store);

    expect(screen.getByTestId("plan-approval-banner")).toBeTruthy();
    expect(onApprove).not.toHaveBeenCalled();
    expect((store.getState() as any).session.mode).toBe("plan");
  });

  it("approving switches to agent mode and sends the go-ahead prompt", () => {
    const store = storeWith({
      mode: "plan",
      last: { role: "assistant", content: LONG_PLAN },
    });
    const onApprove = renderBanner(store);

    fireEvent.click(screen.getByTestId("plan-approve-button"));

    expect((store.getState() as any).session.mode).toBe("agent");
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove.mock.calls[0][0].content[0].content[0].text).toBe(
      APPROVE_PLAN_PROMPT,
    );
  });
});
