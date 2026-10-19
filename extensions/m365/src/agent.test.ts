import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentToolError,
  PersonalMask,
  boundResult,
  checkFormula,
  clampReadAddress,
  describeChange,
  runAgent,
  stageChange,
  type AgentHost,
  type AgentMessage,
  type ToolCall,
} from "./agent.js";

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const host = (over: Partial<AgentHost> = {}): AgentHost => ({
  getWorkbook: async () => ({
    sheets: [{ name: "Data", rows: 520126, columns: 10 }],
  }),
  readRange: async (_sheet, address) => ({
    address,
    values: [["Circuit ID"], ["0112005016"]],
  }),
  calculate: async () => [[42]],
  checkStep: async (instruction) =>
    /pivot/i.test(instruction)
      ? { ok: true, understood: "pivot-table" }
      : { ok: false, error: "no action found." },
  ...over,
});

test("personal data leaves the device as stable tokens and comes back restored", () => {
  const mask = new PersonalMask();
  const out = mask.mask("call 0112005016 or a@b.lk, again 0112005016");
  assert.equal(out, "call [p2] or [p1], again [p2]");
  assert.equal(mask.unmask("filter [p2]"), "filter 0112005016");
  assert.equal(mask.unmask("[p9] stays"), "[p9] stays");
});

test("formulas with web calls, links or other workbooks are refused", () => {
  assert.equal(checkFormula(" =SUM(A:A)"), "=SUM(A:A)");
  for (const bad of [
    '=WEBSERVICE("x")',
    '=HYPERLINK("http://a","b")',
    "=[Book2.xlsx]Sheet1!A1",
    '="https://x"',
    "SUM(A1)",
  ])
    assert.throws(() => checkFormula(bad), AgentToolError, bad);
  // A structured table reference is fine.
  assert.equal(checkFormula("=SUM(Table1[Sales])"), "=SUM(Table1[Sales])");
});

test("reads are bounded to 50 rows and 500 cells", () => {
  assert.deepEqual(clampReadAddress("A1:J520126"), {
    address: "A1:J50",
    clipped: true,
  });
  assert.deepEqual(clampReadAddress("A1:Z100"), {
    address: "A1:Z19",
    clipped: true,
  });
  assert.deepEqual(clampReadAddress("B2:C5"), {
    address: "B2:C5",
    clipped: false,
  });
  assert.deepEqual(boundResult([[7]]), 7);
  const big = Array.from({ length: 80 }, (_, row) => [row, row * 2]);
  const bounded: any = boundResult(big);
  assert.equal(bounded.rows, 80);
  assert.equal(bounded.first.length, 50);
});

test("write tools are checked and staged with personal data restored", () => {
  const mask = new PersonalMask();
  const token = mask.mask("0112005016");
  const change = stageChange(
    "write_formula",
    {
      sheet: "Data",
      cell: "k2",
      formula: `=COUNTIFS(J2:J9,"${token}")`,
      header: "Lines",
    },
    (text) => mask.unmask(text),
  );
  assert.deepEqual(change, {
    kind: "write_formula",
    sheet: "Data",
    cell: "K2",
    formula: '=COUNTIFS(J2:J9,"0112005016")',
    header: "Lines",
  });
  assert.match(describeChange(change), /Write in 'Data'!K2/);
  // A literal that looks like a formula stays text.
  const values: any = stageChange(
    "write_values",
    { sheet: "Out", cell: "A1", values: [["=1+1", -5, "-3"]] },
    String,
  );
  assert.deepEqual(values.values, [["'=1+1", -5, "-3"]]);
  assert.throws(
    () =>
      stageChange(
        "write_formula",
        { sheet: "A:B", cell: "K2", formula: "=1" },
        String,
      ),
    AgentToolError,
  );
  assert.throws(
    () =>
      stageChange(
        "format_range",
        { sheet: "D", address: "A1", fill: "red" },
        String,
      ),
    AgentToolError,
  );
});

test("the loop runs read tools, stages writes, reports bad steps back, and ends on a reply", async () => {
  const mask = new PersonalMask();
  const turns: AgentMessage[][] = [];
  const script = [
    {
      content: "",
      tool_calls: [
        call("1", "get_workbook", {}),
        call("2", "read_range", { sheet: "Data", address: "A1:J520126" }),
      ],
    },
    {
      content: "",
      tool_calls: [
        call("3", "calculate", { formula: "=SUM(H2:H520126)" }),
        call("4", "vynor_step", { instruction: "make it nice" }),
      ],
    },
    {
      content: "",
      tool_calls: [
        call("5", "vynor_step", {
          instruction: "pivot table of total Issued Quantity by RTOM",
        }),
        call("6", "create_sheet", { name: "Summary" }),
      ],
    },
    { content: "එකතුව 42. [p1] බැලුවා.", tool_calls: [] },
  ];
  const run = await runAgent({
    request: "total and pivot",
    host: host(),
    mask,
    model: async (messages) => {
      turns.push(structuredClone(messages));
      return script[turns.length - 1];
    },
  });
  assert.equal(run.turns, 4);
  assert.deepEqual(
    run.changes.map((item) => item.change.kind),
    ["vynor_step", "create_sheet"],
  );
  const toolText = (id: string) =>
    (
      run.messages.find(
        (m) => m.role === "tool" && m.tool_call_id === id,
      ) as any
    ).content;
  // The read was clipped and the Circuit ID masked before it was sent.
  assert.match(toolText("2"), /A1:J50/);
  assert.match(toolText("2"), /\[p1\]/);
  assert.doesNotMatch(JSON.stringify(turns), /0112005016/);
  assert.match(toolText("3"), /"result":42/);
  assert.match(toolText("4"), /Not understood/);
  assert.match(toolText("5"), /pivot-table/);
  assert.equal(run.reply, "එකතුව 42. 0112005016 බැලුවා.");
});

test("a broken argument or failing host becomes an error result, not a crash", async () => {
  let turn = 0;
  const run = await runAgent({
    request: "x",
    host: host({
      calculate: async () => {
        throw new Error("#CALC!");
      },
    }),
    mask: new PersonalMask(),
    model: async () => {
      turn += 1;
      if (turn === 1)
        return {
          content: "",
          tool_calls: [
            {
              id: "a",
              type: "function",
              function: { name: "calculate", arguments: "{not json" },
            },
            call("b", "calculate", { formula: "=1/0" }),
          ],
        };
      return { content: "done", tool_calls: [] };
    },
  });
  const results = run.messages
    .filter((m) => m.role === "tool")
    .map((m: any) => m.content);
  assert.match(results[0], /not a JSON object/);
  assert.match(results[1], /The tool failed: #CALC!/);
  assert.equal(run.reply, "done");
});

test("the loop stops at the turn limit", async () => {
  const run = await runAgent({
    request: "loop",
    host: host(),
    mask: new PersonalMask(),
    maxTurns: 3,
    model: async () => ({
      content: "",
      tool_calls: [call(String(Math.random()), "get_workbook", {})],
    }),
  });
  assert.equal(run.stoppedAtLimit, true);
  assert.equal(run.turns, 3);
});
