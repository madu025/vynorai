import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A command run with executeCommand("continue.x") that nobody registered does
 * not fail loudly: callers wrapped in try/catch ignore "command not found".
 * That is how sign-in and sign-out went on calling a reload that never ran.
 */
const SRC = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "e2e") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.(vitest|test)\./.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("commands run by name are registered", () => {
  it("every executeCommand('continue.*') literal has a registration", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8"),
    );
    const known = new Set<string>();
    for (const c of pkg.contributes?.commands ?? []) known.add(c.command);
    // A contributed view gets "<id>.focus" from VS Code itself.
    for (const views of Object.values<any[]>(pkg.contributes?.views ?? {})) {
      for (const v of views) known.add(`${v.id}.focus`);
    }
    const commandsTs = fs.readFileSync(path.join(SRC, "commands.ts"), "utf8");
    for (const m of commandsTs.matchAll(/^\s*"(continue\.[\w.]+)"\s*:/gm)) {
      known.add(m[1]);
    }
    for (const file of walk(SRC)) {
      for (const m of fs
        .readFileSync(file, "utf8")
        .matchAll(/registerCommand\(\s*"(continue\.[\w.]+)"/g)) {
        known.add(m[1]);
      }
    }

    const missing: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /executeCommand\(\s*"(continue\.[\w.]+)"/g,
      )) {
        if (!known.has(m[1])) {
          missing.push(`${m[1]} (${path.relative(SRC, file)})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
