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
 * rarely change and matter when they do (open folders, trust, the index
 * becoming ready) stay live.
 *
 * Measured on 14 real agent runs: the index went ready -> indexing -> ready
 * after every file the agent wrote, and the manifest list grew when it created
 * package.json, so the system message changed on most rounds of a build (133
 * times in 14 runs) and each of those rounds re-billed the conversation. The
 * index state therefore only moves forward to "ready" and stays there, and
 * the manifest and instruction lists are the ones the conversation began with.
 */
interface Frozen {
  activeFile: WorkspaceSnapshot["activeFile"];
  git: Map<string, GitState | undefined>;
  manifests: WorkspaceSnapshot["manifests"];
  instructions: WorkspaceSnapshot["instructions"];
  /** Per root: the first state seen, replaced once by "ready". */
  index: Map<string, WorkspaceSnapshot["index"][number]["status"]>;
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
    frozen = {
      activeFile: snapshot.activeFile,
      git: new Map(),
      manifests: snapshot.manifests,
      instructions: snapshot.instructions,
      index: new Map(),
    };
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
    manifests: frozen.manifests,
    instructions: frozen.instructions,
    // Drop the moving percentage and description. The state itself changes
    // once at most: from whatever it was first to "ready". Re-indexing one
    // edited file afterwards is not "not ready".
    index: (snapshot.index ?? []).map((entry) => {
      const seen = frozen!.index.get(entry.rootId);
      if (seen === undefined || entry.status === "ready") {
        frozen!.index.set(entry.rootId, entry.status);
      }
      return {
        ...entry,
        status: frozen!.index.get(entry.rootId)!,
        progress: undefined,
        description: undefined,
      };
    }),
  };
}
