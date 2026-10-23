import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateNumbers,
  chartCellNumber,
  chartNeedsGrouping,
  groupChartRows,
} from "./chartGroups.js";

const rows = [
  ["West", 100, 1],
  ["East", 40, 2],
  ["West", 50, 3],
  ["South", 10, 4],
  ["East", "", 5],
  ["East", "n/a", 6],
];

test("rows are summed per category in the order the categories first appear", () => {
  assert.deepEqual(groupChartRows(rows, 0, [1]), [
    { key: "West", values: [150] },
    { key: "East", values: [40] },
    { key: "South", values: [10] },
  ]);
});

test("blank and text cells are skipped, not read as zero", () => {
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { aggregation: "average" }).map(
      (g) => g.values,
    ),
    [[75], [40], [10]],
  );
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { aggregation: "count" }).map((g) => g.values),
    [[2], [1], [1]],
  );
});

test("min and max are per category", () => {
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { aggregation: "max" }).map(
      (g) => g.values[0],
    ),
    [100, 40, 10],
  );
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { aggregation: "min" }).map(
      (g) => g.values[0],
    ),
    [50, 40, 10],
  );
});

test("several value columns are aggregated side by side", () => {
  assert.deepEqual(groupChartRows(rows, 0, [1, 2])[0], {
    key: "West",
    values: [150, 4],
  });
});

test("top N keeps the largest groups by the first value column, the smallest with lowest", () => {
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { topN: 2 }).map((g) => g.key),
    ["West", "East"],
  );
  assert.deepEqual(
    groupChartRows(rows, 0, [1], { topN: 1, lowest: true }).map((g) => g.key),
    ["South"],
  );
  // A top N larger than the number of groups shows every group.
  assert.equal(groupChartRows(rows, 0, [1], { topN: 50 }).length, 3);
});

test("ties keep the order the categories first appeared in", () => {
  const tied = [
    ["B", 5],
    ["A", 5],
    ["C", 9],
  ];
  assert.deepEqual(
    groupChartRows(tied, 0, [1], { topN: 3 }).map((g) => g.key),
    ["C", "B", "A"],
  );
});

test("a blank category is its own group", () => {
  assert.deepEqual(
    groupChartRows(
      [
        [null, 3],
        ["", 4],
        ["X", 1],
      ],
      0,
      [1],
    ),
    [
      { key: "", values: [7] },
      { key: "X", values: [1] },
    ],
  );
});

test("helpers read numbers the way the writer does", () => {
  assert.equal(chartCellNumber(5), 5);
  assert.equal(chartCellNumber("12.5"), 12.5);
  assert.equal(chartCellNumber(" "), undefined);
  assert.equal(chartCellNumber(null), undefined);
  assert.equal(chartCellNumber(true), undefined);
  assert.equal(chartCellNumber("abc"), undefined);
  assert.equal(aggregateNumbers([]), 0);
  assert.equal(aggregateNumbers([2, 4], "average"), 3);
});

test("a chart is grouped when a category repeats, unless the axis is a point in time", () => {
  assert.equal(chartNeedsGrouping(rows, 0, "Region"), true);
  assert.equal(chartNeedsGrouping(rows, 0, "Order Date"), false);
  assert.equal(
    chartNeedsGrouping(
      [
        ["A", 1],
        ["B", 2],
      ],
      0,
      "Region",
    ),
    false,
  );
});

test("a summary the person asked for always groups, even on a time axis or unique names", () => {
  const unique = [
    ["A", 1],
    ["B", 2],
  ];
  assert.equal(chartNeedsGrouping(unique, 0, "Region", { topN: 1 }), true);
  assert.equal(
    chartNeedsGrouping(unique, 0, "Month", { aggregation: "average" }),
    true,
  );
  // The default aggregation alone is not a request for a summary.
  assert.equal(
    chartNeedsGrouping(unique, 0, "Region", { aggregation: "sum" }),
    false,
  );
  assert.equal(chartNeedsGrouping(unique, 0, "Region", {}, true), true);
});

test("stray spaces do not split a category", () => {
  const groups = groupChartRows(
    [
      [" Central ", 10],
      ["Central", 5],
      ["Central  ", 1],
      ["North", 2],
    ],
    0,
    [1],
  );
  assert.deepEqual(groups, [
    { key: "Central", values: [16] },
    { key: "North", values: [2] },
  ]);
});
