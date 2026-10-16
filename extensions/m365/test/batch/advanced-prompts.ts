/**
 * Advanced requests of the kind Copilot handles (running totals, ranks, groupings, dashboards, forecasts, row tests, unsupported things), run exactly like the task pane does:
 * the built-in reader first; when it understands nothing, the real AI model rewrites the request into
 * plain steps that the same reader must understand. Each plan is checked against what the person asked
 * (the right columns and numbers, not just the kind of action). No Excel, no screenshots.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/advanced-prompts.ts [--ai-first] [--verbose]
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
    "running-total",
    "I need a running total of issued quantity down the sheet",
    (p) =>
      has(p, "add-column") && p.specs.addColumn?.derived === "running-total",
  ),
  C(
    "rank-col",
    "rank the rows by issued quantity",
    (p) => has(p, "add-column") && p.specs.addColumn?.derived === "rank",
  ),
  C(
    "pct-change",
    "show how issued quantity changes in percent from one row to the next",
    (p) =>
      has(p, "add-column") && p.specs.addColumn?.derived === "percent-change",
  ),
  C(
    "moving-avg",
    "3 period moving average of issued quantity",
    (p) =>
      has(p, "add-column") && p.specs.addColumn?.derived === "moving-average",
  ),
  C(
    "group-month",
    "group PAT Complete Date by month",
    (p) => has(p, "add-column") && p.specs.addColumn?.derived === "date-group",
  ),
  C(
    "combine",
    "put Item Code and UoM together in one column called Item Unit",
    (p) => has(p, "add-column") && p.specs.addColumn?.derived === "combine",
  ),
  C("fill-blank", "fill the blank Issued Quantity cells with 0", (p) =>
    has(p, "clean"),
  ),
  C("trim-fix", "trim the spaces and fix the text numbers", (p) =>
    has(p, "clean"),
  ),
  C(
    "pivot-two-values",
    "pivot of total requested and total issued by RTOM",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 1 &&
      (p.specs.pivot?.extraValues?.length ?? 0) >= 1,
  ),
  C(
    "pivot-columns",
    "issued quantity by RTOM across the Status columns",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 1 &&
      p.specs.pivot?.columns === 4,
  ),
  C(
    "pivot-percent",
    "each RTOM as a percentage of total issued quantity",
    (p) =>
      has(p, "pivot-table") && p.specs.pivot?.showAs === "percent-of-total",
  ),
  C(
    "pivot-top3",
    "top 3 RTOMs by issued quantity",
    (p) => has(p, "pivot-table") && p.specs.pivot?.topN === 3,
  ),
  C("column-chart", "column chart of requested quantity per RTOM", (p) =>
    has(p, "chart"),
  ),
  C("pie", "pie chart of issued quantity by Status", (p) => has(p, "chart")),
  C(
    "histogram",
    "show the distribution of issued quantity",
    (p) => has(p, "chart") && p.specs.chart?.chartType === "histogram",
  ),
  C(
    "dashboard",
    "give me a one page dashboard for issued quantity by RTOM",
    (p) => has(p, "dashboard"),
  ),
  C("insights", "find anything unusual in issued quantity", (p) =>
    has(p, "statistics"),
  ),
  C("describe", "give me the min max and average of issued quantity", (p) =>
    has(p, "statistics"),
  ),
  C("correlate", "do requested and issued quantity move together", (p) =>
    has(p, "statistics"),
  ),
  C(
    "forecast6",
    "predict issued quantity for the next 6 periods",
    (p) => has(p, "statistics") && p.specs.statistics?.mode === "forecast",
  ),
  C("color-scale", "colour issued quantity from low to high", (p) =>
    has(p, "format"),
  ),
  C("data-bars", "show data bars for requested quantity", (p) =>
    has(p, "format"),
  ),
  C("dropdown", "make Status a dropdown list", (p) => has(p, "format")),
  C(
    "dup-flag",
    "mark duplicate Circuit IDs",
    (p) => has(p, "format") || has(p, "view"),
  ),
  C("quality", "audit this data for problems", (p) => has(p, "quality")),
  C(
    "top-rows",
    "show the 20 rows with the highest issued quantity",
    (p) => has(p, "view") && p.specs.view?.limit === 20,
  ),
  C(
    "where-and",
    "list rows where RTOM is R-HK and Status is S",
    (p) =>
      has(p, "view") &&
      /RTOM/.test(p.specs.view?.where ?? "") &&
      /Status/.test(p.specs.view?.where ?? ""),
  ),
  C(
    "compare-cols",
    "rows where issued is more than requested",
    (p) =>
      has(p, "view") &&
      /Issued Quantity\]\s*>\s*\[Requested Quantity/.test(
        p.specs.view?.where ?? "",
      ),
  ),
  C("year-col", "add a column Year from the PAT Complete Date", (p) =>
    has(p, "add-column"),
  ),
  C(
    "ratio-col",
    "add a column Fill Rate that is issued divided by requested",
    (p) =>
      has(p, "add-column") &&
      (p.specs.addColumn?.operator === "/" ||
        /\//.test(p.specs.addColumn?.expression ?? "")),
  ),
  C(
    "share-col",
    "add a column with each issued quantity as a share of the total",
    (p) =>
      has(p, "add-column") &&
      /COLSUM/.test(p.specs.addColumn?.expression ?? ""),
  ),
  C("copy", "copy the data to a new sheet", (p) => has(p, "view")),
  C("name-range", "name the Issued Quantity column Issued", (p) =>
    has(p, "named-range"),
  ),
  C("freeze", "freeze the top row and make the header bold", (p) =>
    has(p, "format"),
  ),
  C("slicer", "add a slicer for Status", () => false, true),
  C("sparkline", "add sparklines for each RTOM", () => false, true),
  C("macro", "write a macro that emails the totals", () => false, true),
  C(
    "explain-formula",
    "explain what the formula in this sheet does",
    () => false,
    true,
  ),
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
