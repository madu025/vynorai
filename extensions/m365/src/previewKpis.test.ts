import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan, type ExcelColumnSpecs } from "./excel.js";
import { buildPreviewKpis, compactNumber } from "./previewKpis.js";
import { localizeMessageSi } from "./messagesSi.js";
import { localizeMessageTa } from "./messagesTa.js";

const headers = ["Region", "Product", "Net Amount", "Qty"];
const rows: unknown[][] = [
  ["West", "Tea", 182500, 40],
  ["Central", "Spices", 96400, 22],
  ["South", "Tea", 121300, 30],
  ["North", "Rice", 64800, 18],
  ["West", "Spices", 203900, 51],
  ["Central", "Tea", 88700, 20],
  ["South", "Rice", 75200, 19],
  ["West", "Rice", 158400, 44],
  ["North", "Tea", 49100, 12],
  ["South", "Spices", 132800, 33],
  ["Central", "Rice", 70300, 17],
  ["West", "Tea", 176200, 38],
];
// West 721,000 · South 329,300 · Central 255,400 · North 113,900 · all 1,419,600 over 12 rows.

/** A real plan for the data, so the specs have exactly the shape the pane sees. */
function actionsFor(
  kinds: Array<"chart" | "pivot-table" | "summary" | "dashboard" | "quality">,
  specs?: ExcelColumnSpecs,
) {
  const plan = createExcelPreviewPlan(
    {
      workbookId: "book",
      worksheetName: "Sales",
      address: "Sales!A1:D13",
      hasHeaders: true,
      values: [headers, ...rows],
    } as any,
    kinds,
    500,
    specs,
  );
  return plan.actions as Array<{ kind: string; spec?: Record<string, any> }>;
}

const chartSpecs = (extra: Record<string, unknown> = {}): ExcelColumnSpecs => ({
  chart: { category: 0, value: 2, chartType: "column", ...extra } as any,
});

const byId = (tiles: ReturnType<typeof buildPreviewKpis>) =>
  Object.fromEntries(tiles.map((tile) => [tile.id, tile]));

test("a chart shows the real total, the top group with its share, and the row count", () => {
  const tiles = buildPreviewKpis({
    actions: actionsFor(["chart"], chartSpecs()),
    headers,
    rows,
  });
  assert.deepEqual(
    tiles.map((tile) => tile.id),
    ["total", "top", "rows"],
  );
  const kpi = byId(tiles);
  assert.equal(kpi.total.label, "Total");
  assert.equal(kpi.total.value, "1.42M");
  assert.equal(kpi.total.title, "1,419,600");
  assert.equal(kpi.total.sub, "Net Amount");
  assert.equal(kpi.top.label, "Top group");
  assert.equal(kpi.top.value, "West");
  assert.equal(kpi.top.sub, "50.8% of total");
  assert.equal(kpi.top.title, "West: 721,000");
  assert.equal(kpi.rows.value, "12");
  assert.equal(kpi.rows.sub, "4 groups");
});

test("the figures follow the summary the person picks (average)", () => {
  const kpi = byId(
    buildPreviewKpis({
      actions: actionsFor(["chart"], chartSpecs({ aggregation: "average" })),
      headers,
      rows,
    }),
  );
  assert.equal(kpi.total.label, "Average");
  assert.equal(kpi.total.value, "118.3K");
  // Averages do not add up to a total, so the top group shows its own average, not a share.
  assert.equal(kpi.top.value, "West");
  assert.equal(kpi.top.sub, "180.3K");
});

test("the smallest groups first: the tile names the lowest group", () => {
  const kpi = byId(
    buildPreviewKpis({
      actions: actionsFor(["chart"], chartSpecs({ topN: 2, lowest: true })),
      headers,
      rows,
    }),
  );
  assert.equal(kpi.top.label, "Lowest group");
  assert.equal(kpi.top.value, "North");
  assert.equal(kpi.top.sub, "8% of total");
});

