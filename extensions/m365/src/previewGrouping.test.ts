import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExcelColumnSpecs } from "./excel.js";
import { canGroup, changeGrouping, readGrouping } from "./previewGrouping.js";

const chartOnly = (): ExcelColumnSpecs => ({
  chart: { category: 0, value: 1, chartType: "column" },
});

test("a plain chart can be summarized; a histogram, a waterfall and a PivotTable result cannot", () => {
  assert.equal(canGroup(chartOnly()), true);
  assert.equal(
    canGroup({ chart: { category: 0, value: 1, chartType: "histogram" } }),
    false,
  );
  assert.equal(
    canGroup({ chart: { category: 0, value: 1, chartType: "waterfall" } }),
    false,
  );
  assert.equal(
    canGroup({
      chart: { category: 0, value: 1, chartType: "column", pivotResult: true },
    }),
    false,
  );
  assert.equal(canGroup({ pivot: { rows: 0, values: 1 } }), true);
  assert.equal(canGroup(undefined), false);
  assert.equal(canGroup({}), false);
});

test("a chart that draws a PivotTable is summarized through the PivotTable", () => {
  const specs: ExcelColumnSpecs = {
    chart: { category: 0, value: 1, chartType: "column", pivotResult: true },
    pivot: { rows: 0, values: 1, aggregation: "max", topN: 3, lowest: true },
  };
  assert.deepEqual(readGrouping(specs), {
    aggregation: "max",
    topN: 3,
    lowest: true,
  });
  changeGrouping(specs, { aggregation: "average", topN: null });
  assert.equal(specs.pivot?.aggregation, "average");
  assert.equal(specs.pivot?.topN, undefined);
  assert.equal(specs.chart?.aggregation, undefined);
  assert.equal(specs.chart?.topN, undefined);
});

test("changing a chart-only plan writes the chart; sum is the default and is not stored", () => {
  const specs = chartOnly();
  assert.deepEqual(readGrouping(specs), { aggregation: "sum", lowest: false });
  changeGrouping(specs, { aggregation: "average" });
  changeGrouping(specs, { topN: 5 });
  changeGrouping(specs, { lowest: true });
  assert.deepEqual(specs.chart, {
    category: 0,
    value: 1,
    chartType: "column",
    aggregation: "average",
    topN: 5,
    lowest: true,
  });
  assert.deepEqual(readGrouping(specs), {
    aggregation: "average",
    topN: 5,
    lowest: true,
  });
  changeGrouping(specs, { aggregation: "sum", topN: null });
  assert.equal(specs.chart?.aggregation, undefined);
  assert.equal(specs.chart?.topN, undefined);
});

test("a PivotTable and a chart of the raw rows stay consistent", () => {
  const specs: ExcelColumnSpecs = {
    chart: { category: 0, value: 1, chartType: "line" },
    pivot: { rows: 0, values: 1 },
  };
  changeGrouping(specs, { aggregation: "min", topN: 4 });
  assert.equal(specs.pivot?.aggregation, "min");
  assert.equal(specs.pivot?.topN, 4);
  assert.equal(specs.chart?.aggregation, "min");
  // A line chart has a time axis: the server rejects a top N there, so only the PivotTable keeps it.
  assert.equal(specs.chart?.topN, undefined);
});

test("nothing changes when the plan has nothing to summarize", () => {
  const specs: ExcelColumnSpecs = {
    chart: { category: 0, value: 1, chartType: "histogram" },
  };
  changeGrouping(specs, { aggregation: "average", topN: 3 });
  assert.deepEqual(specs.chart, {
    category: 0,
    value: 1,
    chartType: "histogram",
  });
  assert.equal(readGrouping(specs), undefined);
});

import { normalizeChartGrouping } from "./previewGrouping.js";

test("chart settings the server rejects are dropped for the chart as it now is", () => {
  const waterfall: any = { chart: { category: 0, value: 1, chartType: "waterfall", topN: 3, lowest: true, aggregation: "average" } };
  normalizeChartGrouping(waterfall);
  assert.deepEqual(waterfall.chart, { category: 0, value: 1, chartType: "waterfall" });
  const line: any = { chart: { category: 0, value: 1, chartType: "line", topN: 3, lowest: true, aggregation: "average" } };
  normalizeChartGrouping(line);
  assert.deepEqual(line.chart, { category: 0, value: 1, chartType: "line", aggregation: "average" });
  const lowestOnly: any = { chart: { category: 0, value: 1, chartType: "column", lowest: true } };
  normalizeChartGrouping(lowestOnly);
  assert.equal(lowestOnly.chart.lowest, undefined);
  const column: any = { chart: { category: 0, value: 1, chartType: "column", topN: 3, lowest: true } };
  normalizeChartGrouping(column);
  assert.equal(column.chart.topN, 3);
});
