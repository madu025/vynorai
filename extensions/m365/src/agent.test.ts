import assert from "node:assert/strict";
import { isReadOnlyQuestion, withRelationshipHint } from "./agent.js";
import { test } from "node:test";
import {
  AgentToolError,
  PersonalMask,
  boundResult,
  checkFormula,
  clampReadAddress,
  describeChange,
  runAgent,
  coveredKinds,
  appliedReport,
  answerSources,
  userContent,
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
    '=PY("df.describe()")',
    "=SUM(1)+py (1)",
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

test("text analysis is read-only and bounded before a result column can be staged", async () => {
  let received: unknown;
  const run = await runAgent({
    request: "classify the review text",
    host: host({
      analyzeTextBatch: async (input) => {
        received = input;
        return { results: [{ index: 0, label: "positive" }] };
      },
    }),
    mask: new PersonalMask(),
    model: async () => ({
      content: "",
      tool_calls: [
        call("text", "analyze_text_batch", {
          feature: "sentiment",
          texts: ["great support"],
        }),
      ],
    }),
  });
  assert.deepEqual(received, {
    feature: "sentiment",
    texts: ["great support"],
  });
  assert.equal(run.changes.length, 0);
  assert.match(run.messages.at(-1)?.content ?? "", /positive/);
});

test("column analysis reads at most 5,000 rows on the device and returns a summary, not rows", async () => {
  const asked: string[] = [];
  let turn = 0;
  const run = await runAgent({
    request: "find unusual amounts",
    host: host({
      readRange: async (_sheet, address) => {
        asked.push(address);
        return {
          address,
          values: [
            ["Region", "Amount"],
            ...[100, 104, 98, 101, 99, 9000].map((amount) => ["West", amount]),
          ],
        };
      },
    }),
    mask: new PersonalMask(),
    model: async () => {
      turn += 1;
      return turn === 1
        ? {
            content: "",
            tool_calls: [
              call("a", "analyze_columns", {
                kind: "anomalies",
                sheet: "Data",
                address: "B4:C520126",
                columns: ["Amount"],
              }),
            ],
          }
        : { content: "Row 10 is unusual.", tool_calls: [] };
    },
  });
  assert.deepEqual(asked, ["B4:C5004"]);
  const result = JSON.parse(
    String(run.messages.find((m) => m.role === "tool")?.content),
  );
  assert.equal(result.outliers, 1);
  assert.equal(result.top[0].row, 10);
  assert.match(result.note, /first 5,000 data rows/);
  // For the rows past the sample, the result hands over one exact formula over every row.
  assert.equal(
    result.exact_formula,
    "=LET(v,'Data'!C5:C520126,q1,QUARTILE.INC(v,1),q3,QUARTILE.INC(v,3),i,q3-q1,FILTER(HSTACK(ROW(v),v),(v<q1-1.5*i)+(v>q3+1.5*i),\"None\"))",
  );
  assert.equal(run.changes.length, 0);
});

test("reports the planner, execution and verification phases", async () => {
  const phases: string[] = [];
  let turn = 0;
  const run = await runAgent({
    request: "read it",
    host: host(),
    mask: new PersonalMask(),
    onPhase: (phase) => phases.push(phase),
    model: async () => {
      turn += 1;
      return turn === 1
        ? { content: "", tool_calls: [call("read", "get_workbook", {})] }
        : { content: "Done", tool_calls: [] };
    },
  });
  assert.deepEqual(phases, [
    "planning",
    "executing",
    "verifying",
    "planning",
    "final",
  ]);
  assert.equal(run.phase, "final");
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

test("whole columns like A:B are accepted, and a read of them is bounded", () => {
  const change: any = stageChange(
    "format_range",
    { sheet: "Out", address: "a:b", autofit: true },
    String,
  );
  assert.equal(change.address, "A:B");
  assert.deepEqual(clampReadAddress("A:B"), {
    address: "A1:B50",
    clipped: true,
  });
});

test("after six calculations the agent is told to act or answer", async () => {
  let turn = 0;
  const run = await runAgent({
    request: "x",
    host: host(),
    mask: new PersonalMask(),
    model: async () => {
      turn += 1;
      if (turn <= 2)
        return {
          content: "",
          tool_calls: Array.from({ length: 4 }, (_, i) =>
            call(`${turn}-${i}`, "calculate", { formula: `=${turn * 10 + i}` }),
          ),
        };
      return { content: "done", tool_calls: [] };
    },
  });
  const results = run.messages
    .filter((m) => m.role === "tool")
    .map((m: any) => m.content);
  assert.equal(results.filter((r) => /"result"/.test(r)).length, 6);
  assert.match(results[7], /already ran 6 calculations/);
});

test("numbers come back with grouped text, and replies lose markdown marks", async () => {
  const { plainText } = await import("./agent.js");
  assert.equal(
    plainText("- **Total:** 1,090,404.455 `=SUM(H:H)`\n## Rows"),
    "- Total: 1,090,404.455 =SUM(H:H)\nRows",
  );
  let turn = 0;
  const run = await runAgent({
    request: "total",
    host: host({ calculate: async () => [[1090404.455]] }),
    mask: new PersonalMask(),
    model: async () => {
      turn += 1;
      return turn === 1
        ? {
            content: "",
            tool_calls: [call("t", "calculate", { formula: "=SUM(H:H)" })],
          }
        : { content: "**Total:** 1,090,404.455", tool_calls: [] };
    },
  });
  const result = (run.messages.find((m) => m.role === "tool") as any).content;
  assert.match(result, /"as_text":"1,090,404.455"/);
  assert.equal(run.reply, "Total: 1,090,404.455");
});

test("a step of a multi-step request that nothing staged covers is named once, then the model goes on", async () => {
  const seen: AgentMessage[][] = [];
  const script = [
    {
      content: "",
      tool_calls: [
        call("1", "create_chart", { sheet: "Data", address: "A1:B20" }),
      ],
    },
    { content: "Chart staged.", tool_calls: [] },
    {
      content: "",
      tool_calls: [
        call("2", "vynor_step", {
          instruction: "pivot table of Sales by Region",
        }),
      ],
    },
    { content: "PivotTable and chart staged.", tool_calls: [] },
  ];
  const run = await runAgent({
    request: "make a pivot by region and chart it",
    host: host(),
    mask: new PersonalMask(),
    model: async (messages) => {
      seen.push(structuredClone(messages));
      return script[seen.length - 1];
    },
  });
  assert.equal(run.turns, 4);
  assert.equal(run.reply, "PivotTable and chart staged.");
  const nudges = run.messages.filter(
    (m) =>
      m.role === "user" &&
      String(m.content).startsWith("[Report from the add-in"),
  );
  assert.equal(nudges.length, 1);
  assert.match(String(nudges[0].content), /also asks for: PivotTable\./);
  assert.deepEqual(
    run.changes.map((item) => item.change.kind),
    ["create_chart", "vynor_step"],
  );
});

test("no step is named when the staged changes cover the request, or when nothing was staged", async () => {
  const covered = await runAgent({
    request: "pivot by region and chart it",
    host: host(),
    mask: new PersonalMask(),
    model: (() => {
      const script = [
        {
          content: "",
          tool_calls: [
            call("1", "vynor_step", {
              instruction: "pivot of Sales by Region",
            }),
            call("2", "create_chart", { sheet: "Data" }),
          ],
        },
        { content: "Done.", tool_calls: [] },
      ];
      let index = 0;
      return async () => script[index++];
    })(),
  });
  assert.equal(covered.turns, 2);
  const question = await runAgent({
    request: "which chart and pivot would suit this?",
    host: host(),
    mask: new PersonalMask(),
    model: async () => ({
      content: "A column chart by region.",
      tool_calls: [],
    }),
  });
  assert.equal(question.turns, 1);
});

test("staged changes map to the plan kinds the multi-step check uses", () => {
  const kinds = coveredKinds([
    {
      change: {
        kind: "vynor_step",
        instruction: "x",
        understood: "clean, pivot-table",
      },
    },
    {
      change: {
        kind: "write_formula",
        sheet: "S",
        cell: "A1",
        formula: "=GROUPBY(A2:A9,B2:B9,SUM)",
      } as any,
    },
    { change: { kind: "excel_action", tool: "conditional_format", args: {} } },
  ]);
  assert.deepEqual(kinds.sort(), [
    "add-column",
    "clean",
    "format",
    "pivot-table",
    "summary",
  ]);
});

test("a target and audience from the request follow the request text, not the fixed prompt", async () => {
  let first: AgentMessage[] = [];
  await runAgent({
    request: "management dashboard, target 5M",
    host: host(),
    mask: new PersonalMask(),
    model: async (messages) => {
      first = structuredClone(messages);
      return { content: "ok", tool_calls: [] };
    },
  });
  assert.equal(first.length, 1);
  assert.equal(
    first[0].content,
    "management dashboard, target 5M\n\n[From the add-in, read from the request] target 5000000; audience management.",
  );
});

test("the add-in's own report after an apply is never checked as a request", async () => {
  const script = [
    {
      content: "",
      tool_calls: [call("1", "create_chart", { sheet: "Data" })],
    },
    { content: "Fixed the chart.", tool_calls: [] },
  ];
  let index = 0;
  const run = await runAgent({
    request: appliedReport([
      {
        change: {
          kind: "vynor_step",
          instruction: "pivot by region",
          understood: "pivot-table",
        },
        status: "failed",
        detail: "target 5M",
      } as any,
    ]),
    host: host(),
    mask: new PersonalMask(),
    model: async () => script[index++],
  });
  assert.equal(run.turns, 2);
  assert.ok(
    !String(run.messages[0].content).includes(
      "[From the add-in, read from the request]",
    ),
  );
});

test("a long request with the add-in's note still fits the backend's 4000-character limit", () => {
  const note = "[From the add-in, read from the request] target 5000000.";
  const content = userContent("x".repeat(5000), note);
  assert.equal(content.length, 4000);
  assert.ok(content.endsWith(`\n\n${note}`));
  assert.equal(userContent("y".repeat(5000), "").length, 4000);
});

test("answer sources list the ranges read and formulas computed, restored and without repeats", () => {
  const mask = new PersonalMask();
  const token = mask.mask("0112005016");
  const messages: AgentMessage[] = [
    { role: "user", content: "how many?" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        call("1", "get_workbook", {}),
        call("2", "read_range", { sheet: "Data", address: "A1:J50" }),
        call("3", "calculate", {
          formula: `=COUNTIF('Data'!J2:J520126,"${token}")`,
        }),
      ],
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        call("4", "read_range", { sheet: "Data", address: "A1:J50" }),
        call("5", "analyze_columns", {
          kind: "anomalies",
          sheet: "Data",
          address: "A1:J520126",
          columns: ["Qty"],
        }),
        call("6", "get_details", { what: "formula_audit" }),
      ],
    },
  ];
  assert.deepEqual(
    answerSources(messages, (text) => mask.unmask(text)),
    [
      { kind: "range", sheet: "Data", address: "A1:J50" },
      { kind: "formula", text: `=COUNTIF('Data'!J2:J520126,"0112005016")` },
      {
        kind: "range",
        sheet: "Data",
        address: "A1:J520126",
        note: "anomalies",
      },
      { kind: "check", text: "formula_audit" },
    ],
  );
});

test("an empty answer is asked for once, and never reaches the person as nothing", async () => {
  let turns = 0;
  const asked: string[] = [];
  const run = await runAgent({
    request: "describe the trend next to each total",
    host: host(),
    mask: new PersonalMask(),
    model: async (messages) => {
      turns += 1;
      asked.push(String((messages.at(-1) as any).content ?? ""));
      return turns === 1
        ? { content: "", tool_calls: [] }
        : {
            content: "- Sparklines are not available; a line chart is.",
            tool_calls: [],
          };
    },
  });
  assert.equal(run.reply, "- Sparklines are not available; a line chart is.");
  assert.match(asked[1], /empty/i);
  assert.equal(run.stoppedAtLimit, undefined);

  // A model that stays silent gets a plain, honest line instead of an empty pane.
  const silent = await runAgent({
    request: "describe the trend next to each total",
    host: host(),
    mask: new PersonalMask(),
    model: async () => ({ content: "  ", tool_calls: [] }),
  });
  assert.match(silent.reply, /no answer|did not answer/i);
  assert.equal(silent.changes.length, 0);
});

test("map_relationships reads each range and returns the join, never the rows", async () => {
  const reads: string[] = [];
  const run = await runAgent({
    request: "total orders by customer region",
    host: host({
      readRange: async (sheet, address) => {
        reads.push(`${sheet}!${address}`);
        return {
          address,
          values:
            sheet === "Orders"
              ? [
                  ["CustomerID", "Amount"],
                  ["C1", 5.5],
                  ["C2", 7.5],
                  ["C1", 2.5],
                ]
              : [
                  ["CustomerID", "Region"],
                  ["C1", "N"],
                  ["C2", "S"],
                ],
        };
      },
    }),
    mask: new PersonalMask(),
    model: (() => {
      let turn = 0;
      return async () => {
        turn += 1;
        return turn === 1
          ? {
              content: "",
              tool_calls: [
                call("a", "map_relationships", {
                  ranges: ["Orders!A1:B4", "'Customers'!A1:B3"],
                }),
              ],
            }
          : { content: "- Joined on CustomerID.", tool_calls: [] };
      };
    })(),
  });
  assert.deepEqual(reads, ["Orders!A1:B4", "Customers!A1:B3"]);
  const result = JSON.parse(
    String(run.messages.find((m) => m.role === "tool")?.content),
  );
  assert.equal(result.links[0].from.column, "CustomerID");
  assert.equal(result.links[0].cardinality, "many-to-one");
  assert.equal(JSON.stringify(result).includes("5.5"), false);
  assert.deepEqual(answerSources(run.messages, (t) => t)[0], {
    kind: "range",
    sheet: "Orders",
    address: "A1:B4",
    note: "relationships",
  });
});

test("build_semantic_model is a bounded read-only alternative and exposes evidence", async () => {
  const reads: string[] = [];
  const run = await runAgent({
    request: "build a reusable data model for Orders and Customers",
    host: host({
      readRange: async (sheet, address) => {
        reads.push(`${sheet}!${address}`);
        return {
          address,
          values:
            sheet === "Orders"
              ? [
                  ["Order ID", "Customer ID", "Amount"],
                  ["O1", "C1", 10],
                  ["O2", "C1", 12],
                  ["O3", "C2", 8],
                ]
              : [
                  ["Customer ID", "Region"],
                  ["C1", "North"],
                  ["C2", "South"],
                ],
        };
      },
    }),
    mask: new PersonalMask(),
    model: (() => {
      let turn = 0;
      return async () => {
        turn += 1;
        return turn === 1
          ? {
              content: "",
              tool_calls: [
                call("model", "build_semantic_model", {
                  ranges: ["Orders!A1:C4", "Customers!A1:B3"],
                }),
              ],
            }
          : {
              content: "- Local semantic model built from the two ranges.",
              tool_calls: [],
            };
      };
    })(),
  });
  assert.deepEqual(reads, ["Orders!A1:C4", "Customers!A1:B3"]);
  const result = JSON.parse(
    String(run.messages.find((message) => message.role === "tool")?.content),
  );
  assert.equal(result.implementation, "deterministic-local-metadata");
  assert.equal(result.relationships[0].cardinality, "many-to-one");
  assert.equal(run.changes.length, 0);
  assert.deepEqual(answerSources(run.messages, (text) => text)[0], {
    kind: "range",
    sheet: "Orders",
    address: "A1:C4",
    note: "semantic model",
  });
});

test("get_workbook adds the relationship hint only when several sheets hold data", async () => {
  const hinted = withRelationshipHint({
    sheets: [
      { name: "A", rows: 10 },
      { name: "B", rows: 5 },
    ],
  }) as any;
  assert.match(hinted.hint, /map_relationships/);
  const single = withRelationshipHint({
    sheets: [
      { name: "A", rows: 10 },
      { name: "B", rows: 0 },
    ],
  }) as any;
  assert.equal(single.hint, undefined);
});

test("a plain question stages nothing, but a request for a sheet still can", async () => {
  assert.equal(
    isReadOnlyQuestion("are there any unusual Amount values?"),
    true,
  );
  assert.equal(isReadOnlyQuestion("which rows have no customer"), true);
  assert.equal(isReadOnlyQuestion("can you add a Total column?"), false);
  assert.equal(
    isReadOnlyQuestion("which items sold most? put it on a new sheet"),
    false,
  );
  assert.equal(isReadOnlyQuestion("sort by amount"), false);

  let turn = 0;
  const run = await runAgent({
    request: "are there any unusual Amount values?",
    host: host(),
    mask: new PersonalMask(),
    model: async () => {
      turn += 1;
      return turn === 1
        ? {
            content: "",
            tool_calls: [
              call("a", "vynor_step", { instruction: "pivot of Amount" }),
            ],
          }
        : { content: "- No outliers.", tool_calls: [] };
    },
  });
  assert.equal(run.changes.length, 0);
  assert.match(
    String(run.messages.find((m) => m.role === "tool")?.content),
    /This is a question/,
  );
});
