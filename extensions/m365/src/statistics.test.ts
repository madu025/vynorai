import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildOutcomes } from "./outcome.js";
import {
  buildDescribeCells,
  buildAdvancedForecastCells,
  buildAnomalyCells,
  buildFinancialCells,
  buildForecastCells,
  buildInsightReportCells,
  buildInsightReportPreview,
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

test("advanced reports use source formulas with explicit fallbacks and evidence", () => {
  const range = { sheetName: "Sheet1", startColumn: 0, startRow: 1, endRow: 5 };
  const forecast = buildAdvancedForecastCells(range, headers, 2, 2, 0);
  assert.equal(forecast[0][5], "Detected seasonality");
  assert.match(forecast.at(-1)![0], /^=MAX\(\$A\$2:\$A\$5\)\+2$/);
  assert.match(forecast.at(-1)![2], /FORECAST\.ETS/);
  assert.match(forecast.at(-1)![2], /FORECAST\(/);
  assert.match(forecast.at(-1)![5], /FORECAST\.ETS\.SEASONALITY/);

  const financial = buildFinancialCells(range, headers, [2, 3, 3]);
  assert.match(financial[6][1], /SUM\('Sheet1'!\$C\$2:\$C\$5\)/);
  assert.match(financial[9][2], /No invested-capital/);

  const anomaly = buildAnomalyCells(range, headers, 2);
  assert.match(anomaly[7][2], /outside the fences/);
  assert.match(anomaly[8][2], /not proof of fraud/);
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

test("advanced analyst wording selects the matching deterministic report mode", () => {
  const advanced = interpretInstruction(
    "forecast Sales for the next 6 periods with seasonality and confidence intervals",
    headers,
    rows as any,
  );
  assert.equal(advanced.specs.statistics?.mode, "advanced-forecast");
  assert.equal(advanced.specs.statistics?.date, 0);

  const financial = interpretInstruction(
    "create a financial report for Revenue, COGS and Operating Expenses",
    ["Month", "Revenue", "COGS", "Operating Expenses"],
    rows.map((row) => [row[0], row[2], row[3], row[3]]) as any,
  );
  assert.equal(financial.specs.statistics?.mode, "financial");
  assert.equal(financial.specs.statistics?.columns?.length, 3);

  const anomaly = interpretInstruction(
    "detect anomalies and outliers in Sales",
    headers,
    rows as any,
  );
  assert.equal(anomaly.specs.statistics?.mode, "anomaly");
  assert.equal(anomaly.specs.statistics?.value, 2);
});

test("a dashboard request becomes one dashboard action and one result sheet", () => {
  const asked = interpretInstruction(
    "Build a dashboard of Sales and Cost by Region",
    headers,
    rows as any,
  );
  assert.deepEqual(asked.actions, ["dashboard"]);
  assert.deepEqual(asked.specs.dashboard, {
    category: 1,
    values: [2, 3],
    aggregation: "sum",
  });
  const plan = createExcelPreviewPlan(
    input,
    asked.actions as any,
    500,
    asked.specs as any,
  );
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].targetSheet, "Sheet1_Vynor_Dashboard");
  assert.equal(plan.actions[0].spec?.dashboard?.category.column, "Region");
  assert.deepEqual(
    plan.actions[0].spec?.dashboard?.values.map((entry) => entry.column),
    ["Sales", "Cost"],
  );
});

test("an insight request previews deterministic trend, IQR and contributor evidence", () => {
  const asked = interpretInstruction(
    "Explain insights for Sales by Region",
    headers,
    rows as any,
  );
  assert.deepEqual(asked.actions, ["statistics"]);
  assert.deepEqual(asked.specs.statistics, {
    mode: "insights",
    value: 2,
    category: 1,
    date: 0,
  });
  const plan = createExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    asked.specs as any,
  );
  const spec = plan.actions[0].spec!.statistics!;
  assert.equal(spec.mode, "insights");
  assert.equal(spec.value?.column, "Sales");
  assert.equal(spec.category?.column, "Region");
  const preview = buildInsightReportPreview(rows as any, headers, 2, 1, 0);
  assert.deepEqual(
    preview.rows.find(([label]) => label === "Trend"),
    ["Trend", "Rising"],
  );
  assert.deepEqual(
    preview.rows.find(([label]) => label === "Top contributor"),
    ["Top contributor", "North (400)"],
  );
  assert.deepEqual(
    preview.rows.find(([label]) => label === "Next-period estimate"),
    ["Next-period estimate", "500"],
  );
  assert.deepEqual(
    buildInsightReportPreview(
      [
        ["Jan", "North", 300],
        ["Feb", "South", 100],
        ["Mar", "East", 200],
      ] as any,
      ["Month", "Region", "Sales"],
      2,
      1,
      0,
    ).rows.find(([label]) => label === "Trend"),
    ["Trend", "Falling"],
    "trend uses the selected-row order, not values sorted for IQR",
  );
  const cells = buildInsightReportCells(
    { sheetName: "Sheet1", startColumn: 0, startRow: 1, endRow: 5 },
    headers,
    2,
    1,
    0,
  );
  assert.match(cells[4][1], /^=LET\(vals,'Sheet1'!\$C\$2:\$C\$5/);
  assert.match(cells[4][1], /"<"&\(lowerQ-1\.5\*spread\)/);
  assert.match(cells.at(-1)![1], /^=LET\(cats,UNIQUE\('Sheet1'!\$B\$2/);
  assert.equal(
    interpretInstruction(
      "Forecast and recommend next actions for Sales by Month",
      headers,
      rows as any,
    ).specs.statistics?.mode,
    "insights",
  );
});

import { buildForecastCellsLarge } from "./statistics.js";

test("a forecast of a very large column keeps the last rows and fits the trend over every row once", () => {
  const cells = buildForecastCellsLarge(
    { sheetName: "Big", startColumn: 0, startRow: 0, endRow: 520124 },
    ["Id", "Qty"],
    1,
    3,
    5,
  );
  assert.equal(cells.length, 1 + 5 + 3);
  assert.equal(cells[1][0], "520120");
  assert.equal(cells[1][1], "=INDEX('Big'!$B$2:$B$520125,520120)");
  assert.equal(cells[6][2], "=$E$3+$E$2*A7");
  assert.ok(cells[1][4].startsWith("=SLOPE('Big'!$B$2:$B$520125,SEQUENCE("));
  assert.ok(cells[2][4].startsWith("=INTERCEPT("));
  assert.ok(cells.length < 20);
});
