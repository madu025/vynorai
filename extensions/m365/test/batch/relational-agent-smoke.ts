/** Live backend/chat smoke test for the ten-sheet relational fixture.
 * Run with: npx tsx --env-file=../../.env.e2e test/batch/relational-agent-smoke.ts
 * It sends schema and bounded tool results through the existing m365 gateway; relationship rows
 * are computed locally and only counts/evidence are returned to the model.
 */
import assert from "node:assert/strict";
import {
  PersonalMask,
  columnLetters,
  parseA1,
  runAgent,
  type AgentHost,
  type AgentMessage,
  type AgentRun,
} from "../../src/agent.js";
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
} from "../../../../backend/src/services/m365Agent.js";
import { relationalWorkbookSheets } from "./relationalWorkbook.js";

const key = process.env.VYNORAI_E2E_API_KEY || "";
const base = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";
if (!key)
  throw new Error(
    "VYNORAI_E2E_API_KEY is required for the live chat smoke test.",
  );

const sheets = relationalWorkbookSheets();
const byName = new Map(sheets.map((sheet) => [sheet.name, sheet]));
const toValue = (value: unknown): string | number | null =>
  value !== null && typeof value === "object" && "date" in value
    ? Number((value as { date: number }).date)
    : (value as string | number | null);

const workbook = {
  activeSheet: "Orders",
  selection: "A1:L3001",
  sheets: sheets.map((sheet) => ({
    name: sheet.name,
    usedRange: `A1:${columnLetters(sheet.headers.length - 1)}${sheet.rows.length + 1}`,
    rows: sheet.rows.length + 1,
    columns: sheet.headers.length,
  })),
  tables: [],
  data: {
    sheet: "Orders",
    address: "A1:L3001",
    headerRow: 1,
    dataRows: 3_000,
    columns: sheets[0].headers.map((name, index) => ({
      letter: columnLetters(index),
      name,
      type: /date/i.test(name)
        ? "date"
        : /amount|price|quantity|discount/i.test(name)
          ? "number"
          : "text",
    })),
    firstRows: sheets[0].rows.slice(0, 3).map((row) => row.map(toValue)),
  },
};

const host: AgentHost = {
  getWorkbook: async () => workbook,
  readRange: async (sheetName, address) => {
    const sheet = byName.get(sheetName);
    if (!sheet) throw new Error(`Unknown sheet ${sheetName}`);
    const box = parseA1(address);
    return {
      address,
      values: [sheet.headers, ...sheet.rows]
        .slice(box.row - 1, box.lastRow)
        .map((row) => row.slice(box.column, box.lastColumn + 1).map(toValue)),
    };
  },
  calculate: async () => [[0]],
  checkStep: async () => ({
    ok: false,
    error: "This smoke test is read-only; no write step is allowed.",
  }),
};

async function model(messages: AgentMessage[]) {
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
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
      max_tokens: 1800,
      stream: false,
      vynor_surface: "m365",
    }),
  });
  const payload = (await response.json()) as any;
  if (!response.ok)
    throw new Error(
      `gateway ${response.status} ${JSON.stringify(payload).slice(0, 200)}`,
    );
  const message = payload?.choices?.[0]?.message ?? {};
  return {
    content: typeof message.content === "string" ? message.content : "",
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
  };
}

const seen: string[] = [];
const run: AgentRun = await runAgent({
  request:
    "Map the relationships between Orders, Customers, Products, SalesReps and Payments. Report the join keys, cardinality, unmatched rows and repeated-key warnings. Do not change the workbook.",
  host,
  model,
  mask: new PersonalMask(),
  onTool: (name) => seen.push(name),
});

assert.ok(seen.includes("map_relationships"), `tools used: ${seen.join(", ")}`);
assert.equal(
  run.changes.length,
  0,
  "relationship smoke test must not stage writes",
);
assert.ok(run.reply.length > 0, "the backend chat must return a final answer");
assert.match(
  run.reply,
  /Customer ID/i,
  "the final answer must cite the customer join",
);
assert.match(
  run.reply,
  /Product ID/i,
  "the final answer must cite the product join",
);
assert.match(
  run.reply,
  /many[- ]to[- ]one/i,
  "the final answer must report cardinality",
);
assert.match(
  run.reply,
  /unmatched|no customer|no product|without partner/i,
  "the final answer must report unmatched-row evidence",
);
console.log(`relationship chat smoke passed: ${seen.join(" -> ")}`);
console.log(`reply: ${run.reply.replace(/\s+/g, " ").slice(0, 280)}`);
