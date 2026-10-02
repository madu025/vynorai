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
