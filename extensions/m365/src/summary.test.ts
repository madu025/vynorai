import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildSummaryTable, parseLocalRange } from "./transform.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const rows = [
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
  ["Mar", "North", 1800, 1100],
  ["Apr", "East", 1350, 900],
];
const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!B2:E6",
  hasHeaders: true,
  values: [headers, ...rows],
};

test("a local range is split into columns and rows", () => {
  assert.deepEqual(parseLocalRange("B2:E6"), {
    startColumn: 1,
    startRow: 2,
    endColumn: 4,
    endRow: 6,
  });
  assert.deepEqual(parseLocalRange("$A$1:$AA$10"), {
    startColumn: 0,
    startRow: 1,
    endColumn: 26,
    endRow: 10,
  });
  assert.throws(() => parseLocalRange("A1"), /rectangular/);
});

test("the summary table is made of live formulas with a total row", () => {
  const table = buildSummaryTable({
    sheetName: "Sheet1",
    localAddress: "B2:E6",
    groupIndex: 1,
    groups: ["North", "South", "East"],
    values: [
      { column: "Sales", index: 2, aggregation: "sum" },
      { column: "Cost", index: 3, aggregation: "average" },
      { column: "Sales", index: 2, aggregation: "count" },
    ],
    groupHeader: "Region",
    includeTotal: true,
  });
  assert.deepEqual(table.values[0], [
    "Region",
    "Sum of Sales",
    "Average of Cost",
    "Count of Sales",
  ]);
  // Selection starts at column B, so column index 1 is C and 2 is D.
  assert.equal(
    table.values[1][1],
    "=SUMIFS('Sheet1'!$D$3:$D$6,'Sheet1'!$C$3:$C$6,$A2)",
  );
  assert.equal(
    table.values[1][2],
    "=IFERROR(AVERAGEIFS('Sheet1'!$E$3:$E$6,'Sheet1'!$C$3:$C$6,$A2),\"\")",
  );
  assert.equal(table.values[2][3], "=COUNTIFS('Sheet1'!$C$3:$C$6,$A3)");
  assert.deepEqual(table.values[4], [
    "Total",
    "=SUM(B2:B4)",
    "=IFERROR(AVERAGE('Sheet1'!$E$3:$E$6),\"\")",
    "=SUM(D2:D4)",
  ]);
  assert.equal(table.rowCount, 5);
  assert.equal(table.formulaRows, 4);
  const noTotal = buildSummaryTable({
    sheetName: "It's data",
    localAddress: "A1:D6",
    groupIndex: 1,
    groups: ["North"],
    values: [{ column: "Sales", index: 2, aggregation: "max" }],
    groupHeader: "Region",
    includeTotal: false,
  });
  assert.equal(noTotal.rowCount, 2);
  assert.match(noTotal.values[1][1], /^=MAXIFS\('It''s data'!/);
});

test("a summary instruction is read into explicit columns", () => {
  const summary = interpretInstruction(
    "Summary of Sales and Cost by Region",
    headers,
    rows,
  );
  assert.deepEqual(summary.actions, ["summary"]);
  assert.deepEqual(summary.specs.summary, {
    group: 1,
    values: [
      { column: 2, aggregation: "sum" },
      { column: 3, aggregation: "sum" },
    ],
  });
  const average = interpretInstruction(
    "Summarize average Sales by Region",
    headers,
    rows,
  );
  assert.equal(average.specs.summary?.values[0].aggregation, "average");
  // A grouped total is a workbook request; an ungrouped total remains a local question.
  assert.deepEqual(
    interpretInstruction("total Sales by Region", headers, rows).actions,
    ["summary"],
  );
  const count = interpretInstruction(
    "Count Order ID by Customer",
    ["Order ID", "Customer", "Status"],
    [
      ["O-001", "Asha", "Open"],
      ["O-002", "Asha", "Closed"],
      ["O-003", "Bimal", "Open"],
    ],
  );
  assert.deepEqual(count.actions, ["summary"]);
  assert.deepEqual(count.specs.summary, {
    group: 1,
    values: [{ column: 0, aggregation: "count" }],
  });
  assert.deepEqual(
    interpretInstruction("Summary pivot of Sales by Region", headers, rows)
      .actions,
    ["pivot-table"],
  );
});

test("the plan lists the groups and a sheet name that fits Excel's limit", () => {
  const plan = createExcelPreviewPlan(input as any, ["summary"], 500, {
    summary: { group: 1, values: [{ column: 2, aggregation: "sum" }] },
  });
  const action = plan.actions.find((entry) => entry.kind === "summary")!;
  assert.equal(action.targetSheet, "Sheet1_Vynor_Totals");
  assert.ok(action.targetSheet.length <= 31);
  assert.deepEqual(action.spec?.groups, ["North", "South", "East"]);
  assert.equal(action.spec?.groupColumn, "Region");
  assert.throws(
    () =>
      createExcelPreviewPlan(input as any, ["summary"], 500, {
        summary: { group: 1, values: [{ column: 1, aggregation: "sum" }] },
      }),
    /differ from the group|must contain numbers/,
  );
  const long = createExcelPreviewPlan(
    { ...input, worksheetName: "A very long worksheet name here" } as any,
    ["summary"],
    500,
    { summary: { group: 1, values: [{ column: 2, aggregation: "sum" }] } },
  );
  assert.ok(
    long.actions.find((entry) => entry.kind === "summary")!.targetSheet
      .length <= 31,
  );
});

test("pivotFallbackFormula groups one column like a PivotTable with one spilled formula", async () => {
  const { pivotFallbackFormula } = await import("./transform.js");
  const out = pivotFallbackFormula({
    sheetName: "T2",
    localAddress: "A1:M366379",
    headers: ["Status", "Item Code", "Issued Quantity"],
    rowsColumn: "item code",
    valuesColumns: ["Issued Quantity"],
    aggregation: "sum",
  });
  assert.deepEqual(out.headers, ["item code", "Sum of Issued Quantity"]);
  assert.equal(
    out.formula,
    "=LET(k,SORT(FILTER(UNIQUE('T2'!$B$2:$B$366379),UNIQUE('T2'!$B$2:$B$366379)<>\"\")),r,HSTACK(k,SUMIFS('T2'!$C$2:$C$366379,'T2'!$B$2:$B$366379,k)),r)",
  );
  const top = pivotFallbackFormula({
    sheetName: "T2",
    localAddress: "A1:M366379",
    headers: ["Status", "Item Code", "Issued Quantity"],
    rowsColumn: "Item Code",
    valuesColumns: ["Issued Quantity"],
    aggregation: "count",
    topN: 5,
  });
  assert.match(top.formula, /COUNTIFS\('T2'!\$B\$2:\$B\$366379,k\)/);
  assert.match(top.formula, /TAKE\(SORTBY\(r,INDEX\(r,0,2\),-1\),5\)\)$/);
  assert.throws(
    () =>
      pivotFallbackFormula({
        sheetName: "T2",
        localAddress: "A1:C10",
        headers: ["A"],
        rowsColumn: "Nope",
        valuesColumns: ["A"],
      }),
    /not a header/,
  );
});
