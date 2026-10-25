import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildOutcomes } from "./outcome.js";
import {
  buildDescribeCells,
  buildAdvancedForecastCells,
  buildAnovaCells,
  buildCorrelationMatrixCells,
  buildAnomalyCells,
  buildFinancialCells,
  buildForecastCells,
  buildInsightReportCells,
  buildInsightReportPreview,
  buildPairedTTestCells,
  buildRegressionCells,
  buildSpearmanCells,
  correlation,
  correlationMatrix,
  describeColumns,
  linearForecast,
  anovaOneWay,
  anovaGroupSummary,
  pairedTTest,
  regression,
  spearmanCorrelation,
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

test("correlation matrix reports pairwise coefficients and live formulas", () => {
  const matrix = correlationMatrix(rows as any, [2, 3]);
  assert.deepEqual(matrix, [
    [1, 1],
    [1, 1],
  ]);
  const cells = buildCorrelationMatrixCells(
    { sheetName: "Sheet1", startColumn: 0, startRow: 1, endRow: 4 },
    headers,
    [2, 3],
  );
  assert.equal(cells[0][0], "Column");
  assert.match(cells[1][2], /CORREL/);
});

test("regression reports complete numeric pairs and explainable coefficients", () => {
  const result = regression(
    [
      [1, 3],
      [2, 5],
      [3, 7],
      ["missing", 9],
    ] as any,
    0,
    1,
  );
  assert.equal(result.pairs, 3);
  assert.equal(result.correlation, 1);
  assert.equal(result.rSquared, 1);
  assert.equal(result.slope, 2);
  assert.equal(result.intercept, 1);
  assert.equal(result.residualStdError, 0);
  assert.equal(result.relationship, "positive");
  assert.equal(
    regression(
      [
        [1, 2],
        [1, 3],
        [1, 4],
      ] as any,
      0,
      1,
    ).relationship,
    "insufficient",
  );
});

test("paired t-test uses only complete pairs and returns a bounded p-value", () => {
  const result = pairedTTest(
    [
      [10, 9],
      [11, 9],
      [12, 9],
      [13, 9],
      [14, 9],
      ["missing", 9],
    ] as any,
    0,
    1,
  );
  assert.equal(result.pairs, 5);
  assert.equal(result.meanDifference, 3);
  assert.equal(result.degreesOfFreedom, 4);
  assert.equal(result.interpretation, "significant");
  assert.ok(
    typeof result.pValue === "number" &&
      result.pValue > 0 &&
      result.pValue < 0.05,
  );
});

test("one-way ANOVA compares category means with transparent degrees of freedom", () => {
  const result = anovaOneWay(
    [
      ["A", 1],
      ["A", 2],
      ["B", 5],
      ["B", 6],
      ["C", 10],
      ["C", 11],
      ["C", "bad"],
    ] as any,
    0,
    1,
  );
  assert.equal(result.groups, 3);
  assert.equal(result.observations, 6);
  assert.equal(result.betweenDf, 2);
  assert.equal(result.withinDf, 3);
  assert.equal(result.interpretation, "significant");
  assert.ok(typeof result.fStatistic === "number" && result.fStatistic > 0);
  assert.ok(typeof result.pValue === "number" && result.pValue < 0.05);
  assert.ok(
    typeof result.etaSquared === "number" &&
      result.etaSquared > 0 &&
      result.etaSquared < 1,
  );
  assert.deepEqual(
    anovaGroupSummary(
      [
        ["B", 5],
        ["A", 1],
        ["A", 3],
        ["B", 7],
      ] as any,
      0,
      1,
    ),
    [
      { group: "A", observations: 2, mean: 2, standardDeviation: 1.41 },
      { group: "B", observations: 2, mean: 6, standardDeviation: 1.41 },
    ],
  );
});

test("Spearman correlation ranks numeric pairs and handles ties deterministically", () => {
  const result = spearmanCorrelation(
    [
      [1, 10],
      [2, 20],
      [2, 30],
      [4, 40],
      ["bad", 50],
    ] as any,
    0,
    1,
  );
  assert.equal(result.pairs, 4);
  assert.equal(result.rho, 0.95);
  assert.equal(result.rhoSquared, 0.9);
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
  const regressionCells = buildRegressionCells(range, headers, 2, 3);
  assert.match(regressionCells[3][1], /SUMPRODUCT.*ISNUMBER/);
  assert.match(regressionCells[5][1], /RSQ/);
  assert.match(regressionCells[8][1], /STEYX/);
  const tTestCells = buildPairedTTestCells(range, headers, 2, 3);
  assert.match(tTestCells[4][1], /AVERAGE\(FILTER/);
  assert.match(tTestCells[8][1], /T\.TEST/);
  const anovaCells = buildAnovaCells(range, headers, 1, 2);
  assert.match(anovaCells[3][1], /COUNTA\(UNIQUE\(FILTER/);
  assert.match(anovaCells[11][1], /F\.DIST\.RT/);
  assert.equal(anovaCells[9][0], "Eta-squared");
  assert.match(anovaCells[9][1], /B8\/\(B8\+B9\)/);
  assert.equal(anovaCells[14][0], "Group summary");
  assert.match(anovaCells[15][0], /SORT\(UNIQUE\(FILTER/);
  assert.match(anovaCells[15][3], /STDEV\.S\(FILTER/);
  const spearmanCells = buildSpearmanCells(range, headers, 2, 3);
  assert.match(spearmanCells[1][1], /RANK\.AVG/);
  assert.match(spearmanCells[1][3], /SUMPRODUCT/);
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
  const spearman = interpretInstruction(
    "Calculate Spearman correlation between Sales and Cost",
    headers,
    rows as any,
  );
  assert.deepEqual(spearman.specs.statistics, {
    mode: "spearman",
    pair: [2, 3],
  });
  const reg = interpretInstruction(
    "Run a linear regression of Cost on Sales and show the R squared and slope",
    headers,
    rows as any,
  );
  assert.deepEqual(reg.specs.statistics, { mode: "regression", pair: [2, 3] });
  const tTest = interpretInstruction(
    "Run a paired t-test to see whether Sales and Cost are statistically different",
    headers,
    rows as any,
  );
  assert.deepEqual(tTest.specs.statistics, { mode: "t-test", pair: [2, 3] });
  const anova = interpretInstruction(
    "Run a one-way ANOVA of Sales by Region",
    headers,
    rows as any,
  );
  assert.deepEqual(anova.specs.statistics, {
    mode: "anova",
    value: 2,
    category: 1,
  });
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
  const regressionPlan = createExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    reg.specs as any,
  );
  assert.equal(regressionPlan.actions[0].spec?.statistics?.mode, "regression");
  assert.deepEqual(
    regressionPlan.actions[0].spec?.statistics?.pair?.map(
      (entry) => entry.column,
    ),
    ["Sales", "Cost"],
  );
  const [regressionOutcome] = buildOutcomes(
    regressionPlan.actions as any,
    headers,
    rows as any,
  );
  assert.deepEqual(regressionOutcome.table?.rows.slice(2, 6), [
    ["Observations", "4"],
    ["Correlation (r)", "1"],
    ["R squared", "1"],
    ["Slope", "0.5"],
  ]);
  const tTestPlan = createExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    tTest.specs as any,
  );
  assert.equal(tTestPlan.actions[0].spec?.statistics?.mode, "t-test");
  const anovaPlan = createExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    anova.specs as any,
  );
  assert.equal(anovaPlan.actions[0].spec?.statistics?.mode, "anova");
  const [anovaOutcome] = buildOutcomes(
    anovaPlan.actions as any,
    headers,
    rows as any,
  );
  assert.equal(anovaOutcome.table?.rows[0][0], "Category");
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
