import { describe, expect, it } from "vitest";
import { isQuotaState } from "./VynorQuotaBar";

describe("isQuotaState", () => {
  it("rejects incomplete cached data that would crash quota rendering", () => {
    expect(isQuotaState({})).toBe(false);
    expect(isQuotaState({ planName: "PRO", maxTokens: Number.NaN })).toBe(
      false,
    );
  });

  it("accepts a complete cached quota snapshot", () => {
    expect(
      isQuotaState({
        planName: "PRO",
        maxTokens: 100,
        usedTokens: 20,
        remainingTokens: 80,
        percentageUsed: 20,
        periodEnd: "2026-11-01",
        isLoggedIn: true,
        email: "",
      }),
    ).toBe(true);
  });
});
