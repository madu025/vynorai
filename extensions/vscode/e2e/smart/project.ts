import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * A fresh, tiny Node project per run. Checks look at what actually happened
 * on disk and when the tests run, not at the words the model used.
 */
export const WORKSPACE = path.join(os.tmpdir(), "vynor-smart-e2e-ws");

const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "smart-e2e-sample",
      private: true,
      type: "commonjs",
      scripts: { test: "node --test" },
    },
    null,
    2,
  ),
  "math.js": `function add(a, b) {\n  return a + b;\n}\n\nfunction subtract(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add, subtract };\n`,
  "math.test.js": `const test = require("node:test");\nconst assert = require("node:assert");\nconst { add, subtract } = require("./math");\n\ntest("add", () => assert.strictEqual(add(2, 3), 5));\ntest("subtract", () => assert.strictEqual(subtract(5, 3), 2));\n`,
  "README.md": "# Sample\nA tiny math library used by the VynorAI E2E suite.\n",
};

export function resetWorkspace(): string {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  for (const [name, content] of Object.entries(FILES))
    fs.writeFileSync(path.join(WORKSPACE, name), content);
  return WORKSPACE;
}

export function read(file: string): string {
  try {
    return fs.readFileSync(path.join(WORKSPACE, file), "utf8");
  } catch {
    return "";
  }
}

/** Load math.js fresh and call an export, or return the error. */
export function callExport(name: string, ...args: unknown[]): unknown {
  const file = path.join(WORKSPACE, "math.js");
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  if (typeof mod[name] !== "function")
    throw new Error(`math.js does not export ${name}()`);
  return mod[name](...args);
}

/** Run the project's own tests; returns pass/fail and the output tail. */
export function runProjectTests(): { ok: boolean; output: string } {
  try {
    const output = execFileSync(process.execPath, ["--test"], {
      cwd: WORKSPACE,
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: output.slice(-1500) };
  } catch (error: any) {
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.slice(-1500),
    };
  }
}

/** Every file in the workspace, for evidence in failure reports. */
export function snapshot(): string {
  return fs
    .readdirSync(WORKSPACE)
    .filter((f) => !f.startsWith("."))
    .map((f) => `--- ${f}\n${read(f).slice(0, 1500)}`)
    .join("\n");
}
