import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";

import {
  alreadyRecovered,
  isTransientStreamError,
  partialReply,
  streamRecoveryPrompt,
} from "./streamRecovery";
import { unverifiedEdits } from "./verificationGate";

const msg = (
  role: "user" | "assistant",
  content: string,
  isAutoPrompt = false,
): ChatHistoryItem =>
  ({
    message: { id: Math.random().toString(), role, content },
    contextItems: [],
    isAutoPrompt,
  }) as ChatHistoryItem;

describe("stream recovery", () => {
  it("retries network failures but never a user abort", () => {
    expect(isTransientStreamError(new Error("Premature close"))).toBe(true);
    expect(isTransientStreamError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientStreamError(new Error("HTTP 504 Gateway Timeout"))).toBe(
      true,
    );
    expect(isTransientStreamError(new Error("fetch failed"))).toBe(true);
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(isTransientStreamError(abort)).toBe(false);
    expect(isTransientStreamError(new Error("HTTP 403 quota exceeded"))).toBe(
      false,
    );
    expect(isTransientStreamError("oops")).toBe(false);
  });

  it("continues only once per prompt and keeps the partial reply", () => {
    const history = [
      msg("user", "build it"),
      msg("assistant", "Step 1: create"),
    ];
    expect(alreadyRecovered(history)).toBe(false);
    expect(partialReply(history)).toBe("Step 1: create");
    const after = [
      ...history,
      msg("user", streamRecoveryPrompt(true), true),
      msg("assistant", ""),
    ];
    expect(alreadyRecovered(after)).toBe(true);
    expect(streamRecoveryPrompt(false)).toMatch(/before you replied/);
  });

  it("does not let a recovery prompt switch off the verification gate", () => {
    const edit = {
      ...msg("assistant", ""),
      toolCallStates: [
        {
          status: "done",
          toolCall: { function: { name: "multi_edit" } },
          parsedArgs: { filepath: "a.ts" },
        },
      ],
    } as unknown as ChatHistoryItem;
    const history = [
      msg("user", "fix a.ts"),
      edit,
      msg("user", streamRecoveryPrompt(true), true),
      msg("assistant", "done"),
    ];
    expect(unverifiedEdits(history)).toEqual({ files: ["a.ts"] });
  });
});
