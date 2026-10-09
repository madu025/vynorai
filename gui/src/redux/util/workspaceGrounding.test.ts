import type { WorkspaceSnapshot } from "core/workspace/types";
import { formatWorkspaceGrounding } from "./workspaceGrounding";

const snapshot: WorkspaceSnapshot = {
  id: "workspace-1",
  revision: 2,
  roots: [{ id: "root-1", name: "VynorAI", branch: "main" }],
  activeRootId: "root-1",
  activeFile: { rootId: "root-1", uri: "gui/src/App.tsx" },
  manifests: [
    { rootId: "root-1", uri: "package.json", kind: "npm", digest: "abc" },
  ],
  instructions: [],
  index: [{ rootId: "root-1", status: "ready", progress: 100 }],
  trusted: true,
  capabilities: ["readFile", "search"],
  createdAt: 1,
};

test("grounds the model with privacy-safe workspace evidence", () => {
  const result = formatWorkspaceGrounding(snapshot);

  expect(result).toContain("Connected: yes");
  expect(result).toContain("VynorAI (branch: main)");
  expect(result).toContain("gui/src/App.tsx");
  expect(result).toContain("package.json");
  expect(result).toContain("never claim that you have no workspace");
  expect(result).not.toContain("digest");
  expect(result).not.toContain("abc");
});

test("does not fabricate visibility without a snapshot", () => {
  const result = formatWorkspaceGrounding();

  expect(result).toContain("not available");
  expect(result).toContain("Do not pretend that files were inspected");
});

test("tolerates an incomplete snapshot while the IDE refresh is in flight", () => {
  const partialSnapshot = {
    id: "workspace-1",
    revision: 3,
    trusted: true,
    createdAt: 2,
  } as WorkspaceSnapshot;

  const result = formatWorkspaceGrounding(partialSnapshot);

  expect(result).toContain("Connected: no workspace folder open");
  expect(result).toContain("Roots: none detected");
  expect(result).toContain("Available IDE capabilities: none detected");
});

test("names the active root, the platform and today's date", () => {
  const multi = {
    ...snapshot,
    roots: [
      { id: "root-1", name: "VynorAI", branch: "main" },
      { id: "root-2", name: "docs-site" },
    ],
    activeRootId: "root-2",
    platform: "win32",
  } as WorkspaceSnapshot;

  const result = formatWorkspaceGrounding(
    multi,
    new Date("2026-10-08T10:00:00Z"),
  );

  expect(result).toContain("- Active root: docs-site");
  expect(result).toContain("VynorAI (branch: main)");
  expect(result).toContain("- Platform: win32");
  expect(result).toContain("- Date: 2026-10-08");
});

test("tells the model not to assume a root when several are open and none is active", () => {
  const multi = {
    ...snapshot,
    roots: [
      { id: "root-1", name: "alpha" },
      { id: "root-2", name: "beta" },
    ],
    activeRootId: undefined,
  } as WorkspaceSnapshot;

  const result = formatWorkspaceGrounding(multi);

  expect(result).toContain("Active root: not selected");
  expect(result).toContain("do not assume one");
  expect(result).toContain("Platform: unknown");
});

test("a single open root is reported as the active root", () => {
  expect(formatWorkspaceGrounding(snapshot)).toContain(
    "- Active root: VynorAI",
  );
});

test("the date is the user's local calendar day, not the UTC day", () => {
  // 02:00 local on the 10th is still the 9th in UTC for any zone ahead of UTC.
  const lateNight = new Date(2026, 9, 10, 2, 0, 0);
  expect(formatWorkspaceGrounding(snapshot, lateNight)).toContain(
    "- Date: 2026-10-10",
  );
  const earlyMorning = new Date(2026, 9, 10, 23, 30, 0);
  expect(formatWorkspaceGrounding(snapshot, earlyMorning)).toContain(
    "- Date: 2026-10-10",
  );
});
