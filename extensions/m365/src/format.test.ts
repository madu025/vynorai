import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildQualityReport } from "./transform.js";

const headers = ["Month", "Region", "Sales", "Cost", "Margin %"];
const rows = [
  ["Jan", "North", 1200, 800, 0.33],
  ["Feb", "South", 1500, 950, 0.37],
  ["Mar", "North", 1800, -1100, 0.39],
  ["Apr", "East", 1350, 900, 0.33],
];
const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:E5",
  hasHeaders: true,
  values: [headers, ...rows],
};

test("format instructions become explicit options, and 'format as a table' stays a table", () => {
  const presentable = interpretInstruction(
    "Make it presentable with data bars on Sales and a total row",
    headers,
    rows,
  );
  assert.deepEqual(presentable.actions, ["format"]);
  assert.deepEqual(presentable.specs.format, {
    freezeHeader: true,
    totalRow: true,
    conditional: [{ column: 2, rule: "data-bars" }],
  });
  const negative = interpretInstruction(
    "Highlight negative values in Cost",
    headers,
    rows,
  );
  assert.deepEqual(negative.specs.format?.conditional, [
    { column: 3, rule: "negative" },
  ]);
  const custom = interpretInstruction(
    "Highlight Sales where Sales > 1000",
    headers,
    rows,
  );
  assert.deepEqual(custom.specs.format?.conditional, [
    { column: 2, rule: "custom-formula", operator: ">", value: 1000 },
  ]);
  const customPlan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: custom.specs.format,
  });
  assert.deepEqual(customPlan.actions[0].spec?.conditional, [
    {
      column: "Sales",
      index: 2,
      rule: "custom-formula",
      operator: ">",
      value: 1000,
    },
  ]);
  const dropdown = interpretInstruction(
    "Add a drop-down for Region",
    headers,
    rows,
  );
  assert.deepEqual(dropdown.specs.format?.validation, [
    { column: 1, rule: "list" },
  ]);
  const inputMessage = interpretInstruction(
    "Add an input message to the Region validation",
    headers,
    rows,
  );
  assert.deepEqual(inputMessage.specs.format?.inputMessage, {
    column: 1,
    title: "VynorAI guidance",
    message: "Choose a valid Region value.",
  });
  assert.deepEqual(inputMessage.specs.format?.validation, [
    { column: 1, rule: "list" },
  ]);
  const table = interpretInstruction("Format as a table", headers, rows);
  assert.equal(table.specs.format, undefined);
  assert.deepEqual(table.actions, ["table"]);
  assert.ok(!table.actions.includes("format"));

  const dependent = interpretInstruction(
    "Create a dependent drop-down for Status based on Region",
    ["Region", "Status"],
    [
      ["North", "Open"],
      ["North", "Closed"],
      ["South", "Open"],
    ],
  );
  assert.deepEqual(dependent, {
    actions: ["format"],
    specs: {
      format: {
        freezeHeader: true,
        dependentDropdown: { child: 1, parent: 0 },
      },
    },
    problems: [],
  });
});

test("quality requests are recognised", () => {
  for (const text of [
    "Check the data quality",
    "run a health check",
    "find problems in this data",
  ])
    assert.ok(
      interpretInstruction(text, headers, rows).actions.includes("quality"),
      text,
    );
});

test("a pivot can have a filter field", () => {
  const parsed = interpretInstruction(
    "Pivot of average Sales by Region and Month filter by Region",
    headers,
    rows,
  );
  assert.ok(parsed.actions.includes("pivot-table"));
  const plan = createExcelPreviewPlan(input as any, ["pivot-table"], 500, {
    pivot: { rows: 1, values: 2, filter: 0 },
  });
  const action = plan.actions.find((entry) => entry.kind === "pivot-table")!;
  assert.equal(action.spec?.filterColumn, "Month");
  assert.throws(
    () =>
      createExcelPreviewPlan(input as any, ["pivot-table"], 500, {
        pivot: { rows: 1, values: 2, filter: 1 },
      }),
    /filter field must be a different column/,
  );
});

