import { fileURLToPath } from "node:url";
import type { IDE } from "..";
import type { GitState } from "./types";

const MAX_CHANGED = 15;
const MAX_RECENT = 5;
const TIMEOUT_MS = 2_000;
const CACHE_MS = 20_000;
const MAX_CACHED_ROOTS = 20;
/** Names that may hold secrets are counted but never listed. */
const SENSITIVE =
  /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|id_rsa[\w.]*|id_ed25519[\w.]*|credentials(\.json)?)$|\.(pem|key|p12|pfx)$|secret/i;

// The in-flight promise is cached, so parallel callers share one pair of git
// processes. `at` is set when the work finishes.
const cache = new Map<
  string,
  { at: number; promise: Promise<GitState | undefined> }
>();

/** Forget cached states: the working tree has probably changed. */
export function resetGitStateCache(): void {
  cache.clear();
}

/** Test hook. */
export function resetGitStateCacheForTests(): void {
  cache.clear();
}

/** git quotes paths with spaces or non-ASCII characters: "my app/x.ts". */
function unquote(path: string): string {
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return path;
}

export function parseGitState(status: string, log: string): GitState {
  const entries = status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || "?",
      // "XY path" or "XY old -> new": keep the path that exists now.
      path: unquote(line.slice(3).split(" -> ").pop() ?? ""),
    }));
  const listed = entries.filter((entry) => !SENSITIVE.test(entry.path));
  return {
    changedTotal: entries.length,
    changed: listed
      .slice(0, MAX_CHANGED)
      // one line, no control characters, whatever the file is called
      .map((entry) =>
        `${entry.code} ${entry.path}`.replace(/[\u0000-\u001f]/g, " "),
      ),
    recent: log
      .split("\n")
      .map((line) =>
        line
          .replace(/[\u0000-\u001f]/g, " ")
          .trim()
          .slice(0, 120),
      )
      .filter(Boolean)
      .slice(0, MAX_RECENT),
  };
}

async function readUncached(
  ide: IDE,
  cwd: string,
): Promise<GitState | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), TIMEOUT_MS);
  });
  // --no-optional-locks: read-only polling must never take .git/index.lock
  // while the user or the agent runs `git add` or `git commit`.
  const status = ide
    .subprocess("git --no-optional-locks status --porcelain=v1", cwd)
    .then((result) => result[0])
    .catch(() => undefined);
  // A repository without commits has no log; that is not "no git".
  const log = ide
    .subprocess("git --no-optional-locks log --oneline --no-decorate -n 5", cwd)
    .then((result) => result[0])
    .catch(() => "");
  try {
    const result = await Promise.race([Promise.all([status, log]), timeout]);
    if (!result || result[0] === undefined) return undefined;
    return parseGitState(result[0], result[1] ?? "");
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  if (cached && (cached.at === 0 || Date.now() - cached.at < CACHE_MS)) {
    return cached.promise;
  }

  let cwd: string;
  try {
    cwd = fileURLToPath(rootUri);
  } catch {
    return undefined; // remote or virtual folder
  }
  if (typeof ide.subprocess !== "function") return undefined;

  const entry = { at: 0, promise: readUncached(ide, cwd) };
  entry.promise = entry.promise.finally(() => {
    entry.at = Date.now();
  });
  cache.set(rootUri, entry);
  while (cache.size > MAX_CACHED_ROOTS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry.promise;
}
