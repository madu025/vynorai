/**
 * Real-user style requests (not the add-in's own templates), run exactly like the task pane does:
 * the built-in reader first; when it understands nothing, the real AI model rewrites the request into
 * plain steps that the same reader must understand. Each plan is checked against what the person asked
 * (the right columns and numbers, not just the kind of action). No Excel, no screenshots.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/custom-prompts.ts [--ai-first] [--verbose]
 * --ai-first skips the reader and always asks the AI (to compare the two ways).
 */
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  excelPlansMatch,
} from "../../src/excel.js";
import { interpretInstruction, looksLikeQuestion } from "../../src/intent.js";
import { createServerExcelPreviewPlan } from "../../../../backend/src/services/m365ExcelPlan.js";
import {
  buildScriptMessages,
  parseScriptResponse,
} from "../../../../backend/src/services/m365Script.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
const aiFirst = process.argv.includes("--ai-first");
const verbose = process.argv.includes("--verbose");

const HEADERS = [
  "Service ID",
  "RTOM",
  "LEA",
  "PAT Complete Date",
  "Status",
  "Item Code",
  "Requested Quantity",
  "Issued Quantity",
  "UoM",
  "Circuit ID",
];
const KINDS = [
  ["text", "identifier"],
  ["text", "category"],
  ["text", "category"],
  ["date", "date"],
  ["text", "category"],
  ["text", "category"],
  ["number", "measure"],
  ["number", "measure"],
  ["text", "category"],
  ["text", "identifier"],
] as const;
const summary = {
  contractVersion: "2026-10-15.excel-analysis.v1",
  rowCount: 520125,
  columnCount: HEADERS.length,
  headerRowCount: 1,
  blankCells: 0,
  columns: HEADERS.map((name, index) => ({
    index,
    name,
    inferredType: KINDS[index][0],
    roleHint: KINDS[index][1],
    nonBlank: 520125,
    blank: 0,
    containsPersonalData: false,
    distinct: KINDS[index][1] === "identifier" ? 100000 : 20,
    duplicateValues: 0,
  })),
};
const rtoms = ["R-HK", "R-GP", "R-HT"];
const rows = Array.from({ length: 200 }, (_, index) => [
  `HK2024${String(index).padStart(6, "0")}`,
  rtoms[index % 3],
  ["HK", "NT", "KPT"][index % 3],
  45720 + (index % 30),
  ["S", "E", "X"][index % 3],
  `OSPACC${String(index % 20).padStart(3, "0")}`,
  (index % 7) + 1,
  (index % 5) + 1,
  index % 9 === 0 ? "km" : "Ea",
  `0112${String(index % 40).padStart(6, "0")}`,
]);
const data: any = {
  workbookId: "w",
  worksheetName: "detail-report",
  address: "A1:J520126",
  values: [HEADERS, ...rows],
  hasHeaders: true,
  sample: { totalRows: 520126, sampledRows: 201 },
};

type Plan = { actions: string[]; specs: any };
interface Case {
  id: string;
  text: string;
  /** What a correct plan looks like; "refuse" means no wrong plan: nothing, or an honest message. */
  ok: (plan: Plan) => boolean;
  refuse?: boolean;
}
const C = (id: string, text: string, ok: Case["ok"], refuse = false): Case => ({
  id,
  text,
  ok,
  refuse,
});
const has = (plan: Plan, kind: string) => plan.actions.includes(kind);
const CASES: Case[] = [
  C(
    "circuit-items-qty",
    "Circuit ID wise item code eka saha qty eka balanna one",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 9 &&
      (p.specs.pivot?.subRows === 5 || p.specs.pivot?.columns === 5) &&
      p.specs.pivot?.values === 7,
  ),
  C(
    "rtom-total",
    "RTOM wise total issued qty",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 1 &&
      p.specs.pivot?.values === 7,
  ),
  C(
    "status-count",
    "how many rows are there for each Status",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 4 &&
      p.specs.pivot?.aggregation === "count",
  ),
  C(
    "top-items",
    "top 10 item codes by issued quantity",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 5 &&
      p.specs.pivot?.values === 7 &&
      p.specs.pivot?.topN === 10,
  ),
  C(
    "avg-item",
    "average issued quantity per item code",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 5 &&
      p.specs.pivot?.aggregation === "average",
  ),
  C(
    "lea-both",
    "total requested and issued by LEA",
    (p) => has(p, "pivot-table") && p.specs.pivot?.rows === 2,
  ),
  C(
    "per-circuit-summary",
    "make a summary with one row per Circuit ID showing the total issued",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 9 &&
      p.specs.pivot?.values === 7,
  ),
  C("chart-status", "chart eka hadanna status wise issued quantity", (p) =>
    has(p, "chart"),
  ),
  C(
    "chart-trend",
    "I want to see the issued quantity trend over time as a line",
    (p) => has(p, "chart") || has(p, "pivot-table"),
  ),
  C(
    "difference-col",
    "add a column showing requested minus issued",
    (p) =>
      has(p, "add-column") &&
      ((p.specs.addColumn?.left === 6 &&
        p.specs.addColumn?.right === 7 &&
        p.specs.addColumn?.operator === "-") ||
        /Requested Quantity.*-.*Issued Quantity/.test(
          JSON.stringify(p.specs.addColumn ?? {}),
        )),
  ),
  C(
    "first-letters",
    "add a column with the first 5 letters of Circuit ID",
    (p) =>
      has(p, "add-column") &&
      /LEFT|first/i.test(JSON.stringify(p.specs.addColumn ?? {})),
  ),
  C("clean-sinhala", "දත්ත ටික පිරිසිදු කරලා දෙන්න", (p) => has(p, "clean")),
  // Removing duplicates by one key column is not offered: an honest "cannot" is the right answer.
  C(
    "clean-dupes",
    "remove blank rows and duplicate Service IDs",
    (p) => has(p, "clean"),
    true,
  ),
  C(
    "dup-highlight",
    "Service ID duplicate ewa hoyala pennanna",
    (p) => has(p, "format") || has(p, "view"),
  ),
  C(
    "sort-big",
    "sort by issued quantity biggest first",
    (p) =>
      has(p, "view") &&
      p.specs.view?.sort?.column === 7 &&
      p.specs.view?.sort?.direction === "desc",
  ),
  C(
    "only-km",
    "UoM eka km wala rows witharak pennanna",
    (p) => has(p, "view") && p.specs.view?.filter?.column === 8,
  ),
  C(
    "filter-two",
    "show only rows where status is S and RTOM is R-HK",
    (p) =>
      has(p, "view") &&
      /Status/.test(p.specs.view?.where ?? "") &&
      /RTOM/.test(p.specs.view?.where ?? ""),
  ),
  C("quality", "give me the data quality report", (p) => has(p, "quality")),
  C("format-nice", "freeze the header and make it look nice", (p) =>
    has(p, "format"),
  ),
  C("forecast", "forecast next quarter issued quantity", (p) =>
    has(p, "statistics"),
  ),
  C(
    "correlation",
    "is there a relationship between requested and issued quantity",
    (p) => has(p, "statistics"),
  ),
  C("dates-fix", "convert all the text dates to real dates", (p) =>
    has(p, "clean"),
  ),
  C(
    "highlight-less",
    "colour the rows where issued is less than requested",
    (p) =>
      has(p, "view") &&
      /Issued Quantity\]\s*<\s*\[Requested Quantity/.test(
        p.specs.view?.where ?? "",
      ),
  ),
  C(
    "distinct-circuits",
    "how many different circuits are there",
    () => false,
    true,
  ),
  C("email", "email me this report every monday", () => false, true),
  C("python", "run a python regression on the quantities", () => false, true),
];

