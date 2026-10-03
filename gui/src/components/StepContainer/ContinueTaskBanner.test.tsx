import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";
import { setToolBudgetPausedAfter } from "../../redux/slices/sessionSlice";
import { createMockStore } from "../../util/test/mockStore";
import {
  CONTINUE_TASK_PROMPT,
  toolRoundBudget,
} from "../../redux/util/toolRoundBudget";
import { ContinueTaskBanner } from "./ContinueTaskBanner";

function renderBanner(store: ReturnType<typeof createMockStore>) {
  const onContinue = vi.fn();
  render(
    <Provider store={store}>
      <ContinueTaskBanner onContinue={onContinue} />
    </Provider>,
  );
  return onContinue;
}

describe("ContinueTaskBanner", () => {
  it("is hidden until a turn pauses at its budget", () => {
    renderBanner(createMockStore());
    expect(screen.queryByTestId("continue-task-banner")).toBeNull();
  });

  it("continues with the continue prompt", () => {
    const store = createMockStore();
    store.dispatch(setToolBudgetPausedAfter(40));
    const onContinue = renderBanner(store);

    expect(screen.getByText(/Paused after 40 steps/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("continue-task-button"));

    const editorState = onContinue.mock.calls[0][0];
    expect(editorState.content[0].content[0].text).toBe(CONTINUE_TASK_PROMPT);
  });
});

describe("toolRoundBudget", () => {
  it("gives agent mode the largest budget", () => {
    expect(toolRoundBudget("agent")).toBeGreaterThan(toolRoundBudget("plan"));
    expect(toolRoundBudget("plan")).toBeGreaterThan(toolRoundBudget("chat"));
    expect(toolRoundBudget("background")).toBe(toolRoundBudget("agent"));
  });
});
