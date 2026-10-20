/**
 * The Excel agent with the real model (DeepSeek through the VynorAI gateway, the same "m365" surface,
 * system prompt and tools the add-in uses) against a fake 520k-row workbook. It checks what the agent
 * DOES: which tools it calls, which formulas it writes, what it stages, what it refuses. Values from
 * `calculate` are stand-ins (no Excel here); the live add-in checks real values.
 *   cd extensions/m365 && npx tsx --env-file=../../.env.e2e test/batch/agent-prompts.ts [--verbose] [--only id,id]
 */
import {
  PersonalMask,
  runAgent,
  type AgentHost,
  type AgentMessage,
  type AgentRun,
} from "../../src/agent.js";
import { describeReview, runTeam } from "../../src/agentReview.js";
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
} from "../../src/excel.js";
import { interpretInstruction } from "../../src/intent.js";
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
} from "../../../../backend/src/services/m365Agent.js";
import { FAKE_ROWS, fakeCalculator } from "./fakeExcel.js";
import { NODE_PRELUDE, nodeSandboxWorker } from "./nodeSandbox.js";
import {
  runSandboxedCode,
  splitHeaders,
  workerSource,
} from "../../src/codeSandbox.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
const verbose = process.argv.includes("--verbose");
// --review: the agent team (agentReview.ts): a planner, the builder, two reviewers, one correction.
const reviewOn = process.argv.includes("--review");
// --trace (with --review): print what each agent of the team did, for a smoke test.
const trace = process.argv.includes("--trace");
const reviews = { ok: 0, fix: 0, revised: 0, planned: 0 };
const onlyArg = process.argv.indexOf("--only");
const only =
  onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : undefined;

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
const TYPES = [
  "text",
  "text",
  "text",
  "date",
  "text",
  "text",
  "number",
  "number",
  "text",
  "text",
];
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

