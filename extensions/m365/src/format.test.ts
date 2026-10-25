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
  const ranked = interpretInstruction(
    "Highlight the top 2 values in Sales with conditional formatting",
    headers,
    rows,
  );
  assert.deepEqual(ranked.actions, ["format"]);
  assert.deepEqual(ranked.specs.format?.conditional, [
    { column: 2, rule: "top-n", n: 2 },
  ]);
  const rankedPlan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: ranked.specs.format,
  });
  assert.deepEqual(rankedPlan.actions[0].spec?.conditional, [
    { column: "Sales", index: 2, rule: "top-n", n: 2 },
  ]);
  const contains = interpretInstruction(
    "Highlight Status cells containing Pending",
    ["Status", "Sales"],
    [
      ["Pending", 100],
      ["Done", 200],
    ],
  );
  assert.deepEqual(contains.actions, ["format"]);
  assert.deepEqual(contains.specs.format?.conditional, [
    { column: 0, rule: "text-contains", text: "Pending" },
  ]);
  const validation = interpretInstruction(
    "Only allow non-negative Quantity and limit Customer to 30 characters",
    ["Quantity", "Customer"],
    [
      [4, "Asha"],
      [0, "Bimal"],
    ],
  );
  assert.deepEqual(validation.specs.format?.validation, [
    { column: 0, rule: "non-negative" },
    { column: 1, rule: "max-length", max: 30 },
  ]);
  const dates = interpretInstruction(
    "Highlight Date between 2026-01-01 and 2026-03-31 with conditional formatting",
    ["Date", "Sales"],
    [
      [46023, 100],
      [46112, 200],
    ],
  );
  assert.deepEqual(dates.actions, ["format"]);
  assert.deepEqual(dates.specs.format?.conditional, [
    {
      column: 0,
      rule: "date-range",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    },
  ]);
  const datePlan = createExcelPreviewPlan(
    {
      ...input,
      values: [
        ["Date", "Sales"],
        [46023, 100],
        [46112, 200],
      ],
    } as any,
    ["format"],
    500,
    { format: { conditional: dates.specs.format?.conditional } },
  );
  assert.deepEqual(datePlan.actions[0].spec?.conditional, [
    {
      column: "Date",
      index: 0,
      rule: "date-range",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
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
  const tableWithTotals = interpretInstruction(
    "Format as a table with a totals row",
    headers,
    rows,
  );
  assert.deepEqual(tableWithTotals.actions, ["table"]);
  assert.deepEqual(tableWithTotals.specs.table, { showTotals: true });
  const styledTable = interpretInstruction(
    "Create an Excel table with a blue table style",
    headers,
    rows,
  );
  assert.deepEqual(styledTable.actions, ["table"]);
  assert.deepEqual(styledTable.specs.table, { style: "TableStyleMedium2" });
  const styledPlan = createExcelPreviewPlan(input as any, ["table"], 500, {
    table: styledTable.specs.table,
  });
  assert.equal(styledPlan.actions[0].spec?.tableStyle, "TableStyleMedium2");

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

test("format instructions can freeze a bounded number of leading columns", () => {
  const interpreted = interpretInstruction(
    "Freeze the first 2 columns and format the data",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.specs.format, {
    freezeHeader: true,
    freezeColumns: 2,
  });
  const plan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: interpreted.specs.format,
  });
  assert.equal(plan.actions[0].spec?.freezeColumns, 2);
});

test("format instructions can freeze a bounded number of leading rows", () => {
  const interpreted = interpretInstruction(
    "Freeze the first 3 rows and format the data",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.specs.format, {
    freezeHeader: true,
    freezeRows: 3,
  });
  const plan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: interpreted.specs.format,
  });
  assert.equal(plan.actions[0].spec?.freezeRows, 3);
});

test("format instructions can explicitly control result-sheet gridlines", () => {
  const interpreted = interpretInstruction(
    "Format the data and hide the gridlines",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.specs.format?.showGridlines, false);
  const plan = createExcelPreviewPlan(input as any, ["format"], 500, {
    format: interpreted.specs.format,
  });
  assert.equal(plan.actions[0].spec?.showGridlines, false);
});

test("a multi-step instruction becomes one safe reviewable plan", () => {
  const interpreted = interpretInstruction(
    "Clean and trim the data, then create a PivotTable of Sales by Region, then create a chart of Sales by Region",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.actions, ["clean", "pivot-table", "chart"]);
  assert.deepEqual(interpreted.specs.clean?.operations, [
    "trim",
    "text-to-number",
    "dedupe",
  ]);
  assert.deepEqual(interpreted.specs.pivot, {
    rows: 1,
    values: 2,
    aggregation: "sum",
  });
  assert.deepEqual(interpreted.specs.chart, {
    category: 1,
    value: 2,
    chartType: "column",
  });
});

test("chart data-label requests are explicit and planner-safe", () => {
  const interpreted = interpretInstruction(
    "Create a Sales chart with data labels by Region",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.actions, ["chart"]);
  assert.equal(interpreted.specs.chart?.showDataLabels, true);
  const plan = createExcelPreviewPlan(input as any, ["chart"], 500, {
    chart: interpreted.specs.chart,
  });
  assert.equal(plan.actions[0].spec?.showDataLabels, true);
});

