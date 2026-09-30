import { applyFilePatches } from "../patchEngine.js";
import { createProjectSnapshot, restoreProjectSnapshot } from "../idempotency.js";
import { PatchOperation, PatchResult } from "../types.js";

/**
 * VynorAI Deterministic Execution Tools Layer (Layer 5)
 * -----------------------------------------------------------------------------
 * "Tool = HOW TO ACTUALLY EXECUTE THE ACTION?"
 * The physical execution drivers for Database, Filesystem, Testing, and Git.
 */

export const ExecutionTools = {
  // ── 1. Filesystem Tools ───────────────────────────────────────────────────
  filesystem: {
    readFile(files: Record<string, string>, path: string): string | null {
      return files[path] || null;
    },

    writeFile(files: Record<string, string>, path: string, content: string): Record<string, string> {
      return {
        ...files,
        [path]: content,
      };
    },

    patchFile(files: Record<string, string>, patch: PatchOperation, protectedSections: string[] = []): PatchResult {
      return applyFilePatches(files, [patch], protectedSections);
    },

    searchCode(files: Record<string, string>, query: string): { path: string; line: number; preview: string }[] {
      const results: { path: string; line: number; preview: string }[] = [];
      const qLower = query.toLowerCase();

      for (const [path, content] of Object.entries(files)) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(qLower)) {
            results.push({
              path,
              line: i + 1,
              preview: lines[i].trim(),
            });
          }
        }
      }
      return results;
    },
  },

  // ── 2. Database Tools ─────────────────────────────────────────────────────
  database: {
    inspectSchema(schemaSQL: string): { tables: string[]; columnsCount: number; indexesCount: number } {
      const tables: string[] = [];
      const tableMatches = schemaSQL.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"`]+)/gi);
      for (const m of tableMatches) {
        tables.push(m[1].replace(/[`"']/g, ""));
      }

      const columnsCount = (schemaSQL.match(/\b(VARCHAR|INT|BIGINT|DECIMAL|TIMESTAMP|BOOLEAN|TEXT)\b/gi) || []).length;
      const indexesCount = (schemaSQL.match(/CREATE\s+INDEX/gi) || []).length;

      return {
        tables,
        columnsCount,
        indexesCount,
      };
    },

    createMigration(name: string, upSql: string, downSql = ""): { filename: string; sql: string } {
      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const filename = `migrations/${timestamp}_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}.sql`;
      const sql = `-- Migration: ${name}\n-- Up:\n${upSql}\n\n-- Down:\n${downSql}`;
      return { filename, sql };
    },
  },

  // ── 3. Testing & Verification Tools ───────────────────────────────────────
  testing: {
    runTestSuite(testName: string, testFn: () => boolean): { name: string; passed: boolean; durationMs: number } {
      const start = Date.now();
      let passed = false;
      try {
        passed = testFn();
      } catch {
        passed = false;
      }
      return {
        name: testName,
        passed,
        durationMs: Date.now() - start,
      };
    },
  },

  // ── 4. Git & Snapshot Tools ───────────────────────────────────────────────
  git: {
    createSnapshot(files: Record<string, string>): string {
      return createProjectSnapshot(files);
    },

    rollback(snapshotId: string): Record<string, string> | null {
      return restoreProjectSnapshot(snapshotId);
    },

    computeDiff(before: string, after: string): string {
      if (before === after) return "No changes";
      const beforeLines = before.split("\n");
      const afterLines = after.split("\n");
      const diffLines: string[] = [];

      for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
        if (beforeLines[i] !== afterLines[i]) {
          if (beforeLines[i] !== undefined) diffLines.push(`- ${beforeLines[i]}`);
          if (afterLines[i] !== undefined) diffLines.push(`+ ${afterLines[i]}`);
        }
      }
      return diffLines.join("\n");
    },
  },
};
