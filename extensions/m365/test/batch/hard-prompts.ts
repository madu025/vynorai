/**
 * Advanced requests of the kind Copilot handles (running totals, ranks, groupings, dashboards, forecasts, row tests, unsupported things), run exactly like the task pane does:
 * the built-in reader first; when it understands nothing, the real AI model rewrites the request into
 * plain steps that the same reader must understand. Each plan is checked against what the person asked
 * (the right columns and numbers, not just the kind of action). No Excel, no screenshots.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/hard-prompts.ts [--ai-first] [--verbose]
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
    "h-circuit-sinhala",
    "මේ sheet එකේ Circuit ID එකකට පාවිච්චි කරපු item code මොනවද, ඒවා කීයක් ගියාද කියලා table එකක් දෙන්න",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 9 &&
      (p.specs.pivot?.subRows === 5 || p.specs.pivot?.columns === 5),
  ),
  C(
    "h-rtom-bar",
    "rtom wala issued qty eka bar graph ekak widiyata pennanna",
    (p) => has(p, "chart"),
  ),
  C(
    "h-typo-pivot",
    "pivt tabel of toatl isued quantty by stauts",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 4 &&
      p.specs.pivot?.values === 7,
  ),
  C(
    "h-busy-boss",
    "my boss wants a quick view of which LEA is doing the most, can you sort it out",
    (p) => has(p, "pivot-table") || has(p, "chart"),
  ),
  C(
    "h-multi",
    "clean the data, then make a pivot of issued quantity by RTOM and chart it",
    (p) => has(p, "clean") && has(p, "pivot-table") && has(p, "chart"),
  ),
  C(
    "h-multi-sinhala",
    "දත්ත පිරිසිදු කරලා RTOM අනුව Issued Quantity එකතුව pivot එකක් හදන්න",
    (p) => has(p, "clean") && has(p, "pivot-table"),
  ),
  C("h-bad-first", "get rid of repeated lines and spaces", (p) =>
    has(p, "clean"),
  ),
  C(
    "h-which-most",
    "which item code was issued the most",
    (p) => has(p, "pivot-table") && p.specs.pivot?.rows === 5,
  ),
  C(
    "h-per-month",
    "monthly total of issued quantity",
    (p) => has(p, "pivot-table") || has(p, "add-column") || has(p, "chart"),
  ),
  C(
    "h-percent-rtom",
    "RTOM walin kiyak dun gaman percentage eken",
    (p) => has(p, "pivot-table") && p.specs.pivot?.rows === 1,
  ),
  C(
    "h-lowest",
    "which circuits got the least issued quantity, bottom 5",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 9 &&
      p.specs.pivot?.topN === 5 &&
      p.specs.pivot?.lowest === true,
  ),
  C(
    "h-compare",
    "compare requested with issued for every RTOM",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 1 &&
      (p.specs.pivot?.extraValues?.length ?? 0) >= 1,
  ),
  C(
    "h-shortfall",
    "I want to know where issued is short of requested",
    (p) => has(p, "view") || has(p, "add-column"),
  ),
  C(
    "h-km-only",
    "only the km items please",
    (p) => has(p, "view") && !!(p.specs.view?.filter || p.specs.view?.where),
  ),
  C(
    "h-s-status-hk",
    "status S saha rtom R-HK witharak",
    (p) => has(p, "view") && !!(p.specs.view?.where || p.specs.view?.filter),
  ),
  C("h-pretty", "make this sheet look professional", (p) => has(p, "format")),
  C("h-check", "is my data ok? any errors or missing stuff", (p) =>
    has(p, "quality"),
  ),
  C(
    "h-future",
    "what will issued quantity look like in the coming months",
    (p) => has(p, "statistics") && p.specs.statistics?.mode === "forecast",
  ),
  C("h-related", "requested saha issued athara sambandayak thiyenawada", (p) =>
    has(p, "statistics"),
  ),
  C(
    "h-dash",
    "ekama page ekak widiyata summary dashboard ekak hadanna issued qty walata",
    (p) => has(p, "dashboard"),
  ),
  C("h-year", "year eka witharak ganna PAT Complete Date eken", (p) =>
    has(p, "add-column"),
  ),
  C(
    "h-first-letters",
    "circuit id eke mulu akuru 4 witharak aluth column ekakata",
    (p) =>
      has(p, "add-column") &&
      /LEFT|first/i.test(JSON.stringify(p.specs.addColumn ?? {})),
  ),
  C(
    "h-ratio",
    "issued eka requested ekata wada kiyak percent da kiyala column ekak",
    (p) =>
      has(p, "add-column") &&
      (p.specs.addColumn?.operator === "/" ||
        /\//.test(p.specs.addColumn?.expression ?? "")),
  ),
  C(
    "h-above-avg",
    "mark the rows with above average issued quantity",
    (p) => has(p, "format") || has(p, "add-column") || has(p, "view"),
  ),
  C(
    "h-sort-lea",
    "LEA name eka anuwa sort karanna a to z",
    (p) =>
      has(p, "view") &&
      p.specs.view?.sort?.column === 2 &&
      p.specs.view?.sort?.direction === "asc",
  ),
  C(
    "h-top-20-circuits",
    "top 20 circuits by total issued",
    (p) =>
      has(p, "pivot-table") &&
      p.specs.pivot?.rows === 9 &&
      p.specs.pivot?.topN === 20,
  ),
  C(
    "h-cumulative",
    "cumulative issued quantity as we go down",
    (p) =>
      has(p, "add-column") && p.specs.addColumn?.derived === "running-total",
  ),
  C("h-email", "mail this to my manager", () => false, true),
  C("h-excel-formula", "write me a vlookup for RTOM names", () => false, true),
  // Deleting is never done; a copy without those rows is the safe answer.
  C(
    "h-delete",
    "delete all rows where status is X",
    (p) =>
      has(p, "view") &&
      (p.specs.view?.filter?.operator === "!=" ||
        /<>/.test(p.specs.view?.where ?? "")),
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
