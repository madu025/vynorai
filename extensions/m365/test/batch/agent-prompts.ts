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
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
} from "../../src/excel.js";
import { interpretInstruction } from "../../src/intent.js";
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
} from "../../../../backend/src/services/m365Agent.js";
import { fakeCalculator } from "./fakeExcel.js";

const KEY = process.env.VYNORAI_E2E_API_KEY || "";
const BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
const verbose = process.argv.includes("--verbose");
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
  readRange: async (_sheet, address) => {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
    const top = match ? Number(match[2]) : 1;
    const bottom = match ? Number(match[4]) : 1;
    const all = [HEADERS, ...rows];
    return {
      address,
      values: all.slice(top - 1, Math.min(bottom, all.length)),
    };
  },
  calculate: async (formula) => calculate(formula),
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
        steps(run).some((s) => /pivot/i.test(s)) &&
          steps(run).some((s) => /chart/i.test(s)),
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
          formulas(run, []).some((f) => /<>"X"/i.test(f)),
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
          need(chart.chartType === "line", `chart ${chart.chartType}`),
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
    run = await runAgent({
      request: item.text,
      host: host(seen),
      mask: new PersonalMask(),
      model: (messages) => model(messages, item.language ?? "en"),
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
console.log(
  `agent-prompts: ${pass}/${ran} (model turns ${turns}, calls ${calls}; tokens in ${usage.prompt} (cached ${usage.cached}), out ${usage.completion})`,
);
process.exit(pass === ran ? 0 : 1);
