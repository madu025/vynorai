import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real folders and real files: no mocks. The global folder is a temp one so
// the test never reads the developer's own instructions.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-instr-"));
const globalDir = path.join(root, "global");
const outer = path.join(root, "outer");
const inner = path.join(outer, "inner");
const project = path.join(inner, "project");

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

function realIde(dirs: string[]) {
  return {
    getWorkspaceDirs: async () => dirs.map((d) => pathToFileURL(d).href),
    fileExists: async (uri: string) => {
      try {
        return fs.statSync(new URL(uri)).isFile();
      } catch {
        return false;
      }
    },
    readFile: async (uri: string) => fs.readFileSync(new URL(uri), "utf8"),
  } as any;
}

let loadMarkdownRules: typeof import("./loadMarkdownRules").loadMarkdownRules;

beforeAll(async () => {
  process.env.CONTINUE_GLOBAL_DIR = globalDir;
  fs.mkdirSync(globalDir, { recursive: true });
  write(path.join(globalDir, "AGENTS.md"), "GLOBAL: answer briefly.");
  write(path.join(outer, "CLAUDE.md"), "OUTER: company coding rules.");
  write(path.join(inner, "AGENTS.md"), "INNER: team conventions.");
  write(path.join(project, "CLAUDE.md"), "PROJECT: use two spaces.");
  write(path.join(project, "CLAUDE.local.md"), "LOCAL: my own shortcuts.");
  vi.resetModules();
  ({ loadMarkdownRules } = await import("./loadMarkdownRules"));
});

afterAll(() => {
  delete process.env.CONTINUE_GLOBAL_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("instruction files beyond the project root", () => {
  it("loads global, ancestor, project and local files, general first and local last", async () => {
    const { rules } = await loadMarkdownRules(realIde([project]));
    const texts = rules.map((rule) => rule.rule.trim());
    const order = ["GLOBAL", "OUTER", "INNER", "PROJECT", "LOCAL"].map((tag) =>
      texts.findIndex((text) => text.startsWith(tag)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rules.every((rule) => rule.alwaysApply)).toBe(true);
  });

  it("marks them as instruction files with their own path", async () => {
    const { rules } = await loadMarkdownRules(realIde([project]));
    const local = rules.find((rule) => rule.rule.startsWith("LOCAL"));
    expect(local?.source).toBe("agentFile");
    expect(local?.sourceFile).toContain("CLAUDE.local.md");
  });

  it("does not repeat a file whose text is already loaded", async () => {
    write(path.join(outer, "AGENTS.md"), "PROJECT: use two spaces.");
    const { rules } = await loadMarkdownRules(realIde([project]));
    expect(
      rules.filter((rule) => rule.rule.trim() === "PROJECT: use two spaces."),
    ).toHaveLength(1);
    fs.rmSync(path.join(outer, "AGENTS.md"));
  });

  it("never reads above the home folder or at the filesystem root", async () => {
    const { ancestorDirs } = await import("./loadInstructionFiles");
    const dirs = ancestorDirs(pathToFileURL(project).href);
    const home = path.resolve(os.homedir());
    expect(dirs.length).toBeLessThanOrEqual(4);
    for (const dir of dirs) {
      expect(path.dirname(dir)).not.toBe(dir); // not a root
      expect(dir === home || dir.startsWith(home + path.sep)).toBe(true);
    }
    expect(dirs.at(-1)).toBe(inner); // closest ancestor last
  });

  it("ignores an empty local file", async () => {
    write(path.join(project, "AGENTS.local.md"), "   \n");
    const { rules } = await loadMarkdownRules(realIde([project]));
    expect(
      rules.filter((rule) => rule.sourceFile?.endsWith("AGENTS.local.md")),
    ).toHaveLength(0);
  });
});
