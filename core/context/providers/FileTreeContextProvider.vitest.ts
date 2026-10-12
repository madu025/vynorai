import { beforeEach, describe, expect, it, vi } from "vitest";
import { walkDir } from "../../indexing/walkDir";
import FileTreeContextProvider from "./FileTreeContextProvider";

vi.mock("../../indexing/walkDir", () => ({
  walkDir: vi.fn(),
}));

describe("FileTreeContextProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes the workspace root name in the model-visible tree", async () => {
    vi.mocked(walkDir).mockResolvedValue([
      "file:///workspace/VynorAI/package.json",
      "file:///workspace/VynorAI/src/index.ts",
    ]);
    const provider = new FileTreeContextProvider({});

    const items = await provider.getContextItems("", {
      ide: {
        getWorkspaceDirs: vi
          .fn()
          .mockResolvedValue(["file:///workspace/VynorAI"]),
      },
    } as any);

    expect(items[0].content).toContain("VynorAI/\n");
    expect(items[0].content).toContain("  package.json");
    expect(items[0].content).toContain("  src/\n    index.ts");
  });

  it("does not let an empty workspace read as a folder to write into", async () => {
    // Seen in a build: the tree was the single line "project/" and every
    // file went to "project/project/...".
    vi.mocked(walkDir).mockResolvedValue([]);
    const provider = new FileTreeContextProvider({});

    const items = await provider.getContextItems("", {
      ide: {
        getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///work/project"]),
      },
    } as any);

    expect(items[0].content).toContain("project/\n  (empty)\n");
    expect(items[0].content).toContain("workspace root folder itself");
    expect(items[0].content).toContain("paths are relative to it");
  });

  it("reports when no workspace folder is open", async () => {
    const provider = new FileTreeContextProvider({});
    const items = await provider.getContextItems("", {
      ide: { getWorkspaceDirs: vi.fn().mockResolvedValue([]) },
    } as any);

    expect(items[0].name).toBe("Workspace Not Open");
    expect(items[0].content).toContain("No workspace folder");
  });
});
