import { describe, expect, it } from "vitest";

import { creditCapReached, formatCredits } from "./turnCredits";

describe("turn credits", () => {
  it("formats credit counts compactly", () => {
    expect(formatCredits(950)).toBe("950");
    expect(formatCredits(1234)).toBe("1.2K");
    expect(formatCredits(12_400)).toBe("12K");
    expect(formatCredits(2_300_000)).toBe("2.3M");
  });

  it("only stops a task when a cap is set and reached", () => {
    expect(creditCapReached(10_000, undefined)).toBe(false);
    expect(creditCapReached(10_000, 0)).toBe(false);
    expect(creditCapReached(49_999, 50_000)).toBe(false);
    expect(creditCapReached(50_000, 50_000)).toBe(true);
  });
});