type Seen = { name: string; args: any }[];
const calculate = fakeCalculator(rows);
const expectedTotal = (
  calculate("=SUM('detail-report'!H2:H520126)") as number[][]
)[0][0];
const topRtom = String(
  (
    calculate(
      "=SORT(GROUPBY('detail-report'!B2:B520126,'detail-report'!G2:G520126,SUM))",
    ) as any[][]
  )[0][0],
);
/** A number as the reply may write it: 1,234,567 or 1234567. */
/** Median Issued Quantity per RTOM, worked out here to check the run_code task. */
const medians = (() => {
  const byRtom = new Map<string, number[]>();
  for (let index = 0; index < FAKE_ROWS; index += 1) {
    const row = rows[index % rows.length];
    const list = byRtom.get(String(row[1])) ?? [];
    list.push(Number(row[7]));
    byRtom.set(String(row[1]), list);
  }
  return [...byRtom].map(([rtom, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    return { rtom, median };
  });
})();
const numberIn = (reply: string, value: number) =>
  reply.replace(/,/g, "").includes(String(value));
const host = (seen: Seen): AgentHost => ({
  getWorkbook: async () => ({
    activeSheet: "detail-report",
    selection: "A1",
    sheets: [
      {
        name: "detail-report",
        usedRange: "A1:J520126",
        rows: 520126,
        columns: 10,
      },
      { name: "Pivot", usedRange: "A3:B30", rows: 28, columns: 2 },
      { name: "Model", usedRange: "A1:B5", rows: 5, columns: 2 },
    ],
    tables: [],
    data: {
      sheet: "detail-report",
      address: "A1:J520126",
      headerRow: 1,
      dataRows: 520125,
      columns: HEADERS.map((name, index) => ({
        letter: String.fromCharCode(65 + index),
        name,
        type: TYPES[index],
      })),
      firstRows: rows.slice(0, 3),
    },
  }),
  readRange: async (sheet, address, withFormulas) => {
    if (sheet === "Model")
      return {
        address: "A1:B5",
        values: [
          ["Price", 10],
          ["Units", 50],
          ["Cost", 300],
          ["", ""],
          ["Profit", 200],
        ],
        ...(withFormulas
          ? {
              formulas: [
                ["Price", 10],
                ["Units", 50],
                ["Cost", 300],
                ["", ""],
                ["Profit", "=B1*B2-B3"],
              ],
            }
          : {}),
      };
    // Like Excel: only the asked columns, and "" for cells past the data (K2 is empty here).
    const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(address);
    const column = (letters: string) =>
      [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const top = match ? Number(match[2]) : 1;
    const bottom = match ? Number(match[4] ?? match[2]) : 1;
    const first = match ? column(match[1]) : 0;
    const last = match ? column(match[3] ?? match[1]) : HEADERS.length - 1;
    const all = [HEADERS, ...rows];
    const values = all
      .slice(top - 1, Math.min(bottom, all.length))
      .map((row) =>
        Array.from(
          { length: last - first + 1 },
          (_, index) => row[first + index] ?? "",
        ),
      );
    return {
      address,
      values,
      // The data sheet holds values only, so its formulas read back as the values.
      ...(withFormulas ? { formulas: values } : {}),
    };
  },
  calculate: async (formula) => calculate(formula),
  // The same sandbox as the add-in, in a Node worker, over the same rows calculate sees
  // (the 200 sample rows repeated to FAKE_ROWS, like fakeCalculator).
  runCode: async ({ areas, code, hasHeaders }) => {
    const parts = areas.map((area) => {
      const match = /^([A-J])(\d*)(?::([A-J])(\d*))?$/.exec(area);
      if (!match) throw new Error(`${area} is outside the data.`);
      const first = match[1].charCodeAt(0) - 65;
      const last = (match[3] ?? match[1]).charCodeAt(0) - 65;
      const top = match[2] ? Number(match[2]) : 1;
      const bottom = Math.min(
        match[4] ? Number(match[4]) : FAKE_ROWS + 1,
        FAKE_ROWS + 1,
      );
      return { first, last, top, bottom };
    });
    const { top, bottom } = parts[0];
    if (parts.some((part) => part.top !== top || part.bottom !== bottom))
      return { error: "The ranges must cover the same rows." };
    const values: unknown[][] = [];
    for (let row = top; row <= bottom; row += 1) {
      const source = row === 1 ? HEADERS : rows[(row - 2) % rows.length];
      values.push(
        parts.flatMap((part) => source.slice(part.first, part.last + 1)),
      );
    }
    const outcome = await runSandboxedCode(
      { ...splitHeaders(values, hasHeaders), code },
      { createWorker: nodeSandboxWorker, source: workerSource(NODE_PRELUDE) },
    );
    return outcome.ok
      ? {
          result: outcome.result,
          rows_read: values.length - (hasHeaders ? 1 : 0),
        }
      : { error: outcome.error };
  },
  getDetails: async (what) =>
    ({
      pivots: [
        {
          sheet: "Pivot",
          pivot: "PivotTable1",
          rows: ["RTOM"],
          columns: [],
          values: ["Sum of Issued Quantity"],
          filters: [],
        },
      ],
      charts: [{ sheet: "Pivot", chart: "Chart 1", type: "ColumnClustered" }],
      tables: [],
      names: [],
      comments: [],
      freeze: { frozen: null },
      autofilter: { enabled: false },
    })[what] ?? [],
  checkStep: async (instruction) => {
    const interpreted: any = interpretInstruction(
      instruction,
      HEADERS,
      rows as any,
    );
    let actions = [...(interpreted.actions as string[])];
    if (!actions.length)
      return {
        ok: false,
        error: interpreted.problems?.[0] ?? "No action found.",
      };
    try {
      const adapted = adaptForSampledRange(
        actions as any,
        interpreted.specs ?? {},
      );
      actions = adapted.actions as string[];
      createExcelPreviewPlan(data, actions as any, 500, adapted.specs);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    return { ok: true, understood: actions.join(", ") };
  },
});

let calls = 0;
const usage = { prompt: 0, cached: 0, completion: 0 };
async function model(messages: AgentMessage[], language: string) {
  calls += 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          model: "vynor-auto",
          messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPT },
            {
              role: "system",
              content:
                language === "si"
                  ? "The person writes Sinhala (සිංහල) or Singlish: reply in Sinhala script."
                  : "The person writes English.",
            },
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
      // A dropped connection (proxy, Wi-Fi): wait and try again.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `gateway ${res.status} ${JSON.stringify(json).slice(0, 160)}`,
      );
    usage.prompt += Number(json?.usage?.prompt_tokens) || 0;
    usage.cached +=
      Number(
        json?.usage?.prompt_cache_hit_tokens ??
          json?.usage?.prompt_tokens_details?.cached_tokens,
      ) || 0;
    usage.completion += Number(json?.usage?.completion_tokens) || 0;
    const message = json?.choices?.[0]?.message ?? {};
    return {
      content: typeof message.content === "string" ? message.content : "",
      tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    };
  }
  throw new Error("gateway 429 three times");
}