test("quoted chart axis titles are carried into the chart plan", () => {
  const interpreted = interpretInstruction(
    'Create a column chart of Sales by Region with category axis title "Sales region" and value axis title "Revenue (LKR)"',
    headers,
    rows,
  );
  assert.deepEqual(interpreted.actions, ["chart"]);
  assert.deepEqual(interpreted.specs.chart?.axisTitles, {
    category: "Sales region",
    value: "Revenue (LKR)",
  });
  const plan = createExcelPreviewPlan(input as any, ["chart"], 500, {
    chart: interpreted.specs.chart,
  });
  assert.equal(plan.actions[0].spec?.chartCategoryAxisTitle, "Sales region");
  assert.equal(plan.actions[0].spec?.chartValueAxisTitle, "Revenue (LKR)");
});

test("chart legend visibility and position are carried into the chart plan", () => {
  const interpreted = interpretInstruction(
    "Create a column chart of Sales by Region without the legend, legend at bottom",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.actions, ["chart"]);
  assert.deepEqual(interpreted.specs.chart?.legend, {
    visible: false,
    position: "Bottom",
  });
  const plan = createExcelPreviewPlan(input as any, ["chart"], 500, {
    chart: interpreted.specs.chart,
  });
  assert.equal(plan.actions[0].spec?.chartLegendVisible, false);
  assert.equal(plan.actions[0].spec?.chartLegendPosition, "Bottom");
});

test("pivot-result chart requests compose pivot before chart", () => {
  const interpreted = interpretInstruction(
    "Create a PivotTable of Sales by Region and chart the pivot result",
    headers,
    rows,
  );
  assert.deepEqual(interpreted.actions, ["chart", "pivot-table"]);
  const plan = createExcelPreviewPlan(
    input as any,
    interpreted.actions as any,
    500,
    { ...interpreted.specs },
  );
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["pivot-table", "chart"],
  );
  assert.equal(
    plan.actions[1].spec?.pivotSourceName,
    "Sheet1_Vynor_pivot_table",
  );
});

test("a fill-blanks instruction can target a named column", () => {
  const parsed = interpretInstruction(
    "Fill blank Status values with Unknown",
    ["Customer", "Status", "Sales"],
    [
      ["Asha", null, 10],
      ["Bimal", "Open", 20],
    ],
  );
  assert.deepEqual(parsed.actions, ["clean"]);
  assert.deepEqual(parsed.specs.clean, {
    operations: ["fill-blanks"],
    fillBlanks: "Unknown",
    fillBlanksColumn: 1,
  });
});

test("formula audit requests use the formula quality mode", () => {
  const parsed = interpretInstruction(
    "Audit formulas for errors and circular references",
    ["Customer", "Sales"],
    [["Asha", 10]],
  );
  assert.deepEqual(parsed.actions, ["quality"]);
  assert.deepEqual(parsed.specs.quality, { mode: "formula" });
});

test("formula explanation requests use the reviewed formula report", () => {
  for (const instruction of [
    "Explain this formula in plain language",
    "What does the formula in the selected cell do?",
    "Describe the selected formula and its references",
  ]) {
    const parsed = interpretInstruction(
      instruction,
      ["Customer", "Sales"],
      [["Asha", 10]],
    );
    assert.deepEqual(parsed.actions, ["quality"], instruction);
    assert.deepEqual(parsed.specs.quality, { mode: "formula" }, instruction);
  }
});

test("formula repair requests use the reviewed repair quality mode", () => {
  const parsed = interpretInstruction(
    "Fix divide by zero errors in the selected formulas",
    ["Customer", "Sales"],
    [["Asha", 10]],
  );
  assert.deepEqual(parsed.actions, ["quality"]);
  assert.deepEqual(parsed.specs.quality, { mode: "repair" });
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

test("the quality report does not flag leading-zero codes as numbers stored as text", () => {
  const codes = buildQualityReport(
    ["Order No", "Qty"],
    [
      ["000001", 1],
      ["000002", 2],
      ["000003", 3],
      ["000004", 4],
    ],
  );
  assert.deepEqual(codes.findings, ["No problems found in the selected data."]);
  const plain = buildQualityReport(
    ["Amount"],
    [["1200"], ["1300"], ["1400"], ["1500"]],
  );
  assert.match(plain.findings.join("\n"), /stored as text/);
});

test("the quality report checks the business key, not only whole rows", () => {
  // T-2 was entered twice with a different date, so no whole row repeats.
  const report = buildQualityReport(
    ["Txn ID", "Date", "Amount"],
    [
      ["T-1", "2026-01-01", 100],
      ["T-2", "2026-01-01", 200],
      ["T-2", "2026-01-02", 200],
      ["T-3", "2026-01-02", 50],
      ["T-4", "2026-01-03", 75],
    ],
  );
  const text = report.findings.join("\n");
  assert.doesNotMatch(text, /duplicate row\(s\) found/);
  assert.match(
    text,
    /Txn ID: 1 value\(s\) are used on more than one row \(1 extra row\(s\)\)/,
  );
  assert.deepEqual(report.businessKey?.names, ["Txn ID"]);
  const keyRow = report.values.find((row) => row[0] === "Business key");
  assert.deepEqual(keyRow, ["Business key", "Txn ID"]);
  // The column table stays where the writer bolds it.
  assert.equal(report.values[report.headerRow][0], "Column");
});
