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

  it("keeps a known workspace through a transient empty resume response", async () => {
    const getWorkspaceDirs = vi
      .fn()
      .mockResolvedValueOnce(["file:///workspace/VynorAI"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["file:///workspace/VynorAI"]);
    const service = new WorkspaceSessionService(
      createIde({ getWorkspaceDirs }),
      () => undefined,
      0,
    );

    await service.getSnapshot();
    service.invalidate();
    const recovered = await service.getSnapshot(true);

    expect(recovered.roots).toHaveLength(1);
    expect(recovered.roots[0]?.name).toBe("VynorAI");
    expect(getWorkspaceDirs).toHaveBeenCalledTimes(3);
  });

  it("lets the user pin the active root in a multi-root workspace", async () => {
    const ide = createIde({
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///workspace/a", "file:///workspace/b"]),
      getCurrentFile: vi.fn().mockResolvedValue(undefined),
    });
    const service = new WorkspaceSessionService(ide, () => undefined);

    const before = await service.getSnapshot();
    expect(before.roots).toHaveLength(2);
    expect(before.activeRootId).toBeUndefined();

    const target = before.roots[1];
    const after = await service.setActiveRoot(target.id);
    expect(after.activeRootId).toBe(target.id);
    expect(after.revision).toBeGreaterThan(before.revision);

    await expect(service.setActiveRoot("not-a-root")).rejects.toThrow(
      "Unknown workspace root",
    );
    // A rejected pick leaves the previous selection intact.
    expect((await service.getSnapshot(true)).activeRootId).toBe(target.id);
  });

  it("exposes the selected root URI for commands without leaking it into the snapshot", async () => {
    const ide = createIde({
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///workspace/a", "file:///workspace/b"]),
      getCurrentFile: vi.fn().mockResolvedValue(undefined),
    });
    const service = new WorkspaceSessionService(ide, () => undefined);

    expect(await service.getActiveRootUri()).toBeUndefined();
    const snapshot = await service.getSnapshot();
    await service.setActiveRoot(snapshot.roots[1].id);
    expect(await service.getActiveRootUri()).toBe("file:///workspace/b");
    expect(JSON.stringify(await service.getSnapshot())).not.toContain(
      "file:///workspace",
    );
  });

  it("reports the host platform without changing the snapshot revision", async () => {
    const service = new WorkspaceSessionService(createIde(), () => undefined);

    const first = await service.getSnapshot();
    const second = await service.getSnapshot(true);

    expect(first.platform).toBe(process.platform);
    expect(second.revision).toBe(first.revision);
  });
});
