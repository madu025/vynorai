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

  it("reports when no workspace folder is open", async () => {
    const provider = new FileTreeContextProvider({});
    const items = await provider.getContextItems("", {
      ide: { getWorkspaceDirs: vi.fn().mockResolvedValue([]) },
    } as any);

    expect(items[0].name).toBe("Workspace Not Open");
    expect(items[0].content).toContain("No workspace folder");
  });
});
