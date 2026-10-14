import fs from "node:fs";
import path from "node:path";

const taskDirectory =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StagingCleanupOptions {
  root: string;
  activeTaskIds: ReadonlySet<string>;
  now?: number;
  graceMs?: number;
  maxRemovals?: number;
}

export interface StagingCleanupResult {
  scanned: number;
  removed: string[];
  skippedActive: string[];
  skippedYoung: string[];
  errors: Array<{ taskId: string; message: string }>;
}

/** Remove only old UUID-named task directories that are not active in the DB. */
export async function cleanupStaleStaging(
  options: StagingCleanupOptions,
): Promise<StagingCleanupResult> {
  const root = path.resolve(options.root);
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? 90 * 60_000;
  const maxRemovals = Math.max(1, options.maxRemovals ?? 20);
  const result: StagingCleanupResult = {
    scanned: 0,
    removed: [],
    skippedActive: [],
    skippedYoung: [],
    errors: [],
  };
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    result.errors.push({
      taskId: "<root>",
      message: error instanceof Error ? error.message : "STAGING_READ_FAILED",
    });
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !taskDirectory.test(entry.name)) continue;
    result.scanned += 1;
    if (options.activeTaskIds.has(entry.name)) {
      result.skippedActive.push(entry.name);
      continue;
    }
    if (result.removed.length >= maxRemovals) continue;
    const resolved = path.resolve(root, entry.name);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      result.errors.push({
        taskId: entry.name,
        message: "INVALID_STAGING_PATH",
      });
      continue;
    }
    try {
      const stat = await fs.promises.stat(resolved);
      if (now - stat.mtimeMs < graceMs) {
        result.skippedYoung.push(entry.name);
        continue;
      }
      await fs.promises.rm(resolved, { recursive: true, force: true });
      result.removed.push(entry.name);
    } catch (error) {
      result.errors.push({
        taskId: entry.name,
        message:
          error instanceof Error ? error.message : "STAGING_REMOVE_FAILED",
      });
    }
  }
  return result;
}
