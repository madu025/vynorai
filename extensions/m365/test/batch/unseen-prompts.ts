/**
 * Advanced requests of the kind Copilot handles (running totals, ranks, groupings, dashboards, forecasts, row tests, unsupported things), run exactly like the task pane does:
 * the built-in reader first; when it understands nothing, the real AI model rewrites the request into
 * plain steps that the same reader must understand. Each plan is checked against what the person asked
 * (the right columns and numbers, not just the kind of action). No Excel, no screenshots.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/unseen-prompts.ts [--ai-first] [--verbose]
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
    "u-smallest-items",
    "the 3 item codes with the smallest total issued quantity",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 5 &&
      p.specs.pivot?.topN === 3 &&
      p.specs.pivot?.lowest === true,
  ),
  C(
    "u-worst-rtom",
    "worst 2 RTOMs by requested quantity",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 1 &&
      p.specs.pivot?.values === 6 &&
      p.specs.pivot?.lowest === true,
  ),
  C(
    "u-remove-rows",
    "remove the rows where UoM is km",
    (p) =>
      has(p, "view") &&
      (p.specs.view?.filter?.operator === "!=" ||
        /<>/.test(p.specs.view?.where ?? "")),
    true,
  ),
  C(
    "u-drop-status",
    "get rid of everything with status E",
    (p) =>
      has(p, "view") &&
      (p.specs.view?.filter?.operator === "!=" ||
        /<>/.test(p.specs.view?.where ?? "")),
    true,
  ),
  C(
    "u-three-conds",
    "rows where RTOM is R-HK and Status is S and UoM is Ea",
    (p) =>
      has(p, "view") &&
      /RTOM/.test(p.specs.view?.where ?? "") &&
      /UoM/.test(p.specs.view?.where ?? ""),
  ),
  C(
    "u-or",
    "show me rows with status E or status X",
    (p) => has(p, "view") && /OR\(/.test(p.specs.view?.where ?? ""),
  ),
  C(
    "u-big-orders",
    "orders where requested quantity is over 100",
    (p) =>
      has(p, "view") &&
      (p.specs.view?.filter?.column === 6 ||
        /Requested/.test(p.specs.view?.where ?? "")),
  ),
  C(
    "u-sinhala-top",
    "ඉහළම Issued Quantity ඇති Item Code 5 පෙන්වන්න",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 5 &&
      p.specs.pivot?.topN === 5,
  ),
  C(
    "u-singlish-total",
    "LEA ekak ekakta mulu issued qty eka kiyada",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 2 &&
      p.specs.pivot?.values === 7,
  ),
  C(
    "u-line-trend",
    "draw a line of issued quantity by PAT Complete Date",
    (p) => has(p, "chart") || has(p, "pivot-table"),
  ),
  C(
    "u-stacked",
    "stacked column of issued quantity by RTOM split by Status",
    (p) => has(p, "chart") || has(p, "pivot-table"),
  ),
  C("u-clean-all", "tidy everything: spaces, duplicates, text numbers", (p) =>
    has(p, "clean"),
  ),
  C("u-numbers-text", "some numbers are stored as text, fix them", (p) =>
    has(p, "clean"),
  ),
  C(
    "u-add-two",
    "add Requested Quantity and Issued Quantity in a new column",
    (p) =>
      has(p, "add-column") &&
      (p.specs.addColumn?.operator === "+" ||
        /\+/.test(p.specs.addColumn?.expression ?? "")),
  ),
  C(
    "u-flag",
    "new column Status Text that says Done if Status is S otherwise Pending",
    (p) =>
      has(p, "add-column") && /IF/.test(p.specs.addColumn?.expression ?? ""),
  ),
  C(
    "u-month",
    "I want the month of each PAT Complete Date in a new column",
    (p) => has(p, "add-column"),
  ),
  C(
    "u-pct-of-total",
    "what share of the total issued quantity does each Status have",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 4 &&
      p.specs.pivot?.showAs === "percent-of-total",
  ),
  C("u-describe", "summary statistics for requested and issued quantity", (p) =>
    has(p, "statistics"),
  ),
  C("u-outliers", "are there any strange values in issued quantity", (p) =>
    has(p, "statistics"),
  ),
  C("u-grand", "a dashboard with totals for requested quantity by LEA", (p) =>
    has(p, "dashboard"),
  ),
  C("u-validate", "only allow numbers from 0 to 1000 in Issued Quantity", (p) =>
    has(p, "format"),
  ),
  C(
    "u-pdf",
    "turn this into a pdf for printing",
    (p) => has(p, "export-pdf") || has(p, "export-csv"),
    true,
  ),
  C(
    "u-pivot-no-col",
    "pivot of total issued quantity by Colour",
    () => false,
    true,
  ),
  C("u-ai-chat", "tell me a joke about spreadsheets", () => false, true),
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
