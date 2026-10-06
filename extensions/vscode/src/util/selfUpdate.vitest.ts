import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { isNewer, isValidRelease } from "./selfUpdate";

describe("isNewer", () => {
  it("compares x.y.z numerically", () => {
    expect(isNewer("1.2.15", "1.2.14")).toBe(true);
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("1.2.14", "1.2.14")).toBe(false);
    expect(isNewer("1.2.9", "1.2.14")).toBe(false);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });
});

describe("isValidRelease", () => {
  const release = {
    version: "1.2.37",
    url: "https://vynor.lk/download/vynorai-1.2.37.vsix",
    sha256: "a".repeat(64),
    notes: "Workspace reliability fixes",
  };

  it("accepts a release whose URL, version, and checksum are bound together", () => {
    expect(isValidRelease(release)).toBe(true);
  });

  it("rejects malformed metadata and mismatched artifact versions", () => {
    expect(isValidRelease({ ...release, version: "latest" })).toBe(false);
    expect(
      isValidRelease({
        ...release,
        url: "https://vynor.lk/download/vynorai-1.2.36.vsix",
      }),
    ).toBe(false);
    expect(isValidRelease({ ...release, sha256: "not-a-sha" })).toBe(false);
  });
});
