import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateLocalStorage } from "./migrateLocalStorage";

describe("migrateLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not crash startup when persisted Redux state is malformed", () => {
    localStorage.setItem("persist:root", "{not-json");
    expect(() => migrateLocalStorage(vi.fn() as any)).not.toThrow();
  });

  it("ignores a malformed nested UI state", () => {
    localStorage.setItem("persist:root", JSON.stringify({ ui: "{not-json" }));
    expect(() => migrateLocalStorage(vi.fn() as any)).not.toThrow();
  });
});
