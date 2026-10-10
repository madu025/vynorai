import type { WorkspaceSnapshot } from "core/workspace/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  freezeVolatileWorkspaceState,
  resetGroundingFreezeForTests,
} from "./groundingFreeze";
import { formatWorkspaceGrounding } from "./workspaceGrounding";

const NOW = new Date("2026-10-10T12:00:00");

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    id: "w",
    revision: 1,
    roots: [
      {
        id: "r1",
        name: "app",
        branch: "main",
        git: { changed: [], changedTotal: 0, recent: ["a1 init"] },
      },
    ],
    activeRootId: "r1",
    activeFile: { rootId: "r1", uri: "src/a.ts" },
    manifests: [],
    instructions: [],
    index: [{ rootId: "r1", status: "indexing", progress: 10 }],
    trusted: true,
    capabilities: ["workspace-context"],
    createdAt: 0,
    ...over,
  } as WorkspaceSnapshot;
}

const block = (sessionId: string, s: WorkspaceSnapshot) =>
  formatWorkspaceGrounding(freezeVolatileWorkspaceState(sessionId, s), NOW);

describe("grounding block is stable across rounds (cache-safe)", () => {
  beforeEach(() => resetGroundingFreezeForTests());

  it("does not change when files are edited, the tab changes or indexing advances", () => {
    const first = block("s1", snapshot());
    const later = block(
      "s1",
      snapshot({
        revision: 9,
        roots: [
          {
            id: "r1",
            name: "app",
            branch: "main",
            git: {
              changed: ["M src/a.ts", "?? new.ts"],
              changedTotal: 2,
              recent: ["b2 fix", "a1 init"],
            },
          },
        ],
        activeFile: { rootId: "r1", uri: "src/other.ts" },
        index: [{ rootId: "r1", status: "indexing", progress: 77 }],
      }),
    );
    expect(later).toBe(first);
  });

  it("still follows things that matter: trust, open folders and index ready", () => {
    const first = block("s1", snapshot());
    const untrusted = block("s1", snapshot({ trusted: false }));
    expect(untrusted).not.toBe(first);
    const ready = block(
      "s1",
      snapshot({ index: [{ rootId: "r1", status: "ready" } as any] }),
    );
    expect(ready).not.toBe(first);
  });

  it("a new conversation takes a fresh snapshot", () => {
    block("s1", snapshot());
    const changed = snapshot({
      activeFile: { rootId: "r1", uri: "src/other.ts" },
    });
    expect(block("s2", changed)).toContain("src/other.ts");
    expect(block("s1", changed)).toContain("src/a.ts");
  });

  it("does not mutate the snapshot it is given", () => {
    const original = snapshot();
    freezeVolatileWorkspaceState("s1", original);
    freezeVolatileWorkspaceState(
      "s1",
      snapshot({ activeFile: { rootId: "r1", uri: "x.ts" } }),
    );
    expect(original.index[0].progress).toBe(10);
  });
});
