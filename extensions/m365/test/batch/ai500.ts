/**
 * 500 prompts (5 new datasets x 100) through the same path the add-in takes: the built-in reader first,
 * the REAL model (VynorAI gateway, testing key from the environment) when the reader does not understand,
 * and the real model also on every 5th prompt the reader did understand, to compare the two.
 * Every understood prompt must also give a valid preview plan that matches the server's plan. Only column
 * names and types go to the model, never cell values.
 *
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/ai500.ts [--out file.jsonl] [--resume] [--dataset retail] [--limit 20]
 *
 * Output: a JSONL file with one line per prompt and docs/AI500_REPORT.md (summary and every failure).
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchemaSummary } from "../../src/analysis.js";
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  excelPlansMatch,
  selectExcelActions,
} from "../../src/excel.js";
import {
  answerQuestion,
  interpretInstruction,
  looksLikeQuestion,
  normalizeInstruction,
} from "../../src/intent.js";
import { detectMacroRequest, generateMacro } from "../../src/macroGen.js";
import { findUnhandledJobs } from "../../src/workflowCheck.js";
import { createServerExcelPreviewPlan } from "../../../../backend/src/services/m365ExcelPlan.js";
import {
  buildScriptMessages,
  parseScriptResponse,
} from "../../../../backend/src/services/m365Script.js";
import { DATASETS, type Dataset } from "./datasets500.js";
import { buildPrompts, type Prompt } from "./prompts500.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
if (!KEY) {
  console.error(
    "Set VYNORAI_E2E_API_KEY (run with --env-file=../../.env.e2e).",
  );
  process.exit(2);
}
const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const here = dirname(fileURLToPath(import.meta.url));
const outFile = arg("--out") ?? join(here, "ai500-results.jsonl");
const onlyDataset = arg("--dataset");
const limit = Number(arg("--limit") ?? 0);
const resume = process.argv.includes("--resume");
const CONCURRENCY = 3;

type Result = {
  id: string;
  dataset: string;
  family: string;
  text: string;
  mode: Prompt["mode"];
  verdict: "local" | "ai" | "fail";
  detail: string;
  actions?: string[];
  aiChecked?: "agree" | "disagree";
  aiSteps?: string[];
  tokens: number;
  ms: number;
};

const dataFor = (dataset: Dataset) => ({
  workbookId: `w-${dataset.id}`,
  worksheetName: dataset.sheet,
  address: `A1:${String.fromCharCode(64 + dataset.columns.length)}${dataset.rows.length + 1}`,
  values: [dataset.columns.map((column) => column.name), ...dataset.rows],
  hasHeaders: true,
});

function readLocal(text: string, headers: string[], rows: unknown[][]) {
  const normalized = normalizeInstruction(text);
  const interpreted: any = interpretInstruction(
    normalized,
    headers,
    rows as any,
  );
  let actions = [
    ...new Set([
      ...selectExcelActions(normalized),
      ...(interpreted.actions as string[]),
    ]),
  ];
  if (actions.includes("view") && actions.includes("new-sheet"))
    actions = actions.filter((kind) => kind !== "new-sheet");
  return {
    actions,
    specs: interpreted.specs ?? {},
    problems: (interpreted.problems ?? []) as string[],
    normalized,
  };
}

/** Builds the local and server plans and requires them to match. */
function planCheck(
  data: any,
  actions: string[],
  specs: any,
): string | undefined {
  try {
    const local = createExcelPreviewPlan(data, actions as any, 500, specs);
    const server = createServerExcelPreviewPlan(
      data,
      actions as any,
      500,
      specs,
    );
    return excelPlansMatch(local, server)
      ? undefined
      : "client and server plans differ";
  } catch (error) {
    return `plan failed: ${(error as Error).message.slice(0, 140)}`;
  }
}

const meets = (actions: string[], prompt: Prompt) =>
  prompt.expectAny.some((kind) => actions.includes(kind)) &&
  (prompt.expectAll ?? []).every((kind) => actions.includes(kind));

async function askModel(summary: unknown, text: string) {
  const messages = buildScriptMessages(summary, "en", text);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: "vynor-auto",
        messages,
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
    });
    const json: any = await response.json().catch(() => ({}));
    if (response.ok)
      return {
        text: String(json?.choices?.[0]?.message?.content ?? ""),
        tokens: Number(json?.usage?.total_tokens ?? 0),
      };
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 8000 * attempt));
      continue;
    }
    throw new Error(
      `gateway ${response.status}: ${JSON.stringify(json).slice(0, 100)}`,
    );
  }
  throw new Error("gateway: no answer");
}