async function ask(text: string) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: "vynor-auto",
      messages: buildScriptMessages(summary, "en", text),
      temperature: 0,
      max_tokens: 1200,
      stream: false,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  try {
    return parseScriptResponse(content);
  } catch (error) {
    if (verbose) console.log(`    raw answer: ${content.slice(0, 300)}`);
    throw error;
  }
}

function plan(text: string): { plan?: Plan; problems: string[] } {
  const interpreted: any = interpretInstruction(text, HEADERS, rows as any);
  let actions = [...(interpreted.actions as string[])];
  if (!actions.length) return { problems: interpreted.problems ?? [] };
  let specs = interpreted.specs ?? {};
  const adapted = adaptForSampledRange(actions as any, specs);
  actions = adapted.actions as string[];
  specs = adapted.specs;
  const local = createExcelPreviewPlan(data, actions as any, 500, specs);
  const server = createServerExcelPreviewPlan(data, actions as any, 500, specs);
  if (!excelPlansMatch(local, server))
    throw new Error("client/server plans differ");
  return { plan: { actions, specs }, problems: [] };
}

let pass = 0;
let viaParser = 0;
let viaAi = 0;
for (const item of CASES) {
  let path = "parser";
  let result: { plan?: Plan; problems: string[] } = { problems: [] };
  let note = "";
  try {
    if (!aiFirst && !looksLikeQuestion(item.text)) result = plan(item.text);
    if (!result.plan) {
      path = "ai";
      const answer = await ask(item.text);
      const steps = answer.steps.map((step) => step.instruction);
      note = steps.join(" | ") || `CANNOT: ${answer.cannot ?? ""}`;
      result = steps.length
        ? plan(steps.join(" then "))
        : { problems: [`cannot: ${answer.cannot ?? ""}`] };
    }
  } catch (error) {
    result = {
      problems: [
        `${(error as Error).message} ${String((error as any).detail ?? "")}`.trim(),
      ],
    };
  }
  if (path === "parser") viaParser += 1;
  else viaAi += 1;
  // A case that may be refused passes when the AI says it cannot, or when its plan is still what was asked.
  const good = result.plan ? item.ok(result.plan) : item.refuse === true;
  if (good) pass += 1;
  const what = result.plan
    ? `${result.plan.actions.join("+")} ${JSON.stringify(result.plan.specs.pivot ?? result.plan.specs.view ?? result.plan.specs.addColumn ?? "").slice(0, 110)}`
    : `no plan (${(result.problems[0] ?? "").slice(0, 80)})`;
  console.log(`${good ? "PASS" : "FAIL"} [${path}] ${item.id}: ${what}`);
  if (!good || verbose) {
    if (note) console.log(`    ai steps: ${note.slice(0, 220)}`);
  }
}
console.log(
  `custom-prompts: ${pass}/${CASES.length} (reader ${viaParser}, AI ${viaAi})${aiFirst ? " [ai-first]" : ""}`,
);
process.exit(pass === CASES.length ? 0 : 1);
