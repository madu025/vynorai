/**
 * Ranking for the repo map: which files deserve their signatures in the
 * limited token budget, and a compact tree for the rest.
 *
 * A file that many other files import is central to the codebase, so the
 * score is driven by import in-degree (as in Aider's repo map), nudged by
 * entry-point names and source folders, and pushed down for tests, fixtures,
 * docs and generated code. Everything is deterministic for a given repo, so
 * repeated maps are byte-identical and stay in the provider prefix cache.
 */

export interface RepoFile {
  /** Workspace-relative path with forward slashes. */
  path: string;
  content?: string;
  signatureCount: number;
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];

const ENTRY_NAME =
  /(^|\/)(index|main|app|server|cli|extension|core|router|routes|api|config|types)\.[a-z]+$/i;
const SOURCE_DIR = /(^|\/)(src|lib|app|core|server|packages\/[^/]+\/src)\//i;
const LOW_VALUE =
  /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|__mocks__|mocks?|examples?|docs?|scripts|benchmarks?)\/|\.(test|spec|stories|vitest)\.[a-z]+$/i;
const GENERATED =
  /(^|\/)(dist|build|out|coverage|vendor|generated)\/|\.min\.[a-z]+$|\.generated\.[a-z]+$/i;

/** Import specifiers in a JS/TS or Python file (relative ones are resolvable). */
export function extractImportSpecifiers(
  path: string,
  content: string,
): string[] {
  const specs: string[] = [];
  if (/\.py$/i.test(path)) {
    for (const m of content.matchAll(
      /^\s*from\s+(\.+[\w.]*|[\w.]+)\s+import\b/gm,
    ))
      specs.push(m[1]);
    for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm))
      specs.push(m[1]);
    return specs;
  }
  for (const m of content.matchAll(
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm,
  )) {
    specs.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return specs;
}

function normalize(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Resolve a specifier to a known repo file, or null (packages, unknown paths). */
export function resolveImport(
  fromPath: string,
  spec: string,
  known: Set<string>,
): string | null {
  const dir = fromPath.split("/").slice(0, -1);
  let base: string;
  if (/\.py$/i.test(fromPath)) {
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const rest = spec.slice(dots).split(".").filter(Boolean);
    const anchor = dots > 0 ? dir.slice(0, dir.length - (dots - 1)) : [];
    base = normalize([...anchor, ...rest]);
    for (const c of [`${base}.py`, `${base}/__init__.py`])
      if (known.has(c)) return c;
    return null;
  }
  if (!spec.startsWith(".")) return null;
  base = normalize([...dir, ...spec.split("/")]);
  // ESM-style imports name the compiled .js file; try the source too.
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/i, "");
  const candidates = [base, stripped];
  for (const ext of CODE_EXTENSIONS)
    candidates.push(stripped + ext, `${stripped}/index${ext}`);
  for (const c of candidates) if (known.has(c)) return c;
  return null;
}

export function scoreRepoFiles(files: RepoFile[]): Map<string, number> {
  const known = new Set(files.map((f) => f.path));
  const inDegree = new Map<string, number>();
  for (const f of files) {
    if (!f.content) continue;
    const targets = new Set<string>();
    for (const spec of extractImportSpecifiers(f.path, f.content)) {
      const target = resolveImport(f.path, spec, known);
      if (target && target !== f.path) targets.add(target);
    }
    for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  }
  const scores = new Map<string, number>();
  for (const f of files) {
    let score = 3 * Math.log2(1 + (inDegree.get(f.path) ?? 0));
    score += 0.15 * Math.min(f.signatureCount, 20);
    if (ENTRY_NAME.test(f.path)) score += 2;
    if (SOURCE_DIR.test(f.path)) score += 1;
    if (LOW_VALUE.test(f.path)) score -= 4;
    if (GENERATED.test(f.path)) score -= 8;
    scores.set(f.path, score);
  }
  return scores;
}

/** Paths ordered most important first; ties broken by path for stable output. */
export function rankRepoFiles(files: RepoFile[]): string[] {
  const scores = scoreRepoFiles(files);
  return files
    .map((f) => f.path)
    .sort(
      (a, b) => scores.get(b)! - scores.get(a)! || (a < b ? -1 : a > b ? 1 : 0),
    );
}

/**
 * Folder outline for files that did not fit: "src/components/ (34 files)".
 * Shows up to two folder levels, largest folders first.
 */
export function summarizeTree(paths: string[], maxLines = 60): string {
  if (paths.length === 0) return "";
  const counts = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/");
    const key =
      parts.length > 2
        ? `${parts[0]}/${parts[1]}/`
        : parts.length === 2
          ? `${parts[0]}/`
          : "./";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([dir, n]) => `${dir} (${n} file${n === 1 ? "" : "s"})`);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines)
    shown.push(`… ${lines.length - maxLines} more folders`);
  return shown.join("\n");
}
