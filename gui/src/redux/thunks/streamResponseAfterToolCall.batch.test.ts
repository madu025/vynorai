import { describe, expect, it } from "vitest";
import { areAllToolsDoneStreaming } from "./streamResponseAfterToolCall";

const msg = (...statuses: string[]) =>
  ({
    message: { role: "assistant", content: "" },
    toolCallStates: statuses.map((status, i) => ({
      toolCallId: `t${i}`,
      status,
    })),
  }) as any;

describe("areAllToolsDoneStreaming", () => {
  it("waits while any call is still pending or running", () => {
    expect(areAllToolsDoneStreaming(msg("done", "calling"), false)).toBe(false);
    expect(areAllToolsDoneStreaming(msg("done", "generated"), false)).toBe(
      false,
    );
  });

  it("continues once when some calls ran and another was rejected", () => {
    expect(areAllToolsDoneStreaming(msg("done", "canceled"), false)).toBe(true);
  });

  it("stops when every call was rejected, unless configured to continue", () => {
    expect(areAllToolsDoneStreaming(msg("canceled", "canceled"), false)).toBe(
      false,
    );
    expect(areAllToolsDoneStreaming(msg("canceled"), true)).toBe(true);
  });
});
