/**
 * Large task benchmark: multi-file work on a copy of a real package of this
 * repository, scored by hidden tests, the package's own suite and the type
 * check. See docs/LARGE_TASK_BENCHMARK_PLAN.md.
 *
 *   npx tsx scripts/bench/large.ts --selfcheck
 *   VYNORAI_E2E_API_KEY=vynor_live_... npx tsx scripts/bench/large.ts [--model deepseek-v4-pro] [--ids a,b] [--runs 1] [--out name]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyDiffTool } from "../../../core/tools/definitions/applyDiff";
import { renameSymbolTool } from "../../../core/tools/definitions/renameSymbol";
import {
  applyDiffImpl,
  renameSymbolImpl,
} from "../../../core/tools/implementations/patchTools";
// @ts-expect-error plain JS module
import { listFiles, runAgent, sha, TOOLS } from "./lib.mjs";
import { LARGE_TASKS, type LargeTask } from "./large-tasks";

const REPO = path.resolve(__dirname, "../../..");
const MAX_TURNS = 40; // the extension's agent-mode round budget
const TOKEN_CAP = 1_500_000;
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

interface Fixture {
  root: string;
  dir: string;
  maxOutput: number;
  maxHits: number;
  runCommand: (command: string) => string;
}

function node(dir: string, script: string, args: string[], timeout = 180_000) {
  const env = { ...process.env, NODE_ENV: "test", CI: "1" };
  delete env.VYNORAI_E2E_API_KEY;
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout,
    env,
  });
  return {
    ok: res.status === 0,
    out: strip(`${res.stdout ?? ""}${res.stderr ?? ""}`),
    status: res.status,
  };
}
// node_modules sits inside the project folder, or beside it for a run through
// the real extension (so VS Code never sees it).
function tool(dir: string, rel: string): string {
  for (const base of [dir, path.dirname(dir)]) {
    const full = path.join(base, "node_modules", rel);
    if (fs.existsSync(full)) return full;
  }
  return path.join(dir, "node_modules", rel);
}
const vitest = (dir: string, files: string[] = []) =>
  node(dir, tool(dir, "vitest/vitest.mjs"), ["run", ...files]);
const tsc = (dir: string) =>
  node(dir, tool(dir, "typescript/bin/tsc"), [
    "--noEmit",
    "--declaration",
    "false",
  ]);

const COMMAND_HELP =
  "Only `npx vitest run [file ...]`, `npx tsc --noEmit` and `npm test` are available here.";

/** The agent may run the package's tests and type check, nothing else. */
function runCommand(dir: string) {
  return (command: string): string => {
    let res;
    const test = /^(?:npx\s+)?vitest(?:\s+run)?((?:\s+[\w./-]+)*)$/.exec(
      command,
    );
    if (test) {
      const files = test[1].trim().split(/\s+/).filter(Boolean);
      if (files.some((f) => f.includes("..") || path.isAbsolute(f)))
        return "Refused: path outside the workspace.";
      res = vitest(dir, files);
    } else if (/^npm\s+(run\s+)?test$/.test(command)) {
      res = vitest(dir);
    } else if (/^(?:npx\s+)?tsc(\s+--noEmit)?$/.test(command)) {
      res = tsc(dir);
    } else {
      return COMMAND_HELP;
    }
    return `exit code ${res.status ?? "timeout"}\n${res.out.slice(-6000)}`;
  };
}

function makeFixture(task: LargeTask, at?: string): Fixture {
  const root =
    at ?? fs.mkdtempSync(path.join(os.tmpdir(), `vynor-large-${task.id}-`));
  const dir = path.join(root, "project");
  const src = path.join(REPO, task.package);
  const tracked = spawnSync("git", ["ls-files", "-z", "--", task.package], {
    cwd: REPO,
    encoding: "utf8",
  })
    .stdout.split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    const rel = path.relative(task.package, file);
    const to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), to);
  }
  // Linked, not copied. For a run through the real extension the link sits
  // beside the workspace folder, not inside it: VS Code would watch, scan and
  // index tens of thousands of files and stop answering. Node resolves the
  // packages by walking up from the project folder.
  fs.symlinkSync(
    path.join(src, "node_modules"),
    path.join(at ? root : dir, "node_modules"),
    "junction",
  );
  return {
    root,
    dir,
    maxOutput: 60_000,
    maxHits: 300,
    runCommand: runCommand(dir),
  };
}

function cleanup(fx: Fixture) {
  for (const base of [fx.dir, fx.root]) {
    const link = path.join(base, "node_modules");
    if (fs.existsSync(link)) fs.rmdirSync(link); // the link only
  }
  fs.rmSync(fx.root, { recursive: true, force: true });
}

