import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { isNewer } from "./selfUpdate";

describe("isNewer", () => {
  it("compares x.y.z numerically", () => {
    expect(isNewer("1.2.15", "1.2.14")).toBe(true);
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("1.2.14", "1.2.14")).toBe(false);
    expect(isNewer("1.2.9", "1.2.14")).toBe(false);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });
});