test("a PivotTable, a summary and a dashboard give the same figures", () => {
  const pivot = byId(
    buildPreviewKpis({
      actions: actionsFor(["pivot-table"], { pivot: { rows: 0, values: 2 } }),
      headers,
      rows,
    }),
  );
  assert.equal(pivot.total.title, "1,419,600");
  assert.equal(pivot.top.value, "West");
  const summary = byId(
    buildPreviewKpis({
      actions: actionsFor(["summary"], {
        summary: { group: 0, values: [{ column: 2, aggregation: "sum" }] },
      }),
      headers,
      rows,
    }),
  );
  assert.equal(summary.total.title, "1,419,600");
  assert.equal(summary.top.sub, "50.8% of total");
  const dashboard = byId(
    buildPreviewKpis({
      actions: actionsFor(["dashboard"], {
        dashboard: { category: 0, values: [2] },
      }),
      headers,
      rows,
    }),
  );
  assert.equal(dashboard.total.title, "1,419,600");
  assert.equal(dashboard.top.value, "West");
});

test("a count summary counts filled cells and shares them", () => {
  const withBlank = rows.map((row) => [...row]);
  withBlank[0][2] = "";
  const kpi = byId(
    buildPreviewKpis({
      actions: actionsFor(["pivot-table"], {
        pivot: { rows: 0, values: 2, aggregation: "count" },
      }),
      headers,
      rows: withBlank,
    }),
  );
  assert.equal(kpi.total.label, "Count");
  assert.equal(kpi.total.value, "11");
  assert.equal(kpi.top.value, "West");
  assert.equal(kpi.top.sub, "27.3% of total");
});

test("a histogram has no groups: total and rows only", () => {
  const tiles = buildPreviewKpis({
    actions: actionsFor(["chart"], {
      chart: { category: 2, value: 2, chartType: "histogram" },
    }),
    headers,
    rows,
  });
  assert.deepEqual(
    tiles.map((tile) => tile.id),
    ["total", "rows"],
  );
});

test("a single group has no top-group tile", () => {
  const tiles = buildPreviewKpis({
    actions: actionsFor(["chart"], chartSpecs()),
    headers,
    rows: rows.map((row) => ["West", ...row.slice(1)]),
  });
  assert.deepEqual(
    tiles.map((tile) => tile.id),
    ["total", "rows"],
  );
});

test("a share is not claimed when negative amounts make it meaningless", () => {
  const negative = rows.map((row) => [...row]);
  negative[1][2] = -500000;
  const kpi = byId(
    buildPreviewKpis({
      actions: actionsFor(["chart"], chartSpecs()),
      headers,
      rows: negative,
    }),
  );
  assert.equal(kpi.top.value, "West");
  assert.equal(kpi.top.sub, "721K");
});

test("a measure with no numbers shows only the row count", () => {
  const tiles = buildPreviewKpis({
    actions: [
      {
        kind: "chart",
        spec: { categoryIndex: 0, valueIndex: 1, chartType: "column" },
      },
    ],
    headers,
    rows,
  });
  assert.deepEqual(
    tiles.map((tile) => tile.id),
    ["rows"],
  );
  assert.equal(tiles[0].value, "12");
});

test("a sampled very large range never shows a total over the sample", () => {
  const tiles = buildPreviewKpis({
    actions: actionsFor(["chart"], chartSpecs()),
    headers,
    rows,
    sample: { totalRows: 1_250_000, sampledRows: 4000 },
  });
  assert.deepEqual(tiles, [{ id: "rows", label: "Rows", value: "1,250,000" }]);
});

test("a blank group name is shown as (blank)", () => {
  const blank = rows.map((row) =>
    row[0] === "West" ? ["", ...row.slice(1)] : row,
  );
  const kpi = byId(
    buildPreviewKpis({
      actions: actionsFor(["chart"], chartSpecs()),
      headers,
      rows: blank,
    }),
  );
  assert.equal(kpi.top.value, "(blank)");
});

