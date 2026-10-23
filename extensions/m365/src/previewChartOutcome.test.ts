import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutcomes } from "./outcome.js";

const headers = ["Region", "Net Amount"];
const rows = [
  ["West", 100],
  ["East", 40],
  ["West", 50],
  ["South", 10],
  ["East", 20],
];

const chart = (spec: Record<string, unknown>, extra: any[] = []) =>
  buildOutcomes(
    [
      {
        kind: "chart",
        targetSheet: "Sales_Vynor_Result",
        spec: { categoryIndex: 0, valueIndex: 1, chartType: "column", ...spec },
      },
      ...extra,
    ],
    headers,
    rows,
  )[0];

test("the preview chart has one bar per category, like the chart that is written", () => {
  const item = chart({});
  assert.deepEqual(item.chart?.categories, ["West", "East", "South"]);
  assert.deepEqual(item.chart?.series[0].values, [150, 60, 10]);
});

test("the preview follows Summarize by and Top-N", () => {
  const average = chart({ aggregation: "average" });
  assert.deepEqual(average.chart?.series[0].values, [75, 30, 10]);
  assert.match(average.title, /Column chart: Average Net Amount by Region/);

  const top = chart({ topN: 2 });
  assert.deepEqual(top.chart?.categories, ["West", "East"]);
  assert.ok(top.details.some((line) => /only the 2 largest Region/.test(line)));

  const lowest = chart({ topN: 1, lowest: true });
  assert.deepEqual(lowest.chart?.categories, ["South"]);
  assert.ok(lowest.details.some((line) => /only the 1 smallest/.test(line)));
});

test("a time axis keeps one point per row, unless a summary was asked for", () => {
  const dated = buildOutcomes(
    [
      {
        kind: "chart",
        targetSheet: "S",
        spec: { categoryIndex: 0, valueIndex: 1, chartType: "line" },
      },
    ],
    ["Month", "Sales"],
    [
      ["Jan", 5],
      ["Jan", 7],
      ["Feb", 9],
    ],
  )[0];
  assert.deepEqual(dated.chart?.series[0].values, [5, 7, 9]);
});

test("a histogram still shows the raw values", () => {
  const item = chart({ chartType: "histogram", categoryIndex: 1 });
  assert.equal(item.chart?.series[0].values.length, rows.length);
});

test("a chart that draws a PivotTable previews that PivotTable's summary", () => {
  const item = chart({ pivotSourceName: "Sales_Vynor_pivot_table" }, [
    {
      kind: "pivot-table",
      targetSheet: "Sales_Vynor_Result",
      spec: {
        rowsIndex: 0,
        rowsColumn: "Region",
        valuesIndex: 1,
        valuesColumn: "Net Amount",
        aggregation: "average",
        topN: 2,
      },
    },
  ]);
  assert.deepEqual(item.chart?.categories, ["West", "East"]);
  assert.deepEqual(item.chart?.series[0].values, [75, 30]);
});

test("the preview text is also written in Sinhala and Tamil", () => {
  const spec = { topN: 2, aggregation: "average" };
  const build = (language: "si" | "ta") =>
    buildOutcomes(
      [
        {
          kind: "chart",
          targetSheet: "S",
          spec: {
            categoryIndex: 0,
            valueIndex: 1,
            chartType: "column",
            ...spec,
          },
        },
      ],
      headers,
      rows,
      language,
    )[0];
  assert.match(build("si").details.join(" "), /විශාලතම 2/);
  assert.match(build("ta").details.join(" "), /மிகப் பெரிய 2/);
});
