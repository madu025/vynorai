import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchemaSummary, isTemporalLabel } from "./analysis.js";
import { buildLocalInsights, suggestionToPlanInput } from "./insights.js";

const base = { workbookId: "b", worksheetName: "Sheet1", hasHeaders: true };

test("month, weekday and quarter labels are time axes, never identifiers", () => {
  for (const label of ["Jan", "February", "Q3", "FY2026", "2026", "Mon"])
    assert.equal(isTemporalLabel(label), true, label);
  for (const label of ["Colombo", "CUST-1", "North"])
    assert.equal(isTemporalLabel(label), false, label);

  const summary = buildSchemaSummary({
    ...base,
    address: "A1:C7",
    values: [
      ["Month", "Region", "Sales"],
      ["Jan", "North", 1],
      ["Feb", "South", 2],
      ["Mar", "North", 3],
      ["Apr", "East", 4],
      ["May", "South", 5],
      ["Jun", "East", 6],
    ],
  });
  const roles = Object.fromEntries(
    summary.columns.map((c) => [c.name, c.roleHint]),
  );
  assert.equal(roles.Month, "date");
  assert.equal(roles.Region, "category");
  assert.equal(roles.Sales, "measure");
});

test("a year column is a date axis and unique text IDs stay identifiers", () => {
  const summary = buildSchemaSummary({
    ...base,
    address: "A1:C7",
    values: [
      ["Year", "Code", "Total"],
      ...Array.from({ length: 6 }, (_, i) => [
        2020 + i,
        `ZX-${i}${i}${i}`,
        i * 10,
      ]),
    ],
  });
  assert.equal(summary.columns[0].roleHint, "date");
  assert.equal(summary.columns[1].roleHint, "identifier");
  assert.equal(summary.columns[2].roleHint, "measure");
});

const sales = {
  ...base,
  address: "A1:D13",
  values: [
    ["Month", "Region", "Sales", "Cost"],
    ["Jan", "North", 1200, 800],
    ["Feb", "South", 1500, 950],
    ["Mar", "North", 1800, 1100],
    ["Apr", "East", 1350, 900],
    ["May", "South", 2100, 1300],
    ["Jun", "East", 2200, 1250],
    ["Jul", "North", 2300, 1400],
    ["Aug", "South", 9900, 1500],
    ["Sep", "East", 2500, 1550],
    ["Oct", "North", 2600, 1600],
    ["Nov", "South", 2700, 1650],
  ],
};

test("local insights describe totals, leaders, trend and outliers", () => {
  const { insights, suggestions } = buildLocalInsights(sales as any);
  const text = insights.map((i) => `${i.title} ${i.detail}`).join("\n");
  assert.match(text, /Sales/);
  assert.match(text, /Top Region/);
  assert.match(text, /South has the highest Sales/);
  assert.match(text, /Trend is rising/);
  assert.match(text, /Unusual values in Sales/);
  const labels = suggestions.map((s) => s.label);
  assert.ok(labels.includes("Column chart: Sales by Region"));
  assert.ok(labels.includes("Line chart: Sales over Month"));
  assert.ok(labels.includes("PivotTable: total Sales by Region"));
});

test("a suggestion becomes an instruction plus explicit column indexes", () => {
  const { suggestions } = buildLocalInsights(sales as any);
  const chart = suggestions.find((s) => s.chartType === "column")!;
  assert.deepEqual(suggestionToPlanInput(chart), {
    instruction: "Create a chart.",
    specs: { chart: { category: 1, value: 2, chartType: "column" } },
  });
  const pivot = suggestions.find((s) => s.kind === "pivot-table")!;
  assert.deepEqual(suggestionToPlanInput(pivot).specs, {
    pivot: { rows: 1, values: 2 },
  });
});

test("data-quality insights flag blanks, duplicates and numbers stored as text", () => {
  const { insights } = buildLocalInsights({
    ...base,
    address: "A1:C6",
    values: [
      ["Name", "Qty", "Amount"],
      ["a", "10", 1],
      ["a", "10", 1],
      ["b", "12", null],
      ["c", "13", 4],
      ["d", "14", 5],
    ],
  } as any);
  const text = insights.map((i) => `${i.title} ${i.detail}`).join("\n");
  assert.match(text, /Missing values/);
  assert.match(text, /Duplicate rows/);
  assert.match(text, /Numbers stored as text in Qty/);
});
