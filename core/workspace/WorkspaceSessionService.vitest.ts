import { describe, expect, it, vi } from "vitest";

import type { IDE, IndexingProgressUpdate } from "..";
import { WorkspaceSessionService } from "./WorkspaceSessionService";

function createIde(overrides: Partial<IDE> = {}): IDE {
  const files: Record<string, string> = {
    "file:///workspace/VynorAI/package.json": '{"name":"vynorai"}',
    "file:///workspace/VynorAI/AGENTS.md": "Keep changes secure.",
  };
  return {
    getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/VynorAI"]),
    getCurrentFile: vi.fn().mockResolvedValue({
      isUntitled: false,
      path: "file:///workspace/VynorAI/core/core.ts",
      contents: "",
    }),
    getBranch: vi.fn().mockResolvedValue("main"),
    fileExists: vi.fn().mockImplementation(async (uri: string) => uri in files),
    readFile: vi
      .fn()
      .mockImplementation(async (uri: string) => files[uri] ?? ""),
    isWorkspaceTrusted: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as IDE;
}

describe("WorkspaceSessionService", () => {
  it("returns a privacy-safe, grounded workspace snapshot", async () => {
    const indexState: IndexingProgressUpdate = {
      progress: 100,
      desc: "Ready",
      status: "done",
    };
    const service = new WorkspaceSessionService(createIde(), () => indexState);

    const snapshot = await service.getSnapshot();

    expect(snapshot.roots).toHaveLength(1);
    expect(snapshot.roots[0]).toMatchObject({
      name: "VynorAI",
      branch: "main",
    });
    expect(snapshot.activeFile?.uri).toBe("core/core.ts");
    expect(snapshot.manifests[0]?.uri).toBe("package.json");
    expect(snapshot.instructions[0]?.uri).toBe("AGENTS.md");
    expect(snapshot.index[0]?.status).toBe("ready");
    expect(snapshot.trusted).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("file:///workspace");
  });

  it("keeps the revision stable until observable workspace state changes", async () => {
    let branch = "main";
    const ide = createIde({
      getBranch: vi.fn().mockImplementation(async () => branch),
    });
    const service = new WorkspaceSessionService(ide, () => undefined);

    const first = await service.getSnapshot();
    const cached = await service.getSnapshot();
    service.invalidate();
    const unchanged = await service.getSnapshot();
    branch = "feature/agent-runtime";
    service.invalidate();
    const changed = await service.getSnapshot();

    expect(cached.revision).toBe(first.revision);
    expect(unchanged.revision).toBe(first.revision);
    expect(changed.revision).toBe(first.revision + 1);
  });

  it("defaults to untrusted and handles an empty workspace explicitly", async () => {
    const service = new WorkspaceSessionService(
      createIde({
        getWorkspaceDirs: vi.fn().mockResolvedValue([]),
        getCurrentFile: vi.fn().mockResolvedValue(undefined),
        isWorkspaceTrusted: undefined,
      }),
      () => undefined,
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot.roots).toEqual([]);
    expect(snapshot.activeRootId).toBeUndefined();
    expect(snapshot.trusted).toBe(false);
    expect(snapshot.capabilities).not.toContain("workspace-tools");
  });
});