const snapshot = (dir: string): Map<string, string> =>
  new Map(
    (listFiles(dir) as string[]).map((f) => [
      f,
      sha(fs.readFileSync(path.join(dir, f), "utf8")),
    ]),
  );

function changedFiles(before: Map<string, string>, dir: string): string[] {
  const after = snapshot(dir);
  const out = new Set<string>();
  for (const [f, h] of after) if (before.get(f) !== h) out.add(f);
  for (const f of before.keys()) if (!after.has(f)) out.add(f);
  return [...out].sort();
}

interface Score {
  pass: boolean;
  hidden: boolean;
  suite: boolean;
  types: boolean;
  absent: boolean;
  why: string;
}

function score(task: LargeTask, fx: Fixture): Score {
  const why: string[] = [];
  let absent = true;
  for (const re of task.absent ?? []) {
    const hit = (listFiles(fx.dir) as string[])
      .filter((f) => /\.tsx?$/.test(f))
      .find((f) => re.test(fs.readFileSync(path.join(fx.dir, f), "utf8")));
    if (hit) {
      absent = false;
      why.push(`still present in ${hit}: ${re}`);
    }
  }
  const hiddenFiles = Object.keys(task.hidden ?? {});
  for (const [rel, content] of Object.entries(task.hidden ?? {})) {
    fs.mkdirSync(path.dirname(path.join(fx.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(fx.dir, rel), content, "utf8");
  }
  let hidden = true;
  if (hiddenFiles.length) {
    const h = vitest(fx.dir, hiddenFiles);
    hidden = h.ok;
    if (!h.ok) why.push(`hidden tests fail: ${tail(h.out)}`);
  }
  const s = vitest(fx.dir);
  if (!s.ok) why.push(`suite fails: ${tail(s.out)}`);
  const t = tsc(fx.dir);
  if (!t.ok) why.push(`type check fails: ${t.out.trim().split("\n")[0]}`);
  return {
    pass: absent && hidden && s.ok && t.ok,
    hidden: hidden && absent,
    suite: s.ok,
    types: t.ok,
    absent,
    why: why.join("; "),
  };
}
const tail = (out: string) =>
  (out.match(/(FAIL|AssertionError|Error:)[^\n]*/g) ?? [out.slice(-160)])
    .slice(0, 2)
    .join(" | ")
    .replace(/\s+/g, " ")
    .slice(0, 200);

/** One class per failed run, from the log and the disk only. */
function classify(
  task: LargeTask,
  run: any,
  sc: Score,
  changed: string[],
): string {
  if (sc.pass) return "pass";
  if (run.error) return "error";
  const touched = new Set([...run.log.read, ...changed]);
  if (!task.refFiles.some((f) => touched.has(f))) return "not-found";
  const missing = task.refFiles.filter((f) => !changed.includes(f));
  if (run.budgetHit) return "budget";
  if (missing.length) return "incomplete";
  if (!sc.hidden) return "wrong-edit";
  return "regression";
}

// The extension's own multi-file tools, with the IDE workspace pointed at the fixture.
const wrap = (impl: typeof applyDiffImpl) => async (args: any, fx: Fixture) => {
  const extras = {
    ide: { getWorkspaceDirs: async () => [pathToFileURL(fx.dir).href] },
  } as any;
  try {
    const items = await impl(args, extras);
    return items.map((i: any) => i.content).join("\n");
  } catch (err: any) {
    return `error: ${err.message}`;
  }
};
const AGENT_OPTS = {
  baseTools: (TOOLS as any[]).map((t) =>
    t.function.name === "run_command"
      ? {
          ...t,
          function: {
            ...t.function,
            description:
              "Run the package's tests or type check in the workspace root. " +
              COMMAND_HELP,
          },
        }
      : t,
  ),
  tools: [
    { type: "function", function: applyDiffTool.function },
    { type: "function", function: renameSymbolTool.function },
  ],
  impl: {
    apply_diff: wrap(applyDiffImpl),
    rename_symbol: wrap(renameSymbolImpl),
  },
  maxTurns: MAX_TURNS,
  tokenCap: TOKEN_CAP,
  systemExtra:
    "\n\nThis workspace is a TypeScript package. Tests: `npx vitest run [file]`. Type check: `npx tsc --noEmit`.",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function selfcheck(tasks: LargeTask[]) {
  let bad = 0;
  for (const task of tasks) {
    const untouched = makeFixture(task);
    const solved = makeFixture(task);
    try {
      const before = score(task, untouched);
      const snap = snapshot(solved.dir);
      task.solve(solved.dir);
      const changed = changedFiles(snap, solved.dir);
      const after = score(task, solved);
      const refOk =
        JSON.stringify(changed) === JSON.stringify([...task.refFiles].sort());
      const ok = !before.pass && after.pass && refOk;
      if (!ok) bad++;
      console.log(
        `${ok ? "OK  " : "BAD "} ${task.id} | untouched pass=${before.pass} | solved pass=${after.pass} ${after.why} | refFiles match=${refOk}`,
      );
    } finally {
      cleanup(untouched);
      cleanup(solved);
    }
  }
  process.exit(bad ? 1 : 0);
}

/** Arm D: the fixture for a run through the real extension (LargeTask.test.ts). */
function prepare(id: string, at: string) {
  const task = LARGE_TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`no task ${id}`);
  fs.rmSync(at, { recursive: true, force: true });
  fs.mkdirSync(at, { recursive: true });
  const fx = makeFixture(task, at);
  fs.writeFileSync(
    path.join(at, "task.json"),
    JSON.stringify({
      id,
      dir: fx.dir,
      // The chat input submits on Enter, so the prompt is one line.
      prompt: task.prompt.replace(/\s*\n+\s*/g, " "),
      before: [...snapshot(fx.dir)],
    }),
  );
  console.log(fx.dir);
}

function scoreDir(at: string) {
  const saved = JSON.parse(fs.readFileSync(path.join(at, "task.json"), "utf8"));
  const task = LARGE_TASKS.find((t) => t.id === saved.id)!;
  const changed = changedFiles(new Map(saved.before), saved.dir);
  const sc = score(task, { dir: saved.dir } as Fixture);
  const run = { log: { read: [] }, budgetHit: false };
  console.log(
    JSON.stringify({
      id: task.id,
      arm: "extension",
      pass: sc.pass,
      class: classify(task, run, sc, changed),
      refEdited: `${task.refFiles.filter((f) => changed.includes(f)).length}/${task.refFiles.length}`,
      changed,
      why: sc.why,
    }),
  );
}

async function main() {
  if (arg("prepare"))
    return prepare(arg("prepare")!, path.resolve(arg("dir")!));
  if (arg("score")) return scoreDir(path.resolve(arg("score")!));
  const ids = arg("ids")?.split(",");
  const tasks = LARGE_TASKS.filter((t) => !ids || ids.includes(t.id));
  if (process.argv.includes("--selfcheck")) return selfcheck(tasks);

  const key = process.env.VYNORAI_E2E_API_KEY ?? "";
  if (!/^vynor_live_[a-f0-9]{32}$/i.test(key)) {
    console.error("Set VYNORAI_E2E_API_KEY");
    process.exit(2);
  }
  const model = arg("model") ?? "vynor-auto";
  const runs = Number(arg("runs") ?? 1);
  const rows: any[] = [];
  for (const task of tasks) {
    for (let n = 0; n < runs; n++) {
      const fx = makeFixture(task);
      try {
        const before = snapshot(fx.dir);
        const run = await runAgent(key, task, fx, { ...AGENT_OPTS, model });
        const changed = changedFiles(before, fx.dir);
        const sc = score(task, fx);
        const row = {
          id: task.id,
          size: task.size,
          type: task.type,
          arm: model,
          served: run.model,
          tier: run.tier,
          pass: sc.pass,
          class: classify(task, run, sc, changed),
          verified: run.log.commands.some((c: string) => /vitest|npm/.test(c)),
          refEdited: `${task.refFiles.filter((f) => changed.includes(f)).length}/${task.refFiles.length}`,
          changed: changed.length,
          rounds: run.rounds,
          tokens: run.tokens,
          cacheHit: run.cacheHit,
          seconds: Math.round(run.ms / 1000),
          toolErrors: run.log.toolErrors,
          tools: Object.fromEntries(
            [...new Set<string>(run.log.tools)].map((t) => [
              t,
              run.log.tools.filter((x: string) => x === t).length,
            ]),
          ),
          why: sc.why || run.error || "",
        };
        rows.push(row);
        console.log(
          `${row.pass ? "PASS" : "FAIL"} ${row.id} [${row.class}] arm=${model} rounds=${row.rounds} tokens=${row.tokens} cache=${row.cacheHit} ref=${row.refEdited} verified=${row.verified} ${row.seconds}s ${row.why.slice(0, 200)}`,
        );
      } finally {
        cleanup(fx);
      }
    }
  }
  const out = arg("out");
  if (out) {
    const dir = path.resolve(__dirname, "../../bench-results");
    fs.writeFileSync(
      path.join(dir, `${out}.json`),
      JSON.stringify({ date: new Date().toISOString(), model, rows }, null, 2),
    );
  }
  const passed = rows.filter((r) => r.pass).length;
  console.log(
    `\n${passed}/${rows.length} passed, ${rows.reduce((a, r) => a + r.tokens, 0)} tokens`,
  );
}
void main();
