import { fileURLToPath } from "node:url";
import type { IDE } from "..";
import type { GitState } from "./types";

const MAX_CHANGED = 15;
const MAX_RECENT = 5;
const TIMEOUT_MS = 2_000;
const CACHE_MS = 20_000;
/** Names that may hold secrets are counted but never listed. */
const SENSITIVE =
  /(^|[\/])(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|id_rsa[\w.]*|id_ed25519[\w.]*|credentials(\.json)?)$|\.(pem|key|p12|pfx)$|secret/i;

const cache = new Map<string, { at: number; state: GitState | undefined }>();

/** Test hook. */
export function resetGitStateCacheForTests(): void {
  cache.clear();
}

export function parseGitState(status: string, log: string): GitState {
  const entries = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    // "XY path" or "XY old -> new": keep the path that exists now.
    .map(
      (line) =>
        `${line.slice(0, 2).trim() || "?"} ${line.slice(3).split(" -> ").pop()}`,
    );
  // entry is "XY path"; test the path alone so the name anchors match.
  const listed = entries.filter(
    (entry) => !SENSITIVE.test(entry.slice(entry.indexOf(" ") + 1)),
  );
  return {
    changedTotal: entries.length,
    changed: listed.slice(0, MAX_CHANGED),
    recent: log
      .split("\n")
      .map((line) => line.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, MAX_RECENT),
  };
}

/**
 * Changed files (workspace-relative, as git prints them) and the last few
 * commit subjects of a root, for the agent's environment block. Skipped for
 * folders that are not local or not a git repository, and bounded in time so a
 * huge repository can never hold up the workspace snapshot.
 */
export async function readGitState(
  ide: IDE,
  rootUri: string,
): Promise<GitState | undefined> {
  const cached = cache.get(rootUri);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;

  let cwd: string;
  try {
    cwd = fileURLToPath(rootUri);
  } catch {
    return undefined; // remote or virtual folder
  }

  const timed = <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), TIMEOUT_MS),
      ),
    ]);

  let state: GitState | undefined;
  try {
    const [status, log] = await timed(
      Promise.all([
        ide.subprocess("git status --porcelain=v1", cwd),
        ide.subprocess("git log --oneline --no-decorate -n 5", cwd),
      ]),
    ).then((result) => result ?? [undefined, undefined]);
    if (status && log) state = parseGitState(status[0], log[0]);
  } catch {
    state = undefined; // not a repository, or git is not installed
  }
  cache.set(rootUri, { at: Date.now(), state });
  return state;
}