async function viaModel(
  dataset: Dataset,
  prompt: Prompt,
  summary: unknown,
  data: any,
) {
  const answer = await askModel(summary, prompt.text);
  const parsed = parseScriptResponse(answer.text);
  const steps = parsed.steps.map((step) => step.instruction);
  const joined = steps.join(" then ");
  const read = readLocal(joined, data.values[0], data.values.slice(1));
  const actions = read.actions;
  const ok = meets(actions, prompt);
  const planProblem = ok ? planCheck(data, actions, read.specs) : undefined;
  return {
    ok: ok && !planProblem,
    actions,
    steps,
    tokens: answer.tokens,
    planProblem,
    problems: read.problems,
    dataset,
  };
}

async function runPrompt(
  dataset: Dataset,
  prompt: Prompt,
  index: number,
): Promise<Result> {
  const started = Date.now();
  const data = dataFor(dataset);
  const headers = data.values[0] as string[];
  const rows = data.values.slice(1);
  const base = {
    id: prompt.id,
    dataset: prompt.dataset,
    family: prompt.family,
    text: prompt.text,
    mode: prompt.mode,
  };
  const done = (
    verdict: Result["verdict"],
    detail: string,
    extra: Partial<Result> = {},
  ): Result => ({
    ...base,
    verdict,
    detail,
    tokens: 0,
    ms: Date.now() - started,
    ...extra,
  });

  if (prompt.mode === "macro") {
    if (!detectMacroRequest(prompt.text))
      return done("fail", "not recognised as a code request");
    const made = generateMacro(prompt.text, headers, rows as any);
    return made.ok
      ? done("local", `${made.language}: ${made.steps.length} step(s)`)
      : done("fail", made.problem.slice(0, 140));
  }
  if (prompt.mode === "answer") {
    if (!looksLikeQuestion(prompt.text))
      return done("fail", "not recognised as a question");
    const answer = answerQuestion(prompt.text, headers, rows as any);
    return answer
      ? done("local", answer.answer.slice(0, 80))
      : done("fail", "no deterministic answer");
  }

  const summary = buildSchemaSummary(data as any);
  const read = readLocal(prompt.text, headers, rows);
  if (prompt.mode === "refuse")
    return !read.actions.length && read.problems.length
      ? done("local", `refused: ${read.problems[0].slice(0, 80)}`)
      : done(
          "fail",
          `expected a refusal, got ${read.actions.join("+") || "nothing"}`,
        );
  const localOk = read.actions.length > 0 && meets(read.actions, prompt);
  const unhandled = findUnhandledJobs(read.normalized, read.actions);
  const localPlanProblem = localOk
    ? planCheck(data, read.actions, read.specs)
    : undefined;

  if (localOk && !localPlanProblem && !unhandled.length) {
    // Every 5th understood prompt also goes to the real model, to see where the two disagree.
    if (index % 5 === 0) {
      try {
        const ai = await viaModel(dataset, prompt, summary, data);
        return done("local", `local ${read.actions.join("+")}`, {
          actions: read.actions,
          aiChecked: ai.ok ? "agree" : "disagree",
          aiSteps: ai.ok ? undefined : ai.steps,
          tokens: ai.tokens,
        });
      } catch (error) {
        return done(
          "local",
          `local ${read.actions.join("+")} (model check failed: ${(error as Error).message.slice(0, 60)})`,
          { actions: read.actions },
        );
      }
    }
    return done("local", `local ${read.actions.join("+")}`, {
      actions: read.actions,
    });
  }

  const why =
    localPlanProblem ??
    (unhandled.length
      ? `not in plan: ${unhandled.map((job) => job.label).join(", ")}`
      : read.actions.length
        ? `got ${read.actions.join("+")}`
        : (read.problems[0] ?? "not understood"));
  try {
    const ai = await viaModel(dataset, prompt, summary, data);
    if (ai.ok)
      return done("ai", `reader: ${why}; model gave ${ai.actions.join("+")}`, {
        actions: ai.actions,
        aiSteps: ai.steps,
        tokens: ai.tokens,
      });
    return done(
      "fail",
      `reader: ${why}; model: ${ai.planProblem ?? `got ${ai.actions.join("+") || "nothing"}`}`,
      { actions: ai.actions, aiSteps: ai.steps, tokens: ai.tokens },
    );
  } catch (error) {
    return done(
      "fail",
      `reader: ${why}; model error: ${(error as Error).message.slice(0, 100)}`,
    );
  }
}

