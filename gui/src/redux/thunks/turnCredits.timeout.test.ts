import { describe, expect, it, vi } from "vitest";
import {
  USAGE_REQUEST_TIMEOUT_MS,
  fetchCreditShare,
  fetchCreditsUsed,
} from "./turnCredits";

/** A messenger whose request honours the timeout argument, like the real one. */
function silentMessenger() {
  const request = vi.fn(
    (_type: string, _data: unknown, timeoutMs?: number) =>
      new Promise((_, reject) => {
        if (timeoutMs)
          setTimeout(() => reject(new Error("timed out")), timeoutMs);
      }),
  );
  return { request, extra: { ideMessenger: { request } } as never };
}

describe("credit reads never wait forever", () => {
  it("fetchCreditsUsed gives up with null when core does not answer", async () => {
    vi.useFakeTimers();
    const { request, extra } = silentMessenger();
    const result = fetchCreditsUsed(extra);
    await vi.advanceTimersByTimeAsync(USAGE_REQUEST_TIMEOUT_MS + 10);
    await expect(result).resolves.toBeNull();
    expect(request).toHaveBeenCalledWith(
      "vynor/usage",
      undefined,
      USAGE_REQUEST_TIMEOUT_MS,
    );
    vi.useRealTimers();
  });

  it("fetchCreditShare gives up with null too", async () => {
    vi.useFakeTimers();
    const { extra } = silentMessenger();
    const result = fetchCreditShare(extra);
    await vi.advanceTimersByTimeAsync(USAGE_REQUEST_TIMEOUT_MS + 10);
    await expect(result).resolves.toBeNull();
    vi.useRealTimers();
  });
});
