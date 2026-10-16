/**
 * Headless check of the AI interpreter with the REAL model (no Excel, no screenshots):
 * each free-form request (English, Sinhala, Singlish, vague) goes to the VynorAI gateway with the same
 * prompt the add-in uses, the answer is parsed with the same strict parser, and every step must be read by
 * the add-in's own reader and give a valid preview plan on a 520k-row range. Only column names and types
 * are sent, never cell values. The key comes from the environment only.
 *   node --env-file=.env.e2e --import tsx extensions/m365/test/batch/ai-interpret.ts [--verbose]
 */
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  excelPlansMatch,
} from "../../src/excel.js";
import { interpretInstruction } from "../../src/intent.js";
import { createServerExcelPreviewPlan } from "../../../../backend/src/services/m365ExcelPlan.js";
import {
  buildScriptMessages,
  parseScriptResponse,
} from "../../../../backend/src/services/m365Script.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
if (!KEY) {
  console.error("Set VYNORAI_E2E_API_KEY (run with node --env-file=.env.e2e).");
  process.exit(2);
}
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
const ROLES = [
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
    inferredType: ROLES[index][0],
    roleHint: ROLES[index][1],
    nonBlank: 520125,
    blank: 0,
    containsPersonalData: false,
    distinct: ROLES[index][1] === "identifier" ? 100000 : 20,
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
  "Ea",
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

const CASES: Array<{ id: string; text: string; expect: string }> = [
  {
    id: "singlish-per-circuit",
    text: "Circuit ID ekata use una item code walata samanda list ekak hadala denna, kopamana item kopamana qty use unada kiyala",
    expect: "pivot-table",
  },
  {
    id: "sinhala-per-circuit",
    text: "එක් එක් Circuit ID එකට භාවිත කළ Item Code සහ ඒවායේ ප්‍රමාණය ලැයිස්තුවක් ලෙස දෙන්න",
    expect: "pivot-table",
  },
  {
    id: "vague-best-rtom-chart",
    text: "which RTOM used the most issued quantity? show me as a bar chart",
    expect: "chart",
  },
  {
    id: "clean-sheet",
    text: "this sheet is messy, remove duplicate rows and fix the extra spaces",
    expect: "clean",
  },
  {
    id: "highlight-big",
    text: "mark the rows where Issued Quantity is bigger than 50 so I can see them",
    expect: "format",
  },
  {
    id: "health-check",
    text: "check if there are any problems with this data",
    expect: "quality",
  },
  {
    id: "year-column",
    text: "I need a new column with only the year of PAT Complete Date",
    expect: "add-column",
  },
  {
    id: "forecast",
    text: "predict Issued Quantity for the next 6 periods",
    expect: "statistics",
  },
  {
    id: "status-pie",
    text: "status wise issued quantity eka pie chart ekak widiyata denna",
    expect: "chart",
  },
  {
    id: "share-of-total",
    text: "show each row issued quantity as a percentage of the total issued quantity",
    expect: "add-column",
  },
  {
    id: "above-average-flag",
    text: "add a column that says Above or Below depending on whether issued quantity is over the average",
    expect: "add-column",
  },
  {
    id: "gap-from-average",
    text: "Issued Quantity eka average ekata wada kiyak wenas da kiyala column ekak danna",
    expect: "add-column",
  },
  {
    id: "dashboard",
    text: "make me a dashboard of issued quantity by status",
    expect: "dashboard",
  },
];

async function ask(text: string) {
  const messages = buildScriptMessages(summary, "en", text);
  const res = await fetch(`${BASE}/v1/chat/completions`, {
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
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `gateway ${res.status}: ${JSON.stringify(json).slice(0, 120)}`,
    );
  return {
    text: String(json?.choices?.[0]?.message?.content ?? ""),
    tokens: Number(json?.usage?.total_tokens ?? 0),
    model: String(json?.model ?? ""),
  };
}

/** The same path the task pane takes for the steps: join, read, adapt for a huge range, plan, compare with the server. */
function checkSteps(steps: string[], expect: string): string {
  const text = steps.join(" then ");
  const interpreted: any = interpretInstruction(text, HEADERS, rows as any);
  let actions = [...(interpreted.actions as string[])];
  let specs = interpreted.specs ?? {};
  if (!actions.length)
    return `FAIL reader did not understand the steps: ${(interpreted.problems ?? []).join(" ") || text.slice(0, 100)}`;
  const adapted = adaptForSampledRange(actions as any, specs);
  actions = adapted.actions as string[];
  specs = adapted.specs;
  if (!actions.includes(expect))
    return `FAIL expected ${expect}, got ${actions.join("+")}`;
  try {
    const local = createExcelPreviewPlan(data, actions as any, 500, specs);
    const server = createServerExcelPreviewPlan(
      data,
      actions as any,
      500,
      specs,
    );
    return excelPlansMatch(local, server)
      ? `pass ${actions.join("+")}`
      : "FAIL client and server plans differ";
  } catch (error) {
    return `FAIL plan: ${(error as Error).message.slice(0, 140)}`;
  }
}

let pass = 0;
let tokens = 0;
for (const item of CASES) {
  try {
    const answer = await ask(item.text);
    tokens += answer.tokens;
    const parsed = parseScriptResponse(answer.text);
    const steps = parsed.steps.map((step) => step.instruction);
    const verdict = checkSteps(steps, item.expect);
    if (verdict.startsWith("pass")) pass += 1;
    console.log(
      `${verdict.startsWith("pass") ? "PASS" : "FAIL"} ${item.id}: ${verdict}`,
    );
    if (verbose || !verdict.startsWith("pass"))
      for (const step of steps) console.log(`    step: ${step}`);
  } catch (error) {
    console.log(`FAIL ${item.id}: ${(error as Error).message.slice(0, 200)}`);
  }
}
console.log(
  `ai-interpret: ${pass}/${CASES.length} passed, ${tokens} tokens in total`,
);
process.exit(pass === CASES.length ? 0 : 1);