function report(results: Result[]) {
  const lines: string[] = [];
  const total = results.length;
  const count = (verdict: Result["verdict"], list = results) =>
    list.filter((r) => r.verdict === verdict).length;
  const tokens = results.reduce((sum, r) => sum + r.tokens, 0);
  lines.push(`# 500-prompt real-model run`, "");
  lines.push(
    `Generated by \`extensions/m365/test/batch/ai500.ts\` (${new Date().toISOString().slice(0, 10)}). Real model through the VynorAI gateway; the reader runs first.`,
    "",
  );
  lines.push(
    `Total ${total}: **${count("local")} understood by the built-in reader**, **${count("ai")} by the real model** after the reader missed, **${count("fail")} failed**. Tokens used: ${tokens.toLocaleString("en-US")}.`,
    "",
  );
  const checked = results.filter((r) => r.aiChecked);
  lines.push(
    `Model cross-check on understood prompts: ${checked.length} checked, ${checked.filter((r) => r.aiChecked === "agree").length} agree, ${checked.filter((r) => r.aiChecked === "disagree").length} disagree.`,
    "",
  );
  lines.push(
    "| dataset | total | reader | model | fail |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const dataset of [...new Set(results.map((r) => r.dataset))]) {
    const list = results.filter((r) => r.dataset === dataset);
    lines.push(
      `| ${dataset} | ${list.length} | ${count("local", list)} | ${count("ai", list)} | ${count("fail", list)} |`,
    );
  }
  lines.push("", "| family | total | fail |", "| --- | ---: | ---: |");
  for (const family of [...new Set(results.map((r) => r.family))].sort()) {
    const list = results.filter((r) => r.family === family);
    const failed = count("fail", list);
    if (failed) lines.push(`| ${family} | ${list.length} | ${failed} |`);
  }
  const failures = results.filter((r) => r.verdict === "fail");
  lines.push("", `## Failures (${failures.length})`, "");
  for (const r of failures) {
    lines.push(`- \`${r.id}\` [${r.family}] "${r.text}": ${r.detail}`);
    if (r.aiSteps?.length)
      lines.push(
        `  - model steps: ${r.aiSteps.map((step) => `"${step}"`).join("; ")}`,
      );
  }
  const disagree = checked.filter((r) => r.aiChecked === "disagree");
  lines.push(
    "",
    `## Model disagreed with a reader-understood prompt (${disagree.length})`,
    "",
  );
  for (const r of disagree)
    lines.push(
      `- \`${r.id}\` "${r.text}": reader ${r.actions?.join("+")}; model steps ${(r.aiSteps ?? []).map((step) => `"${step}"`).join("; ")}`,
    );
  writeFileSync(
    join(here, "../../../../docs/AI500_REPORT.md"),
    lines.join("\n") + "\n",
  );
}

const all: Array<{ dataset: Dataset; prompt: Prompt; index: number }> = [];
for (const dataset of DATASETS) {
  if (onlyDataset && dataset.id !== onlyDataset) continue;
  buildPrompts(dataset).forEach((prompt, index) =>
    all.push({ dataset, prompt, index }),
  );
}
const jobs = limit ? all.slice(0, limit) : all;

const finished = new Map<string, Result>();
if (resume && existsSync(outFile))
  for (const line of readFileSync(outFile, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const r = JSON.parse(line) as Result;
    finished.set(r.id, r);
  }
if (!resume) writeFileSync(outFile, "");

let next = 0;
let completed = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    if (finished.has(job.prompt.id)) continue;
    const result = await runPrompt(job.dataset, job.prompt, job.index);
    finished.set(result.id, result);
    appendFileSync(outFile, JSON.stringify(result) + "\n");
    completed += 1;
    if (completed % 25 === 0) console.log(`${completed}/${jobs.length} done`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const results = jobs.map((job) => finished.get(job.prompt.id)!).filter(Boolean);
report(results);
const failed = results.filter((r) => r.verdict === "fail").length;
console.log(
  `ai500: ${results.length} prompts, reader ${results.filter((r) => r.verdict === "local").length}, model ${results.filter((r) => r.verdict === "ai").length}, fail ${failed}, tokens ${results.reduce((s, r) => s + r.tokens, 0)}`,
);
process.exit(failed ? 1 : 0);
