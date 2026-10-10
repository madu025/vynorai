import type { GitState, WorkspaceSnapshot } from "core/workspace/types";

/**
 * The environment block sits in the system message, which is the very start
 * of every request. Providers bill a repeated prompt prefix at a small
 * fraction of the normal rate (DeepSeek: about 2%), but only while the prefix
 * is byte-identical. If one character of the system message changes between
 * two rounds, the whole conversation after it is billed in full again.
 *
 * Some of the workspace state changes constantly: the changed-files list
 * after every edit, the active file whenever the user clicks another tab, the
 * index progress percentage while indexing. Those parts are therefore
 * captured once per conversation and reused (the same idea as the git status
 * "snapshot at the start of the conversation" in Claude Code). Things that
 * rarely change and matter when they do (open folders, trust, index
 * ready/not ready) stay live.
 */
interface Frozen {
  activeFile: WorkspaceSnapshot["activeFile"];
  git: Map<string, GitState | undefined>;
}

const MAX_SESSIONS = 50;
const frozenBySession = new Map<string, Frozen>();

/** Test hook. */
export function resetGroundingFreezeForTests(): void {
  frozenBySession.clear();
}

export function freezeVolatileWorkspaceState(
  sessionId: string,
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  let frozen = frozenBySession.get(sessionId);
  if (!frozen) {
    frozen = { activeFile: snapshot.activeFile, git: new Map() };
    frozenBySession.set(sessionId, frozen);
    while (frozenBySession.size > MAX_SESSIONS) {
      const oldest = frozenBySession.keys().next().value;
      if (oldest === undefined) break;
      frozenBySession.delete(oldest);
    }
  }

  const roots = (snapshot.roots ?? []).map((root) => {
    // The first time a root is seen in this conversation fixes its git state.
    if (!frozen!.git.has(root.id)) frozen!.git.set(root.id, root.git);
    return { ...root, git: frozen!.git.get(root.id) };
  });

  return {
    ...snapshot,
    roots,
    activeFile: frozen.activeFile,
    // Keep ready/not ready; drop the moving percentage and description.
    index: (snapshot.index ?? []).map((entry) => ({
      ...entry,
      progress: undefined,
      description: undefined,
    })),
  };
}
