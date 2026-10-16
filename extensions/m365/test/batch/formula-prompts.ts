/**
 * Formula requests of the kind Copilot writes as SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, UNIQUE: per-group and conditional figures, run exactly like the task pane does:
 * the built-in reader first; when it understands nothing, the real AI model rewrites the request into
 * plain steps that the same reader must understand. Each plan is checked against what the person asked
 * (the right columns and numbers, not just the kind of action). No Excel, no screenshots.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/formula-prompts.ts [--ai-first] [--verbose]
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
const expr = (plan: Plan): string =>
  `${plan.specs.addColumn?.expression ?? ""} ${plan.specs.view?.where ?? ""}`;
const uses = (plan: Plan, pattern: RegExp) => pattern.test(expr(plan));
const CASES: Case[] = [
  C(
    "f-share-in-rtom",
    "add a column with each row's share of its RTOM's total issued quantity",
    (p) =>
      has(p, "add-column") &&
      uses(p, /GROUPSUM\(\s*\[Issued Quantity\]\s*,\s*\[RTOM\]\s*\)/i),
  ),
  C(
    "f-lines-per-circuit",
    "for every row show how many lines its Circuit ID has",
    (p) =>
      has(p, "add-column") && uses(p, /GROUPCOUNT\(\s*\[Circuit ID\]\s*\)/i),
  ),
  C(
    "f-circuit-total",
    "new column with the total issued quantity of the same Circuit ID",
    (p) =>
      has(p, "add-column") &&
      uses(p, /GROUPSUM\(\s*\[Issued Quantity\]\s*,\s*\[Circuit ID\]\s*\)/i),
  ),
  C(
    "f-vs-lea-avg",
    "flag rows whose issued quantity is above the average of their LEA",
    (p) =>
      (has(p, "add-column") || has(p, "view")) &&
      uses(p, /GROUPAVG\(\s*\[Issued Quantity\]\s*,\s*\[LEA\]\s*\)/i),
  ),
  C(
    "f-sumif",
    "what fraction of all issued quantity with status S does each row make up, as a new column",
    (p) =>
      has(p, "add-column") &&
      uses(
        p,
        /COLSUMIF\(\s*\[Issued Quantity\]\s*,\s*\[Status\]\s*,\s*"S"\s*\)/i,
      ),
  ),
  C(
    "f-countif",
    "add a column showing how many rows in total have UoM km",
    (p) =>
      has(p, "add-column") &&
      uses(p, /COLCOUNTIF\(\s*\[UoM\]\s*,\s*"km"\s*\)/i),
  ),
  C(
    "f-distinct",
    "add a column with the number of different item codes in the data",
    (p) =>
      has(p, "add-column") && uses(p, /COLDISTINCT\(\s*\[Item Code\]\s*\)/i),
  ),
  C(
    "f-biggest-in-group",
    "mark the row with the largest issued quantity in each RTOM",
    (p) =>
      (has(p, "add-column") || has(p, "view")) &&
      uses(p, /GROUPMAX\(\s*\[Issued Quantity\]\s*,\s*\[RTOM\]\s*\)/i),
  ),
  C(
    "f-gap-to-group-min",
    "difference between issued quantity and the smallest issued quantity of the same item code",
    (p) =>
      has(p, "add-column") &&
      uses(p, /GROUPMIN\(\s*\[Issued Quantity\]\s*,\s*\[Item Code\]\s*\)/i),
  ),
  C(
    "f-sinhala-group",
    "එක් එක් RTOM එකේ මුළු Issued Quantity එක හැම පේළියකටම අලුත් column එකක පෙන්වන්න",
    (p) =>
      has(p, "add-column") &&
      uses(p, /GROUPSUM\(\s*\[Issued Quantity\]\s*,\s*\[RTOM\]\s*\)/i),
  ),
  C(
    "f-singlish-count",
    "circuit id ekakata lines keeyada kiyala column ekak danna",
    (p) =>
      has(p, "add-column") && uses(p, /GROUPCOUNT\(\s*\[Circuit ID\]\s*\)/i),
  ),
  C(
    "f-avg-if",
    "column comparing each row to the average issued quantity of status S rows",
    (p) =>
      has(p, "add-column") &&
      uses(
        p,
        /COLAVGIF\(\s*\[Issued Quantity\]\s*,\s*\[Status\]\s*,\s*"S"\s*\)/i,
      ),
  ),
  C(
    "f-repeat-ids",
    "show only Service IDs that appear more than once",
    (p) =>
      has(p, "view") && uses(p, /GROUPCOUNT\(\s*\[Service ID\]\s*\)\s*>\s*1/i),
  ),
  C(
    "f-old-still-ok",
    "add a column Gap that is requested quantity minus issued quantity",
    (p) =>
      has(p, "add-column") &&
      (p.specs.addColumn?.operator === "-" || uses(p, /-/)),
  ),
  C(
    "f-old-share",
    "each row's share of the grand total issued quantity",
    (p) =>
      has(p, "add-column") && uses(p, /COLSUM\(\s*\[Issued Quantity\]\s*\)/i),
  ),
  C(
    "f-regression",
    "fit a linear regression of issued on requested quantity",
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
  `formula-prompts: ${pass}/${CASES.length} (reader ${viaParser}, AI ${viaAi})${aiFirst ? " [ai-first]" : ""}`,
);
process.exit(pass === CASES.length ? 0 : 1);
