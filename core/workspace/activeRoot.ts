import type { IDE } from "..";
import { findUriInDirs } from "../util/uri";

/**
 * The workspace folder a command should act on. Same order as the workspace
 * snapshot: a root the user pinned, then the root holding the active file,
 * then the only root. With several roots and nothing to go on, fall back to
 * the first folder so a command never silently does nothing.
 */
export async function resolveActiveWorkspaceDir(
  ide: Pick<IDE, "getWorkspaceDirs" | "getCurrentFile">,
  pinnedDir?: string,
): Promise<string | undefined> {
  const dirs = await ide.getWorkspaceDirs();
  if (!dirs || dirs.length === 0) return undefined;
  if (pinnedDir && dirs.includes(pinnedDir)) return pinnedDir;
  if (dirs.length === 1) return dirs[0];

  const current = await ide.getCurrentFile?.().catch(() => undefined);
  if (current && !current.isUntitled) {
    const located = findUriInDirs(current.path, dirs);
    if (located.foundInDir) return located.foundInDir;
  }
  return dirs[0];
}
