import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import { TaskCreditHint } from "./TaskCreditHint";

function messengerWith(content: unknown) {
  const messenger = new MockIdeMessenger();
  messenger.responses["vynor/usage"] = content as any;
  return messenger;
}

describe("TaskCreditHint", () => {
  it("shows the user's own median once there is history", async () => {
    await renderWithProviders(<TaskCreditHint />, {
      mockIdeMessenger: messengerWith({
        used: 100,
        limit: 1000,
        taskCredits: { median: 1800, p90: 9000 },
      }),
    });
    await waitFor(() =>
      expect(screen.getByTestId("task-credit-hint")).toBeTruthy(),
    );
    expect(screen.queryByTestId("task-credit-hint-estimate")).toBeNull();
  });

  it("shows a labelled estimate for a signed-in user with no history", async () => {
    await renderWithProviders(<TaskCreditHint />, {
      mockIdeMessenger: messengerWith({
        used: 0,
        limit: 1000,
        taskCredits: null,
      }),
    });
    await waitFor(() =>
      expect(screen.getByTestId("task-credit-hint-estimate")).toBeTruthy(),
    );
    expect(screen.getByTestId("task-credit-hint-estimate").textContent).toMatch(
      /small task/,
    );
  });

  it("shows nothing when signed out", async () => {
    await renderWithProviders(<TaskCreditHint />, {
      mockIdeMessenger: messengerWith(null),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("task-credit-hint")).toBeNull();
    expect(screen.queryByTestId("task-credit-hint-estimate")).toBeNull();
  });
});
