import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFollowUpChart } from "./followUp.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const earlier = { pivot: { rows: 1, values: 2 } } as any;

test("a follow-up chart reuses the last pivot columns", () => {
  const out = applyFollowUpChart(
    { chart: { category: 0, value: 2, chartType: "line", extraValues: [3] } },
    earlier,
    "Now add a chart for that",
    headers,
    ["chart"],
  );
  assert.equal(out.applied, true);
  assert.deepEqual(out.specs.chart, {
    category: 1,
    value: 2,
    chartType: "column",
  });
});

test("a request that names a column or has no earlier pivot is left alone", () => {
  const specs = { chart: { category: 0, value: 2, chartType: "line" } } as any;
  assert.equal(
    applyFollowUpChart(specs, earlier, "chart of Cost for that", headers, [
      "chart",
    ]).applied,
    false,
  );
  assert.equal(
    applyFollowUpChart(specs, undefined, "add a chart for that", headers, [
      "chart",
    ]).applied,
    false,
  );
  assert.equal(
    applyFollowUpChart(specs, earlier, "make a pie chart of that", headers, [
      "chart",
    ]).specs.chart?.chartType,
    "pie",
  );
});
