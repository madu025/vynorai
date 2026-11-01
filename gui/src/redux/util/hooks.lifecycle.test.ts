import { describe, expect, it } from "vitest";
import {
  runNotificationHook,
  runPreCompactHook,
  runSessionStartHook,
} from "./hooks";

function messenger(calls: any[], content: any) {
  return {
    request: async (_t: string, payload: any) => {
      calls.push(payload);
      return { status: "success", content };
    },
    ide: { showToast: async () => undefined },
  } as any;
}

describe("lifecycle hook helpers", () => {
  it("SessionStart returns hook stdout as context and sends the session id", async () => {
    const calls: any[] = [];
    const m = messenger(calls, {
      blocked: false,
      warnings: [],
      ran: 1,
      context: "hi",
    });
    expect(await runSessionStartHook(m, "s7")).toBe("hi");
    expect(calls[0]).toEqual({ event: "SessionStart", sessionId: "s7" });
  });

  it("Notification sends the message and kind and never throws", async () => {
    const calls: any[] = [];
    const m = messenger(calls, { blocked: true, warnings: [], ran: 1 });
    await runNotificationHook(m, "s1", "approval_required", "Approve edit?");
    expect(calls[0]).toEqual({
      event: "Notification",
      sessionId: "s1",
      kind: "approval_required",
      message: "Approve edit?",
    });
    const broken = {
      request: async () => {
        throw new Error("down");
      },
      ide: { showToast: async () => undefined },
    } as any;
    await expect(
      runNotificationHook(broken, "s1", "agent_paused", "x"),
    ).resolves.toBeUndefined();
  });

  it("PreCompact sends the trigger and optional instructions", async () => {
    const calls: any[] = [];
    const m = messenger(calls, { blocked: true, warnings: [], ran: 1 });
    await runPreCompactHook(m, "s1", "auto");
    await runPreCompactHook(m, "s1", "manual", "keep API notes");
    expect(calls[0]).toEqual({
      event: "PreCompact",
      sessionId: "s1",
      trigger: "auto",
    });
    expect(calls[1]).toMatchObject({
      trigger: "manual",
      instructions: "keep API notes",
    });
  });
});