type Check = (run: AgentRun, seen: Seen) => string | true;
interface Case {
  id: string;
  text: string;
  language?: "en" | "si";
  check: Check;
}
const formulas = (run: AgentRun, seen: Seen) => [
  ...seen
    .filter((s) => s.name === "calculate")
    .map((s) => String(s.args.formula ?? "")),
  ...run.changes.flatMap((c) =>
    c.change.kind === "write_formula" ? [c.change.formula] : [],
  ),
];
/** Arguments of staged workbook-object actions of one tool. */
const action = (run: AgentRun, tool: string): any[] =>
  run.changes.flatMap((c) =>
    c.change.kind === "excel_action" && c.change.tool === tool
      ? [c.change.args]
      : [],
  );
const kinds = (run: AgentRun) => run.changes.map((c) => c.change.kind);
const steps = (run: AgentRun) =>
  run.changes.flatMap((c) =>
    c.change.kind === "vynor_step" ? [c.change.instruction] : [],
  );
const all = (...checks: (string | true)[]) =>
  checks.find((c) => c !== true) ?? true;
const need = (ok: boolean, why: string) => (ok ? true : why);
const noChanges = (run: AgentRun) =>
  need(run.changes.length === 0, `staged ${kinds(run).join(",")}`);
const usedCalc = (seen: Seen) =>
  need(
    seen.some((s) => s.name === "calculate"),
    "no calculate",
  );

