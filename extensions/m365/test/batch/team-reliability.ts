/**
 * Live check of the agent team's reviewers: given staged changes that are wrong, do they say FIX
 * (true positives); given changes that are right, do they say OK (no false alarm)?
 *
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/team-reliability.ts [--runs N]
 *
 * Each scenario is shown to the real accuracy and coverage reviewers N times (default 2); the verdicts
 * of the two reviewers are merged like the team does. Nothing is written anywhere: the workbook is a
 * small in-memory "Data" sheet. Exits 1 when the catch rate is below 80% or false alarms above 25%.
 */
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
} from "../../../../backend/src/services/m365Agent.js";
import {
  PersonalMask,
  runAgent,
  type AgentHost,
  type AgentMessage,
  type AgentRun,
  type StagedChange,
} from "../../src/agent.js";
import {
  REVIEW_FOCUSES,
  REVIEW_MAX_TURNS,
  mergeIssues,
  parseReview,
  reviewRequest,
} from "../../src/agentReview.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > 0 ? Number(process.argv[runsArg + 1]) || 2 : 2;

const HEADER = ["Region", "Amount", "Cost"];
const DATA: (string | number)[][] = [
  ["West", 120, 70],
  ["West", 80, 50],
  ["East", 200, 120],
  ["East", 50, 30],
  ["North", 90, 60],
  ["North", 300, 180],
  ["South", 60, 40],
  ["South", 110, 65],
  ["West", 70, 45],
  ["East", 40, 25],
];
const SHEET = [HEADER, ...DATA];
const letter = (n: number) => String.fromCharCode(65 + n);

const host: AgentHost = {
  getWorkbook: async () => ({
    activeSheet: "Data",
    selection: "A1",
    sheets: [{ name: "Data", usedRange: "A1:C11", rows: 11, columns: 3 }],
    tables: [],
    data: {
      sheet: "Data",
      address: "A1:C11",
      headerRow: 1,
      dataRows: 10,
      columns: HEADER.map((name, i) => ({
        letter: letter(i),
        name,
        type: i === 0 ? "text" : "number",
      })),
      firstRows: DATA.slice(0, 3),
    },
  }),
  readRange: async (_sheet, address) => {
    const m = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(address);
    if (!m) return { address, values: SHEET };
    const c1 = m[1].charCodeAt(0) - 65;
    const r1 = Number(m[2]) - 1;
    const c2 = (m[3] ?? m[1]).charCodeAt(0) - 65;
    const r2 = Number(m[4] ?? m[2]) - 1;
    return {
      address,
      values: SHEET.slice(r1, r2 + 1).map((row) => row.slice(c1, c2 + 1)),
    };
  },
  calculate: async (formula) => {
    const sum = /^=SUM\('?Data'?!([A-C])2:\1(\d+)\)$/i.exec(formula);
    if (sum) {
      const col = sum[1].toUpperCase().charCodeAt(0) - 65;
      const last = Number(sum[2]);
      return [[DATA.slice(0, last - 1).reduce((t, r) => t + Number(r[col]), 0)]];
    }
    return [["not available here: use read_range"]];
  },
  checkStep: async () => ({ ok: true, understood: "ok" }),
  getDetails: async () => [],
};

const stage = (change: StagedChange) => ({ callId: "x", change });
const action = (tool: string, args: Record<string, unknown>) =>
  stage({ kind: "excel_action", tool, args } as StagedChange);

