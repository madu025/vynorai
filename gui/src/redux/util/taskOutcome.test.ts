import { describe, expect, it, vi } from "vitest";
import { reportTaskOutcome } from "./taskOutcome";

describe("reportTaskOutcome", () => {
  it("sends nothing unless the user opted in", () => {
    const post = vi.fn();
    reportTaskOutcome({ post } as any, false, { outcome: "completed" });
    reportTaskOutcome({ post } as any, undefined, { outcome: "completed" });
    expect(post).not.toHaveBeenCalled();
  });

  it("sends counts and flags only", () => {
    const post = vi.fn();
    reportTaskOutcome({ post } as any, true, {
      outcome: "completed_unverified",
      mode: "agent",
      rounds: 6,
      credits: 12.6,
      edited: true,
      verified: false,
      prompt: "secret",
      filepath: "C:/x",
    } as any);
    expect(post).toHaveBeenCalledWith("vynor/taskOutcome", {
      outcome: "completed_unverified",
      mode: "agent",
      rounds: 6,
      credits: 13,
      edited: true,
      verified: false,
    });
  });

  it("never throws", () => {
    const post = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() =>
      reportTaskOutcome({ post } as any, true, { outcome: "stopped" }),
    ).not.toThrow();
  });
});