test("labels go through the pane language", () => {
  const si = (text: string) => localizeMessageSi(text);
  const tiles = buildPreviewKpis({
    actions: actionsFor(["chart"], chartSpecs()),
    headers,
    rows,
    tr: si,
  });
  const kpi = byId(tiles);
  assert.equal(kpi.total.label, "එකතුව");
  assert.equal(kpi.top.label, "ඉහළම කාණ්ඩය");
  assert.equal(kpi.top.sub, "50.8% මුළුවෙන්");
  assert.equal(kpi.rows.label, "පේළි");
  assert.equal(kpi.rows.sub, "4 කාණ්ඩ");
  // The data itself is never translated.
  assert.equal(kpi.top.value, "West");
  assert.equal(kpi.total.sub, "Net Amount");
  const ta = buildPreviewKpis({
    actions: actionsFor(["chart"], chartSpecs()),
    headers,
    rows,
    tr: localizeMessageTa,
  });
  assert.match(byId(ta).total.label, /[஀-௿]/);
  assert.match(byId(ta).top.sub ?? "", /[஀-௿]/);
});

test("a plan that summarizes nothing has no tiles", () => {
  assert.deepEqual(
    buildPreviewKpis({
      actions: [{ kind: "table", spec: {} }],
      headers,
      rows,
    }),
    [],
  );
});

test("compact numbers keep the first digits and the unit", () => {
  assert.equal(compactNumber(0), "0");
  assert.equal(compactNumber(96400), "96,400");
  assert.equal(compactNumber(12.345), "12.35");
  assert.equal(compactNumber(123456), "123.5K");
  assert.equal(compactNumber(1419600), "1.42M");
  assert.equal(compactNumber(-2500000), "-2.5M");
  assert.equal(compactNumber(7_300_000_000), "7.3B");
});

const qualityHeaders = ["Region", "Net Amount"];

test("a quality report counts columns checked, columns clean and findings, from the real report", () => {
  // Row 1 and 2 are the same row, and one Region is blank.
  const dirty: unknown[][] = [
    ["West", 10],
    ["West", 10],
    ["", 5],
  ];
  const tiles = buildPreviewKpis({
    actions: [{ kind: "quality", spec: { qualityMode: "data" } }],
    headers: qualityHeaders,
    rows: dirty,
  });
  assert.deepEqual(
    tiles.map((tile) => [tile.id, tile.value]),
    [
      ["checked", "2"],
      ["clean", "1"],
      ["review", "2"],
    ],
  );
  assert.equal(tiles[2].warn, true);
  assert.equal(tiles[2].sub, "findings");
  assert.equal(tiles[0].sub, "columns");
});

test("a clean selection reports nothing to review and no warning colour", () => {
  const tiles = buildPreviewKpis({
    actions: [{ kind: "quality", spec: {} }],
    headers: qualityHeaders,
    rows: [
      ["West", 10],
      ["East", 20],
      ["South", 30],
    ],
  });
  assert.deepEqual(
    tiles.map((tile) => tile.value),
    ["2", "2", "0"],
  );
  assert.equal(tiles[2].warn, undefined);
});

test("quality tiles are left out when the report reads formulas, a sample or a reshaped copy", () => {
  const base = {
    headers: qualityHeaders,
    rows: [["West", 10]] as unknown[][],
  };
  assert.deepEqual(
    buildPreviewKpis({
      ...base,
      actions: [{ kind: "quality", spec: { qualityMode: "formula" } }],
    }),
    [],
  );
  assert.deepEqual(
    buildPreviewKpis({
      ...base,
      actions: [{ kind: "quality", spec: { qualityMode: "repair" } }],
    }),
    [],
  );
  assert.deepEqual(
    buildPreviewKpis({
      ...base,
      actions: [{ kind: "quality", spec: {} }],
      sample: { totalRows: 9000, sampledRows: 4000 },
    }),
    [],
  );
  assert.deepEqual(
    buildPreviewKpis({
      ...base,
      actions: [{ kind: "quality", spec: {} }],
      normalized: true,
    }),
    [],
  );
});
