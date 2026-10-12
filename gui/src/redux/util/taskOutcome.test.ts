import { describe, expect, it, vi } from "vitest";
import { autoPromptCounts, reportTaskOutcome } from "./taskOutcome";

describe("autoPromptCounts", () => {
  const user = (content: string, isAutoPrompt = false) =>
    ({ message: { role: "user", content }, isAutoPrompt }) as any;
  const answer = { message: { role: "assistant", content: "ok" } } as any;

  it("counts repairs and gates of the current prompt only", () => {
    expect(
      autoPromptCounts([
        user("first"),
        user("[todo-gate] old", true),
        answer,
        user("build the shop"),
        answer,
        user("[verification-repair] fix", true),
        answer,
        user("[todo-gate] 2 open", true),
        answer,
        user("[stream-recovery] continue", true),
        answer,
        user("[verification-gate] run a check", true),
        answer,
      ]),
    ).toEqual({ repairs: 1, gates: 2 });
  });

  it("is zero when the agent was never sent back", () => {
    expect(autoPromptCounts([user("hi"), answer])).toEqual({
      repairs: 0,
      gates: 0,
    });
  });
});

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
      reason: undefined,
      repairs: undefined,
      gates: undefined,
    });
  });

  it("sends why a task paused and how often it was sent back", () => {
    const post = vi.fn();
    reportTaskOutcome({ post } as any, true, {
      outcome: "budget",
      reason: "same_failure",
      repairs: 2,
      gates: 3,
    });
    expect(post.mock.calls[0][1]).toMatchObject({
      outcome: "budget",
      reason: "same_failure",
      repairs: 2,
      gates: 3,
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