const CASES: Case[] = [
  {
    id: "a-total",
    text: "what is the total issued quantity?",
    check: (run, seen) =>
      all(
        usedCalc(seen),
        noChanges(run),
        need(
          formulas(run, seen).some((f) => /SUM\(/i.test(f) && /H/.test(f)),
          "no SUM over H",
        ),
        need(
          numberIn(run.reply, expectedTotal),
          `reply lacks ${expectedTotal}`,
        ),
      ),
  },
  {
    id: "a-top-rtom",
    text: "which RTOM has the highest requested quantity in total?",
    check: (run, seen) =>
      all(
        usedCalc(seen),
        noChanges(run),
        need(run.reply.includes(topRtom), `reply lacks ${topRtom}`),
      ),
  },
  {
    id: "a-code-median",
    text: "for each RTOM, what is the median issued quantity, and how many rows are more than twice that median?",
    check: (run, seen) =>
      all(
        noChanges(run),
        need(
          seen.some((s) => s.name === "run_code" || s.name === "calculate"),
          "no calculation",
        ),
        ...medians.map(({ rtom, median }) =>
          need(
            run.reply.includes(rtom) && numberIn(run.reply, median),
            `reply lacks ${rtom} median ${median}`,
          ),
        ),
      ),
  },
  {
    id: "a-count-si",
    language: "si",
    text: "Status S තියෙන rows කීයද?",
    check: (run, seen) =>
      all(
        usedCalc(seen),
        noChanges(run),
        need(
          formulas(run, seen).some(
            (f) => /COUNTIFS?\(/i.test(f) && /"S"/.test(f),
          ),
          "no COUNTIF S",
        ),
        need(/[඀-෿]/.test(run.reply), "reply not Sinhala"),
      ),
  },
  {
    id: "a-gap-column",
    text: "add a column Gap with requested minus issued quantity",
    check: (run, seen) => {
      const write = run.changes.find((c) => c.change.kind === "write_formula")
        ?.change as any;
      const step = steps(run).join(" ");
      if (write)
        return all(
          need(
            /G/.test(write.formula) && /H/.test(write.formula),
            `formula ${write.formula}`,
          ),
          need(
            !write.fillRange || !/SUMIFS|COUNTIFS/i.test(write.formula),
            "per-row whole-column formula",
          ),
        );
      return need(/add a column/i.test(step), `no write (${kinds(run)})`);
    },
  },
  {
    id: "a-pivot-chart",
    text: "pivot of total issued quantity by RTOM and a column chart of it",
    check: (run) =>
      need(
        (steps(run).some((s) => /pivot/i.test(s)) ||
          run.changes.some((c) =>
            /GROUPBY|PIVOTBY/i.test(String((c.change as any).formula ?? "")),
          )) &&
          run.changes.some(
            (c) =>
              c.change.kind === "create_chart" ||
              steps(run).some((s) => /chart/i.test(s)),
          ),
        `steps ${steps(run).join(" | ")}`,
      ),
  },
  {
    id: "a-sort",
    text: "sort my data by issued quantity, largest first",
    check: (run) => {
      const sort = run.changes.find((c) => c.change.kind === "sort_range")
        ?.change as any;
      if (sort)
        return need(
          /issued/i.test(sort.column) && sort.descending === true,
          JSON.stringify(sort),
        );
      return need(
        steps(run).some((s) => /sort/i.test(s)),
        `no sort (${kinds(run)})`,
      );
    },
  },
  {
    id: "a-header-format",
    text: "make the header row bold with a light yellow fill",
    check: (run) => {
      const format = run.changes.find((c) => c.change.kind === "format_range")
        ?.change as any;
      return need(
        Boolean(
          format &&
            format.bold === true &&
            format.fill &&
            /^A1:J1$/i.test(format.address),
        ),
        JSON.stringify(format ?? kinds(run)),
      );
    },
  },
  {
    id: "a-lea-summary",
    text: "create a new sheet LEA Summary with the total issued quantity for each LEA",
    check: (run, seen) => {
      if (steps(run).some((s) => /pivot/i.test(s) && /LEA/.test(s)))
        return true;
      return all(
        need(kinds(run).includes("create_sheet"), "no new sheet"),
        need(
          formulas(run, seen).some((f) => /GROUPBY|PIVOTBY|UNIQUE/i.test(f)),
          "no group formula",
        ),
      );
    },
  },
  {
    id: "a-share-rtom",
    text: "add a column with each row's share of its RTOM's total issued quantity",
    check: (run) => {
      const write = run.changes.find((c) => c.change.kind === "write_formula")
        ?.change as any;
      if (write)
        return need(
          !(write.fillRange && /SUMIFS/i.test(write.formula)),
          `slow per-row SUMIFS over 520k rows: ${write.formula}`,
        );
      return need(
        steps(run).some((s) => /GROUPSUM|share/i.test(s)),
        `nothing staged (${kinds(run)})`,
      );
    },
  },
  {
    id: "a-busy-circuits",
    text: "list the circuit IDs that have more than 5 lines, on a new sheet",
    check: (run, seen) =>
      need(
        run.changes.length > 0 &&
          (formulas(run, seen).some((f) =>
            /FILTER|GROUPBY|COUNTIFS|UNIQUE/i.test(f),
          ) ||
            steps(run).some((s) => /Circuit ID/.test(s))),
        `changes ${kinds(run)}`,
      ),
  },
  {
    id: "a-explain",
    text: "explain what the formula in K2 does",
    check: (_run, seen) =>
      need(
        seen.some((s) => s.name === "read_range" && s.args.formulas === true),
        "did not read formulas",
      ),
  },
  {
    id: "a-web",
    text: "get today's USD exchange rate from the internet into a cell",
    check: (run) => all(noChanges(run), need(run.reply.length > 0, "no reply")),
  },
  {
    id: "a-email",
    text: "email this sheet to my manager",
    check: (run) => all(noChanges(run), need(run.reply.length > 0, "no reply")),
  },
  {
    id: "a-delete-rows",
    text: "delete all rows where status is X",
    check: (run) =>
      need(
        run.changes.length === 0 ||
          steps(run).some((s) => /!=|<>|not/i.test(s)) ||
          formulas(run, []).some((f) => /<>"X"/i.test(f)) ||
          action(run, "delete_rows_where").some((a) =>
            a.conditions?.some(
              (c: any) =>
                /status/i.test(c.column) &&
                c.operator === "=" &&
                c.value === "X",
            ),
          ),
        `unsafe: ${JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200)}`,
      ),
  },
  {
    id: "a-month-trend",
    text: "show me how issued quantity changes month by month as a line chart",
    check: (run, seen) => {
      const chart = run.changes.find((c) => c.change.kind === "create_chart")
        ?.change as any;
      if (chart)
        return all(
          need(/^line/.test(chart.chartType), `chart ${chart.chartType}`),
          need(
            formulas(run, seen).some(
              (f) =>
                /GROUPBY|PIVOTBY/i.test(f) && /EOMONTH|MONTH|TEXT\(/i.test(f),
            ),
            "no monthly GROUPBY",
          ),
        );
      return need(
        steps(run).some((s) => /line/i.test(s)),
        `steps ${steps(run).join(" | ")} ${kinds(run)}`,
      );
    },
  },
  {
    id: "a-singlish",
    language: "si",
    text: "item code ekakata issued qty eka wadiyenma tiyena 5 pennanna",
    check: (run, seen) =>
      need(
        steps(run).some((s) => /top 5/i.test(s) && /Item Code/i.test(s)) ||
          (usedCalc(seen) === true && /OSPACC|R-HK/.test(run.reply)),
        `steps ${steps(run).join(" | ")} reply ${run.reply.slice(0, 80)}`,
      ),
  },
  {
    id: "n-delete-inplace",
    text: "remove every row with status X from the data itself, not a copy",
    check: (run) =>
      need(
        action(run, "delete_rows_where").some((a) =>
          a.conditions?.some(
            (c: any) =>
              /status/i.test(c.column) && c.operator === "=" && c.value === "X",
          ),
        ),
        `changes ${kinds(run)} ${JSON.stringify(run.changes.map((c) => c.change)).slice(0, 160)}`,
      ),
  },
  {
    id: "n-autofilter",
    text: "filter the data so only R-HK rows are visible",
    check: (run) =>
      need(
        action(run, "filter_range").some(
          (a) => /rtom/i.test(a.column) && (a.values ?? []).includes("R-HK"),
        ) || steps(run).some((s) => /R-HK/.test(s)),
        `changes ${kinds(run)}`,
      ),
  },
  {
    id: "n-freeze",
    text: "freeze the header row",
    check: (run) =>
      need(
        action(run, "sheet_action").some(
          (a) => a.action === "freeze_rows" && a.value === 1,
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-rename-sheet",
    text: "rename the sheet detail-report to Lines 2025 and make its tab green",
    check: (run) =>
      all(
        need(
          action(run, "sheet_action").some(
            (a) => a.action === "rename" && a.value === "Lines 2025",
          ),
          "no rename",
        ),
        need(
          action(run, "sheet_action").some((a) => a.action === "tab_color"),
          "no tab colour",
        ),
      ),
  },
  {
    id: "n-row-highlight",
    text: "on my data, highlight the whole row in light red when the status is X",
    check: (run) =>
      need(
        action(run, "conditional_format").some(
          (a) =>
            a.rule === "formula" &&
            /\$E/i.test(a.formula ?? "") &&
            /"X"/.test(a.formula ?? ""),
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-cf-above",
    text: "colour issued quantity cells above 4 in red directly on the data",
    check: (run) =>
      need(
        action(run, "conditional_format").some(
          (a) =>
            a.rule === "greater_than" &&
            Number(a.value) === 4 &&
            /^H/i.test(a.address),
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-dropdown",
    text: "add a dropdown with S, E and X to the Status column",
    check: (run) =>
      need(
        action(run, "data_validation").some(
          (a) =>
            a.rule === "list" &&
            /^E/i.test(a.address) &&
            ["S", "E", "X"].every((v) => (a.values ?? []).includes(v)),
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-table",
    text: "turn my data into an Excel table named Lines",
    check: (run) =>
      need(
        action(run, "table_action").some(
          (a) => a.action === "create" && a.name === "Lines",
        ) || steps(run).some((s) => /table/i.test(s)),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-name",
    text: "create a name TaxRate that equals 15%",
    check: (run) =>
      need(
        action(run, "named_range").some(
          (a) =>
            a.action === "add" &&
            a.name === "TaxRate" &&
            /0\.15|15%/.test(a.refers_to),
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-pivot-pct",
    text: "change PivotTable1 to show the values as a percent of the grand total",
    check: (run) =>
      need(
        action(run, "pivot_action").some(
          (a) => a.action === "show_as" && a.value === "percent_of_grand_total",
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-chart-edit",
    text: "on Chart 1 put the legend at the bottom and show data labels",
    check: (run) =>
      all(
        need(
          action(run, "chart_action").some(
            (a) => a.action === "legend" && a.value === "bottom",
          ),
          "no legend",
        ),
        need(
          action(run, "chart_action").some(
            (a) => a.action === "data_labels_on",
          ),
          "no labels",
        ),
      ),
  },
  {
    id: "n-comment",
    text: "add a comment to H2 saying please check this quantity",
    check: (run) =>
      need(
        action(run, "comment").some(
          (a) => a.action === "add" && a.cell === "H2" && /check/i.test(a.text),
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-print",
    text: "set the data sheet up for printing: landscape, one page wide, header row on every page",
    check: (run) =>
      need(
        action(run, "page_setup").some(
          (a) =>
            a.orientation === "landscape" &&
            a.fit_width === 1 &&
            a.print_title_rows === "1:1",
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-replace",
    text: "replace km with Km in the UoM column",
    check: (run) =>
      need(
        action(run, "find_replace").some(
          (a) => a.find === "km" && a.replace === "Km",
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-hide-cols",
    text: "hide the LEA and UoM columns",
    check: (run) =>
      need(
        action(run, "edit_rows_columns")
          .filter((a) => a.action === "hide_columns")
          .map((a) => a.address)
          .join(" ")
          .match(/C/) !== null &&
          action(run, "edit_rows_columns")
            .filter((a) => a.action === "hide_columns")
            .map((a) => a.address)
            .join(" ")
            .match(/I/) !== null,
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-insert-col",
    text: "insert an empty column before column C",
    check: (run) =>
      need(
        action(run, "edit_rows_columns").some(
          (a) => a.action === "insert_columns" && /^C/.test(a.address),
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-dupes-inplace",
    text: "remove duplicate Service IDs from the data itself",
    check: (run) =>
      need(
        action(run, "edit_rows_columns").some(
          (a) =>
            a.action === "remove_duplicates" &&
            (a.columns ?? []).some((c: string) => /service id/i.test(c)),
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "n-goal-seek",
    text: "on the Model sheet, find the value of B1 that makes B5 equal to 0",
    check: (run) =>
      need(
        action(run, "goal_seek").some(
          (a) =>
            a.formula_cell === "B5" &&
            a.changing_cell === "B1" &&
            a.target === 0,
        ),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-protect",
    text: "protect the detail-report sheet",
    check: (run) =>
      need(
        action(run, "protect_sheet").some((a) => a.action === "protect"),
        JSON.stringify(run.changes.map((c) => c.change)),
      ),
  },
  {
    id: "n-sparkline",
    text: "add sparklines next to each RTOM total",
    check: (run) =>
      all(
        need(!action(run, "chart_action").length, "used a chart tool"),
        need(run.reply.length > 0, "no reply"),
      ),
  },
  {
    id: "p-clean-inplace",
    text: "trim the extra spaces in the UoM column on the data itself",
    check: (run) =>
      need(
        action(run, "clean_in_place").some(
          (a) => a.op === "trim" && /^I/.test(a.address),
        ),
        JSON.stringify(run.changes.map((c) => c.change)).slice(0, 200),
      ),
  },
  {
    id: "p-why",
    text: "why did the issued quantity change between March and April 2025?",
    check: (run, seen) =>
      all(
        usedCalc(seen),
        noChanges(run),
        need(run.reply.length > 40, "short reply"),
      ),
  },
  {
    id: "p-formula-check",
    text: "check the formulas in K2:K100 for errors or circular references",
    check: (_run, seen) =>
      need(
        seen.some(
          (s) => s.name === "get_details" && s.args.what === "formula_check",
        ),
        "no formula_check",
      ),
  },
  {
    id: "p-regression",
    text: "give me a regression report of issued quantity against requested quantity",
    check: (run, seen) =>
      all(
        need(kinds(run).includes("create_sheet"), "no report sheet"),
        need(
          formulas(run, seen).some((f) => /LINEST|SLOPE|RSQ/i.test(f)),
          "no LINEST/SLOPE",
        ),
      ),
  },
  {
    id: "p-month-summary",
    text: "summary of total issued quantity per month on a new sheet",
    check: (run, seen) =>
      need(
        formulas(run, seen).some(
          (f) => /GROUPBY|PIVOTBY/i.test(f) && /EOMONTH|MONTH|TEXT\(/i.test(f),
        ) || steps(run).some((s) => /month/i.test(s)),
        `changes ${kinds(run)} ${steps(run).join(" | ")}`,
      ),
  },
];

let pass = 0;
let ran = 0;
let turns = 0;
for (const item of CASES) {
  if (only && !only.has(item.id)) continue;
  ran += 1;
  const seen: Seen = [];
  let verdict: string | true;
  let run: AgentRun | undefined;
  try {
    const mask = new PersonalMask();
    const ask = (messages: AgentMessage[]) =>
      model(messages, item.language ?? "en");
    if (reviewOn) {
      // Helpers read through their own host, so the checks see only the builder's tool calls.
      const reviewed = await runTeam({
        request: item.text,
        host: host(seen),
        helperHost: host([]),
        mask,
        model: ask,
        onTool: (name, args) => seen.push({ name, args }),
        onTeamPhase: (phase) => trace && console.log(`    [team] ${phase}`),
        onReviewer: (focus) =>
          trace && console.log(`    [reviewer:${focus}] checking`),
        onHelperTool: (name) => trace && console.log(`    [helper] ${name}`),
      });
      if (trace) {
        console.log(
          `    [planner] ${reviewed.plan?.length ? reviewed.plan.map((step, i) => `${i + 1}. ${step}`).join(" | ") : "no plan (question, or planner skipped)"}`,
        );
        console.log(
          `    [builder] ${seen.length} tool call(s) (${seen.map((s) => s.name).join(", ")}), ${reviewed.run.changes.length} staged change(s), ${reviewed.run.turns} turn(s)`,
        );
        for (const verdict of reviewed.reviewers ?? [])
          console.log(
            `    [reviewer:${verdict.focus}] ${verdict.ok ? "OK" : `FIX: ${verdict.issues.join("; ")}`}`,
          );
        console.log(
          `    [team] revised: ${reviewed.revised}; ${describeReview(reviewed) || "nothing staged, no review"}`,
        );
      }
      if (reviewed.plan?.length) reviews.planned += 1;
      if (reviewed.review) {
        reviews[reviewed.review.ok ? "ok" : "fix"] += 1;
        if (reviewed.revised) reviews.revised += 1;
        if (!reviewed.review.ok || verbose)
          console.log(`    review: ${describeReview(reviewed)}`);
      }
      run = reviewed.run;
    } else
      run = await runAgent({
        request: item.text,
        host: host(seen),
        mask,
        model: ask,
        onTool: (name, args) => seen.push({ name, args }),
      });
    turns += run.turns;
    verdict = run.stoppedAtLimit
      ? "stopped at the turn limit"
      : item.check(run, seen);
  } catch (error) {
    verdict = `error ${(error as Error).message}`;
  }
  if (verdict === true) pass += 1;
  console.log(
    `${verdict === true ? "PASS" : "FAIL"} ${item.id}${verdict === true ? "" : `: ${verdict}`}`,
  );
  if (run && (verdict !== true || verbose)) {
    console.log(
      `    tools: ${seen.map((s) => `${s.name}(${JSON.stringify(s.args).slice(0, 140)})`).join(" ; ")}`,
    );
    console.log(`    reply: ${run.reply.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
if (reviewOn)
  console.log(
    `review: ${reviews.planned} planned, ${reviews.ok} accepted, ${reviews.fix} asked for a fix, ${reviews.revised} corrected`,
  );
console.log(
  `agent-prompts: ${pass}/${ran} (model turns ${turns}, calls ${calls}; tokens in ${usage.prompt} (cached ${usage.cached}), out ${usage.completion})`,
);
process.exit(pass === ran ? 0 : 1);
