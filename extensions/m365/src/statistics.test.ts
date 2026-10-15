import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildOutcomes } from "./outcome.js";
import {
  buildDescribeCells,
  buildForecastCells,
  correlation,
  describeColumns,
  linearForecast,
} from "./statistics.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const rows = [
  ["Jan", "North", 100, 50],
  ["Feb", "South", 200, 100],
  ["Mar", "North", 300, 150],
  ["Apr", "East", 400, 200],
];
const input = {
  workbookId: "w",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D5",
  hasHeaders: true,
  values: [headers, ...rows],
} as any;

test("describe computes count, mean, median, quartiles and spread", () => {
  const [count, mean, median, std, min, q1, q3, max] = describeColumns(
    rows as any,
    [2],
  );
  assert.deepEqual(count.values, [4]);
  assert.deepEqual(mean.values, [250]);
  assert.deepEqual(median.values, [250]);
  assert.deepEqual(std.values, [129.1]);
  assert.deepEqual(min.values, [100]);
  assert.deepEqual(q1.values, [175]);
  assert.deepEqual(q3.values, [325]);
  assert.deepEqual(max.values, [400]);
});

test("correlation and linear forecast agree with the arithmetic", () => {
  assert.equal(correlation(rows as any, 2, 3).r, 1);
  assert.deepEqual(linearForecast([100, 200, 300, 400], 2), [500, 600]);
  assert.deepEqual(linearForecast([1, 2], 2), []);
});

test("formulas reference the source range and never contain model text", () => {
  const range = { sheetName: "Sheet1", startColumn: 0, startRow: 1, endRow: 5 };
  const cells = buildDescribeCells(range, headers, [2]);
  assert.equal(cells[1][1], "=COUNT('Sheet1'!$C$2:$C$5)");
  const forecast = buildForecastCells(range, headers, 2, 2);
  assert.equal(forecast.length, 1 + 4 + 2);
  assert.match(
    forecast.at(-1)![2],
    /^=FORECAST\(A7,\$B\$2:\$B\$5,\$A\$2:\$A\$5\)$/,
  );
});

test("instructions are understood and planned like any other action", () => {
  const stats = interpretInstruction(
    "Describe Sales and Cost",
    headers,
    rows as any,
  );
  assert.deepEqual(stats.actions, ["statistics"]);
  assert.deepEqual(stats.specs.statistics?.columns, [2, 3]);
  const corr = interpretInstruction(
    "Correlation between Sales and Cost",
    headers,
    rows as any,
  );
  assert.equal(corr.specs.statistics?.mode, "correlation");
  const fore = interpretInstruction(
    "Forecast Sales for the next 4 periods",
    headers,
    rows as any,
  );
  assert.equal(fore.specs.statistics?.periods, 4);
  const plan = createExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    fore.specs as any,
  );
  assert.equal(plan.actions[0].targetSheet, "Sheet1_Vynor_Stats");
  assert.equal(plan.actions[0].spec?.statistics?.value?.column, "Sales");
  const [outcome] = buildOutcomes(plan.actions as any, headers, rows as any);
  assert.deepEqual(outcome.table?.rows[0], ["5", "500"]);
  assert.throws(
    () =>
      createExcelPreviewPlan(input, ["statistics"], 500, {
        statistics: { mode: "correlation", pair: [1, 2] },
      }),
    /numeric/,
  );
});

test("a dashboard request becomes a chart, a pivot and statistics", () => {
  const asked = interpretInstruction(
    "Build a dashboard of Sales by Region",
    headers,
    rows as any,
  );
  assert.deepEqual([...asked.actions].sort(), [
    "chart",
    "pivot-table",
    "statistics",
  ]);
  const plan = createExcelPreviewPlan(
    input,
    asked.actions as any,
    500,
    asked.specs as any,
  );
  assert.equal(plan.actions.length, 3);
});
