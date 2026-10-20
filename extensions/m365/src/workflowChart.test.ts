import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretInstruction } from "./intent.js";

const HEADERS = ["Order No", "Region", "Qty", "Unit Price", "Net Amount"];
const ROWS = Array.from({ length: 20 }, (_, index) => [
  `00${index}`,
  ["North", "South"][index % 2],
  index + 1,
  10 + index,
  (index + 1) * (10 + index),
]);

const spec = (text: string): any =>
  (interpretInstruction(text, HEADERS, ROWS as any) as any).specs;

test("'pivot ... then chart it' charts the pivot, not the first column and every number", () => {
  for (const text of [
    "clean the data, then pivot total Net Amount by Region, then chart it",
    "pivot total Net Amount by Region, then chart it",
    "pivot total Net Amount by Region then draw a bar chart of it",
  ]) {
    const specs = spec(text);
    assert.equal(specs.chart.category, 1, text);
    assert.equal(specs.chart.value, 4, text);
    assert.equal(specs.chart.extraValues, undefined, text);
  }
  assert.equal(
    spec("pivot total Net Amount by Region then draw a bar chart of it").chart
      .chartType,
    "bar",
  );
});

test("a chart step that names its own columns keeps them", () => {
  const specs = spec(
    "pivot total Net Amount by Region, then bar chart of Qty by Region",
  );
  assert.equal(specs.chart.value, 2);
});
