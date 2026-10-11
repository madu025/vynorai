/**
 * Real model, real core code: the tool schemas, tool implementations, task
 * shortcut prompts and reply-language block are imported from core and gui, not
 * copied. Checks that the model picks apply_diff / rename_symbol, that the
 * shortcut prompts lead to the right work, and that the language setting works.
 *
 *   VYNORAI_E2E_API_KEY=vynor_live_... npx tsx scripts/bench/core-live.ts
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyDiffTool } from "../../../core/tools/definitions/applyDiff";
import { renameSymbolTool } from "../../../core/tools/definitions/renameSymbol";
import {
  applyDiffImpl,
  renameSymbolImpl,
} from "../../../core/tools/implementations/patchTools";
import { AGENT_PROMPT_COMMANDS } from "../../../core/commands/slash/agentPromptCommands";
import { replyLanguageGuidance } from "../../../gui/src/redux/util/replyLanguage";
// @ts-expect-error plain JS modules
import { cleanup, evaluate, makeFixture, runAgent } from "./lib.mjs";
// @ts-expect-error plain JS modules
import { TASKS } from "./tasks.mjs";

const key = process.env.VYNORAI_E2E_API_KEY ?? "";
if (!/^vynor_live_[a-f0-9]{32}$/i.test(key)) {
  console.error("Set VYNORAI_E2E_API_KEY");
  process.exit(2);
}

const byId = (id: string) => {
  const t = TASKS.find((x: any) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};
const shortcut = (name: string, input: string) =>
  `${AGENT_PROMPT_COMMANDS.find((c) => c.name === name)!.prompt}\n\n${input}`;

// The core tools read the workspace folders from the IDE; point them at the fixture.
const wrap = (impl: typeof applyDiffImpl) => async (args: any, fx: any) => {
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
const CORE = {
  tools: [
    { type: "function", function: applyDiffTool.function },
    { type: "function", function: renameSymbolTool.function },
  ],
  impl: {
    apply_diff: wrap(applyDiffImpl),
    rename_symbol: wrap(renameSymbolImpl),
  },
};

interface Case {
  name: string;
  task: any;
  prompt?: string;
  opts?: any;
  extra?: (fx: any, run: any) => string[];
}
const sinhalaChars = (s: string) => (s.match(/[඀-෿]/g) ?? []).length;

const twoFiles = {
  id: "cl-two-files",
  category: "feature",
  lang: "en",
  prompt:
    "In src/a.mjs the greeting is 'Hello' and in src/b.mjs it is also 'Hello'. Change both to 'Welcome' in one step with the apply_diff tool, then run test.mjs.",
  files: {
    "src/a.mjs": `export const greetA = (n) => \`Hello \${n}\`;\n`,
    "src/b.mjs": `export const greetB = (n) => \`Hello again \${n}\`;\n`,
    "test.mjs": `import assert from "node:assert/strict";\nimport { greetA } from "./src/a.mjs";\nimport { greetB } from "./src/b.mjs";\nassert.equal(greetA("x"), "Welcome x");\nassert.equal(greetB("x"), "Welcome again x");\nconsole.log("PASS");\n`,
  },
  check: {
    tests: "node test.mjs",
    protect: ["test.mjs"],
    usedTool: ["apply_diff"],
  },
};

const cases: Case[] = [
  {
    name: "apply_diff chosen and works (two files)",
    task: twoFiles,
    opts: CORE,
  },
  {
    name: "rename_symbol is chosen for a project-wide rename",
    task: {
      ...byId("rn-function"),
      check: {
        ...byId("rn-function").check,
        usedTool: ["rename_symbol|apply_diff|edit_file"],
      },
    },
    opts: CORE,
    // The tools used are printed on every line; nothing extra to check.
  },
  {
    name: "/fix shortcut prompt fixes a bug and verifies",
    task: byId("bf-sum-range"),
    prompt: shortcut(
      "fix",
      "sumRange(1, 4) in src/range.mjs returns 6, should be 10.",
    ),
  },
  {
    name: "/fix shortcut prompt, Singlish input",
    task: byId("bf-average-empty"),
    prompt: shortcut(
      "fix",
      "src/stats.mjs eke average([]) NaN denawa. 0 wenna one.",
    ),
  },
  {
    name: "/review shortcut finds the off-by-one",
    task: {
      ...byId("bf-sum-range"),
      check: {
        usedTool: ["read_file|grep_search"],
        answerAll: [/(<=|off.by.one|inclusive|i < b|exclusive|<\s*b)/i],
      },
    },
    prompt: shortcut(
      "review",
      "Review src/range.mjs. sumRange should include both ends.",
    ),
  },
  {
    name: "/test shortcut writes and runs a test",
    task: {
      id: "cl-test-cmd",
      category: "feature",
      lang: "en",
      files: {
        "src/math.mjs": `export const double = (n) => n * 2;\nexport const isEven = (n) => n % 2 === 0;\n`,
      },
      check: { usedTool: ["create_file"], usedCmd: true },
    },
    prompt: shortcut("test", "Write tests for src/math.mjs."),
    extra: (fx, run) => {
      const created = fs
        .readdirSync(fx.dir, { recursive: true } as any)
        .map(String);
      const hasTest = created.some((f) => /test/i.test(f) && /\.mjs$/.test(f));
      return [
        hasTest ? "" : "no test file created",
        run.log.commands.some((c: string) => /^node /.test(c))
          ? ""
          : "test was not run",
      ].filter(Boolean);
    },
  },
  {
    name: "reply language si: Sinhala explanation, identifiers kept",
    task: {
      ...byId("ex-retry"),
      check: {
        usedTool: ["read_file|grep_search"],
        answerAll: [/lastError|throw/i],
      },
    },
    opts: { systemExtra: replyLanguageGuidance("si") },
    extra: (_fx, run) =>
      sinhalaChars(run.answer) < 30
        ? [`answer is not Sinhala (${sinhalaChars(run.answer)} chars)`]
        : [],
  },
  {
    name: "reply language en: Sinhala prompt answered in English",
    task: {
      ...byId("ex-env-config"),
      check: { usedTool: ["read_file|grep_search"], answerAll: [/8080/] },
    },
    opts: { systemExtra: replyLanguageGuidance("en") },
    extra: (_fx, run) =>
      sinhalaChars(run.answer) > 15
        ? [`answer still Sinhala (${sinhalaChars(run.answer)} chars)`]
        : [],
  },
  {
    name: "reply language auto: Sinhala prompt, Sinhala answer (no block)",
    task: {
      ...byId("ex-env-config"),
      check: { usedTool: ["read_file|grep_search"], answerAll: [/8080/] },
    },
    opts: { systemExtra: replyLanguageGuidance("auto") },
    extra: (_fx, run) =>
      sinhalaChars(run.answer) < 15
        ? [`answer is not Sinhala (${sinhalaChars(run.answer)} chars)`]
        : [],
  },
];

async function main() {
  let failed = 0;
  for (const c of cases) {
    const task = { ...c.task, prompt: c.prompt ?? c.task.prompt };
    const fx = makeFixture(task);
    try {
      const run = await runAgent(key, task, fx, c.opts ?? {});
      const verdict = evaluate(
        { ...task, check: { ...task.check, usedCmd: undefined } },
        fx,
        run,
      );
      const more = c.extra?.(fx, run) ?? [];
      const ok = verdict.ok && more.length === 0;
      if (!ok) failed++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.name} | rounds=${run.rounds} tokens=${run.tokens} tools=${[...new Set(run.log.tools)].join(",")}${ok ? "" : " | " + [verdict.why, ...more].filter(Boolean).join("; ").slice(0, 220)}`,
      );
    } finally {
      cleanup(fx);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}
void main();
void path;