interface Scenario {
  id: string;
  request: string;
  expect: "FIX" | "OK";
  reply: string;
  changes: { callId: string; change: StagedChange }[];
}
const SCENARIOS: Scenario[] = [
  {
    id: "bad-range-misses-last-row",
    request: "Add a total under the Amount column",
    expect: "FIX",
    reply: "Added a total.",
    changes: [
      stage({ kind: "write_values", sheet: "Data", cell: "A12", values: [["Total"]] }),
      stage({ kind: "write_formula", sheet: "Data", cell: "B12", formula: "=SUM(B2:B10)" }),
    ],
  },
  {
    id: "bad-overwrites-existing-data",
    request: "Add a total under the Amount column",
    expect: "FIX",
    reply: "Added a total.",
    changes: [
      stage({ kind: "write_values", sheet: "Data", cell: "A2", values: [["Total", 1120]] }),
    ],
  },
  {
    id: "bad-wrong-column",
    request: "Add a total under the Amount column",
    expect: "FIX",
    reply: "Added a total.",
    changes: [
      stage({ kind: "write_values", sheet: "Data", cell: "A12", values: [["Total"]] }),
      stage({ kind: "write_formula", sheet: "Data", cell: "B12", formula: "=SUM(C2:C11)" }),
    ],
  },
  {
    id: "bad-missing-part-of-request",
    request: "Summarize Amount by Region on a new sheet and add a column chart of it",
    expect: "FIX",
    reply: "Created the summary.",
    changes: [
      stage({ kind: "create_sheet", name: "Summary" }),
      stage({
        kind: "write_formula",
        sheet: "Summary",
        cell: "A2",
        formula: "=GROUPBY(Data!A2:A11,Data!B2:B11,SUM,0,0)",
        header: "Region",
      }),
    ],
  },
  {
    id: "bad-destructive-for-a-highlight",
    request: "Highlight the rows where Amount is over 100",
    expect: "FIX",
    reply: "Handled the rows over 100.",
    changes: [
      action("delete_rows_where", {
        sheet: "Data",
        address: "A1:C11",
        conditions: [{ column: "Amount", operator: ">", value: 100 }],
      }),
    ],
  },
  {
    id: "bad-hardcoded-total",
    request: "Add a live total under the Amount column that updates when the numbers change",
    expect: "FIX",
    reply: "Added the total.",
    changes: [
      stage({ kind: "write_values", sheet: "Data", cell: "A12", values: [["Total", 1120]] }),
    ],
  },
  {
    id: "good-total",
    request: "Add a total under the Amount column",
    expect: "OK",
    reply: "- Total in B12.",
    changes: [
      stage({ kind: "write_values", sheet: "Data", cell: "A12", values: [["Total"]] }),
      stage({ kind: "write_formula", sheet: "Data", cell: "B12", formula: "=SUM(B2:B11)" }),
    ],
  },
  {
    id: "good-highlight",
    request: "Highlight the rows where Amount is over 100",
    expect: "OK",
    reply: "- Highlighted rows over 100.",
    changes: [
      action("conditional_format", {
        sheet: "Data",
        address: "A2:C11",
        rule: "formula",
        formula: "=$B2>100",
        fill: "#FFF2CC",
      }),
    ],
  },
  {
    id: "good-summary-sheet",
    request: "Summarize Amount by Region on a new sheet",
    expect: "OK",
    reply: "- Summary sheet created.",
    changes: [
      stage({ kind: "create_sheet", name: "Summary" }),
      stage({ kind: "write_values", sheet: "Summary", cell: "A1", values: [["Region", "Total Amount"]] }),
      stage({
        kind: "write_formula",
        sheet: "Summary",
        cell: "A2",
        formula: "=GROUPBY(Data!A2:A11,Data!B2:B11,SUM,0,0)",
      }),
    ],
  },
  {
    id: "good-freeze",
    request: "Freeze the header row",
    expect: "OK",
    reply: "- Header row frozen.",
    changes: [action("sheet_action", { action: "freeze_rows", sheet: "Data", value: 1 })],
  },
];

async function model(messages: AgentMessage[]) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: "vynor-auto",
          messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPT },
            { role: "system", content: "The person writes English." },
            ...messages,
          ],
          tools: AGENT_TOOLS,
          tool_choice: "auto",
          temperature: 0,
          max_tokens: 2500,
          stream: false,
          vynor_surface: "m365",
        }),
      });
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (res.status === 429 || res.status === 503 || res.status === 502) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`gateway ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    const choice = json.choices?.[0]?.message ?? {};
    return { content: String(choice.content ?? ""), tool_calls: choice.tool_calls ?? [] };
  }
  throw new Error("gateway kept failing");
}

/** The verdict of both reviewers, merged the way the team merges them. */
async function verdict(scenario: Scenario): Promise<{ fix: boolean; issues: string[] }> {
  const run: Pick<AgentRun, "changes" | "reply"> = {
    changes: scenario.changes,
    reply: scenario.reply,
  };
  const verdicts = [];
  for (const focus of REVIEW_FOCUSES) {
    const reviewer = await runAgent({
      request: reviewRequest(scenario.request, run, focus),
      host,
      model,
      mask: new PersonalMask(),
      maxTurns: REVIEW_MAX_TURNS,
    });
    verdicts.push({ focus, ...parseReview(reviewer.reply) });
  }
  const issues = mergeIssues(verdicts);
  return { fix: issues.length > 0, issues };
}

let caught = 0;
let bad = 0;
let alarms = 0;
let good = 0;
for (const scenario of SCENARIOS) {
  const answers: boolean[] = [];
  let sample: string[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    try {
      const v = await verdict(scenario);
      answers.push(v.fix);
      if (v.fix && !sample.length) sample = v.issues;
    } catch (error) {
      console.log(`  error ${scenario.id}: ${(error as Error).message}`);
    }
  }
  const fixes = answers.filter(Boolean).length;
  if (scenario.expect === "FIX") {
    bad += answers.length;
    caught += fixes;
  } else {
    good += answers.length;
    alarms += fixes;
  }
  const ok = scenario.expect === "FIX" ? fixes === answers.length : fixes === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${scenario.id}: expected ${scenario.expect}, said FIX ${fixes}/${answers.length}${sample.length && scenario.expect === "OK" ? ` — ${sample[0].slice(0, 120)}` : ""}`,
  );
}
const catchRate = bad ? caught / bad : 1;
const alarmRate = good ? alarms / good : 0;
console.log(
  `team-reliability: caught ${caught}/${bad} wrong plans (${Math.round(catchRate * 100)}%), false alarms ${alarms}/${good} (${Math.round(alarmRate * 100)}%)`,
);
process.exit(catchRate >= 0.8 && alarmRate <= 0.25 ? 0 : 1);