test("the plan decides number formats, highlights and drop-down values", () => {
  const plan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: {
      totalRow: true,
      conditional: [
        { column: 2, rule: "color-scale" },
        { column: 3, rule: "negative" },
      ],
      validation: [
        { column: 1, rule: "list" },
        { column: 3, rule: "non-negative" },
      ],
      inputMessage: {
        column: 1,
        title: "Status guidance",
        message: "Choose a valid status.",
      },
    },
  });
  const action = plan.actions.find((entry) => entry.kind === "format")!;
  assert.equal(action.targetSheet, "Sheet1_Vynor_Format");
  const spec = action.spec!;
  assert.equal(spec.totalRow, true);
  assert.deepEqual(
    spec.columnFormats?.map((entry) => entry.format),
    ["#,##0", "#,##0", "0.0%"],
  );
  assert.deepEqual(spec.validation?.[0].values, ["North", "South", "East"]);
  assert.deepEqual(spec.inputMessage, {
    column: "Region",
    index: 1,
    title: "Status guidance",
    message: "Choose a valid status.",
  });
  const dependentPlan = createExcelPreviewPlan(
    {
      ...input,
      values: [
        ["Region", "Status"],
        ["North", "Open"],
        ["North", "Closed"],
        ["South", "Open"],
      ],
      address: "Sheet1!A1:B4",
    } as any,
    ["format"],
    500,
    { format: { dependentDropdown: { child: 1, parent: 0 } } },
  );
  assert.deepEqual(dependentPlan.actions[0].spec?.dependentDropdown, {
    childColumn: "Status",
    childIndex: 1,
    parentColumn: "Region",
    parentIndex: 0,
    groups: [
      { key: "North", name: "VynorAI_DD_North", values: ["Open", "Closed"] },
      { key: "South", name: "VynorAI_DD_South", values: ["Open"] },
    ],
  });
  const bad = (format: unknown) =>
    createExcelPreviewPlan(input as any, ["format"], 500, { format } as any);
  assert.throws(
    () => bad({ conditional: [{ column: 1, rule: "data-bars" }] }),
    /column of numbers/,
  );
  assert.throws(
    () => bad({ conditional: [{ column: 2, rule: "sparkles" }] }),
    /valid column and highlight rule/,
  );
  assert.throws(
    () => bad({ validation: [{ column: 9, rule: "list" }] }),
    /valid column/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(
        {
          ...input,
          values: [
            ["A", "B"],
            ["x,y", 1],
          ],
          address: "Sheet1!A1:B2",
        } as any,
        ["format"],
        500,
        { format: { validation: [{ column: 0, rule: "list" }] } },
      ),
    /cannot become a drop-down list/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(
        {
          ...input,
          values: [
            ["Parent", "Child"],
            ["North/West", "Open"],
          ],
          address: "Sheet1!A1:B2",
        } as any,
        ["format"],
        500,
        { format: { dependentDropdown: { child: 1, parent: 0 } } },
      ),
    /parent values must use/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(
        {
          ...input,
          values: [
            ["Parent", "Child"],
            ["North", "Open, Closed"],
          ],
          address: "Sheet1!A1:B2",
        } as any,
        ["format"],
        500,
        { format: { dependentDropdown: { child: 1, parent: 0 } } },
      ),
    /child values must be/,
  );
});

test("the quality report finds blanks, duplicates, text numbers, spaces and outliers", () => {
  const report = buildQualityReport(
    ["Name", "Amount", "Note"],
    [
      ["Kamal", 10, "ok"],
      ["Nimali ", 12, ""],
      ["Kamal", 11, "ok"],
      ["Ruwan", 10, "ok"],
      ["Kamal", 10, "ok"],
      ["Sunil", "1,200", "ok"],
      ["Amali", 9000, "ok"],
    ],
  );
  const text = report.findings.join("\n");
  assert.match(text, /duplicate row/);
  assert.match(text, /Note: 1 blank/);
  assert.match(text, /Name: 1 value\(s\) have extra spaces/);
  assert.match(text, /Amount: numbers and text are mixed/);
  assert.equal(report.values[0][0], "Data quality report");
  assert.deepEqual(report.values[report.headerRow].slice(0, 3), [
    "Column",
    "Type",
    "Filled",
  ]);
  const clean = buildQualityReport(["A"], [[1], [2], [3], [4], [5]]);
  assert.deepEqual(clean.findings, ["No problems found in the selected data."]);
});
