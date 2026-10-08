import { describe, expect, it, vi } from "vitest";

import { resolveActiveWorkspaceDir } from "./activeRoot";

const A = "file:///workspace/alpha";
const B = "file:///workspace/beta";

function ide(dirs: string[], currentPath?: string) {
  return {
    getWorkspaceDirs: vi.fn().mockResolvedValue(dirs),
    getCurrentFile: vi
      .fn()
      .mockResolvedValue(
        currentPath
          ? { isUntitled: false, path: currentPath, contents: "" }
          : undefined,
      ),
  };
}

describe("resolveActiveWorkspaceDir", () => {
  it("returns undefined when no folder is open", async () => {
    expect(await resolveActiveWorkspaceDir(ide([]))).toBeUndefined();
  });

  it("uses the only root", async () => {
    expect(await resolveActiveWorkspaceDir(ide([A]))).toBe(A);
  });

  it("prefers a pinned root that is still open", async () => {
    const i = ide([A, B], `${A}/src/a.ts`);
    expect(await resolveActiveWorkspaceDir(i, B)).toBe(B);
  });

  it("ignores a pinned root that was closed", async () => {
    const i = ide([A, B], `${B}/src/b.ts`);
    expect(await resolveActiveWorkspaceDir(i, "file:///gone")).toBe(B);
  });

  it("uses the root that holds the open file", async () => {
    expect(await resolveActiveWorkspaceDir(ide([A, B], `${B}/x/y.ts`))).toBe(B);
  });

  it("falls back to the first root when nothing identifies one", async () => {
    expect(await resolveActiveWorkspaceDir(ide([A, B]))).toBe(A);
  });
});
