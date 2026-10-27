import assert from "node:assert/strict";
import { test } from "node:test";
import { inferCurrency, parseBusinessTarget } from "./businessContext.js";
import {
  buildDashboardLayout,
  dashboardTopN,
  rankCategories,
  type DashboardLayoutInput,
} from "./dashboardLayout.js";

const base = (
  over: Partial<DashboardLayoutInput> = {},
): DashboardLayoutInput => ({
  categoryName: "Region",
  categoryRef: "'Data'!$A$2:$A$7",
  values: [
    { name: "Sales", ref: "'Data'!$B$2:$B$7" },
    { name: "Qty", ref: "'Data'!$C$2:$C$7" },
  ],
  aggregation: "sum",
  categories: ["North", "South", "East"],
  totalCategories: 3,
  sampled: false,
  money: [true, false],
  audience: "general",
  sourceLabel: "'Data'!A1:C7",
  ...over,
});

const cellAt = (
  layout: ReturnType<typeof buildDashboardLayout>,
  row: number,
  col: number,
) => layout.blocks.find((block) => block.row === row && block.col === col);
const text = (cell: unknown) =>
  typeof cell === "object" && cell ? (cell as { f: string }).f : String(cell);

test("categories are ranked by their aggregate, largest first", () => {
  const rows = [
    ["North", 10],
    ["South", 50],
    ["North", 45],
    ["East", 5],
    ["", 99],
  ];
  assert.deepEqual(rankCategories(rows, 0, 1, "sum"), [
    "North",
    "South",
    "East",
  ]);
  assert.deepEqual(rankCategories(rows, 0, 1, "max"), [
    "South",
    "North",
    "East",
  ]);
  assert.deepEqual(rankCategories(rows, 0, 1, "count"), [
    "North",
    "East",
    "South",
  ]);
  assert.equal(dashboardTopN("management"), 10);
  assert.equal(dashboardTopN("operational"), 50);
});

test("the layout has a title bar, KPI cards in one row and a breakdown under them", () => {
  const layout = buildDashboardLayout(base());
  assert.equal(text(cellAt(layout, 0, 0)!.cells[0][0]), "SALES, QTY BY REGION");
  const labels = layout.blocks
    .filter((block) => block.style === "kpi-label")
    .map((block) => [block.row, block.col, block.cells[0][0]]);
  assert.deepEqual(labels, [
    [3, 0, "RECORDS"],
    [3, 1, "TOTAL SALES"],
    [3, 2, "TOTAL QTY"],
    [3, 3, "TOP REGION"],
  ]);
  assert.equal(
    text(cellAt(layout, 4, 1)!.cells[0][0]),
    "=SUM('Data'!$B$2:$B$7)",
  );
  assert.equal(cellAt(layout, 5, 0)!.cells[0][0], "3 Region values");
  // The top card reads the first chart's data.
  assert.equal(
    text(cellAt(layout, 4, 3)!.cells[0][0]),
    '=IFERROR(INDEX($Q$3:$Q$5,MATCH(MAX($R$3:$R$5),$R$3:$R$5,0)),"")',
  );
  assert.equal(layout.pivotAnchor, "A10");
  assert.equal(layout.slicerAnchor, "E10");
  assert.equal(layout.charts.length, 2);
  assert.deepEqual(
    layout.charts.map((chart) => [chart.from, chart.to]),
    [
      ["H4", "N19"],
      ["H21", "N36"],
    ],
  );
});

test("money columns take the currency format and other columns do not", () => {
  const currency = inferCurrency({
    headers: ["Region", "Sales", "Qty"],
    columns: [1, 2],
    numberFormats: ["General", '"Rs "#,##0.00', "0"],
  });
  const layout = buildDashboardLayout(base({ currency }));
  assert.deepEqual(layout.valueFormats, ['"Rs "#,##0.00', "#,##0.00"]);
  assert.equal(cellAt(layout, 4, 1)!.numberFormat, '"Rs "#,##0.00');
  assert.match(String(cellAt(layout, 1, 0)!.cells[0][0]), /Amounts in LKR\./);
});

test("mixed currencies are never formatted as one and are named in a note", () => {
  const currency = inferCurrency({
    headers: ["Region", "Sales (LKR)", "Sales (USD)"],
    columns: [1, 2],
  });
  const layout = buildDashboardLayout(
    base({
      currency,
      money: [true, true],
      values: [
        { name: "Sales (LKR)", ref: "'Data'!$B$2:$B$7" },
        { name: "Sales (USD)", ref: "'Data'!$C$2:$C$7" },
      ],
    }),
  );
  assert.deepEqual(layout.valueFormats, ["#,##0.00", "#,##0.00"]);
  assert.match(layout.notes.join(" "), /different currencies \(LKR, USD\)/);
});

test("a target from the request becomes % of target and gap cards", () => {
  const target = parseBusinessTarget(
    "sales target 5M",
    ["Sales", "Qty"],
    [0, 1],
  );
  const layout = buildDashboardLayout(base({ target, audience: "management" }));
  const labels = layout.blocks
    .filter((block) => block.style === "kpi-label")
    .map((block) => block.cells[0][0]);
  // Six cards fit, so nothing gives way.
  assert.deepEqual(labels, [
    "RECORDS",
    "TOTAL SALES",
    "TOTAL QTY",
    "% OF TARGET",
    "GAP TO TARGET",
    "TOP REGION",
  ]);
  const percent = layout.blocks.find(
    (block) => block.style === "kpi-value" && block.numberFormat === "0.0%",
  );
  assert.equal(
    text(percent!.cells[0][0]),
    "=IFERROR(SUM('Data'!$B$2:$B$7)/5000000,0)",
  );
  assert.match(
    String(cellAt(layout, 1, 0)!.cells[0][0]),
    /^Management summary/,
  );
});

test("with three values and a target the record count gives way so six cards fit", () => {
  const layout = buildDashboardLayout(
    base({
      values: [
        { name: "Sales", ref: "'Data'!$B$2:$B$7" },
        { name: "Cost", ref: "'Data'!$C$2:$C$7" },
        { name: "Profit", ref: "'Data'!$D$2:$D$7" },
      ],
      money: [true, true, true],
      target: { value: 100, label: "target" },
    }),
  );
  const labels = layout.blocks
    .filter((block) => block.style === "kpi-label")
    .map((block) => block.cells[0][0]);
  assert.equal(labels.length, 6);
  assert.ok(!labels.includes("RECORDS"));
  assert.ok(labels.includes("GAP TO TARGET"));
  assert.ok(labels.includes("% OF TARGET"));
});

test("the fallback breakdown is a live formula table in the PivotTable's place", () => {
  const layout = buildDashboardLayout(base());
  const [header, body] = layout.fallbackBreakdown;
  assert.deepEqual([header.row, header.col], [9, 0]);
  assert.deepEqual(header.cells[0], [
    "Region",
    "Total of Sales",
    "Total of Qty",
  ]);
  assert.equal(body.cells[0][0], "North");
  assert.equal(
    text(body.cells[0][1]),
    "=SUMIFS('Data'!$B$2:$B$7,'Data'!$A$2:$A$7,$A11)",
  );
  assert.equal(
    text(body.cells[2][2]),
    "=SUMIFS('Data'!$C$2:$C$7,'Data'!$A$2:$A$7,$A13)",
  );
});

test("very large data uses spilled formulas for chart data and the fallback", () => {
  const layout = buildDashboardLayout(
    base({
      sampled: true,
      categories: [],
      totalCategories: 0,
      audience: "management",
    }),
  );
  const helper = layout.blocks.find(
    (block) => block.row === 2 && block.col === 16,
  )!;
  assert.match(
    text(helper.cells[0][0]),
    /^=TAKE\(SORTBY\(UNIQUE\(FILTER\(.+\)\),BYROW\(UNIQUE\(FILTER\(.+\)\),LAMBDA\(c,SUMIFS\(.+\)\),-1\),10\)$/,
  );
  assert.match(text(helper.cells[0][1]), /^=BYROW\(Q3#,LAMBDA\(c,SUMIFS\(/);
  assert.match(text(layout.fallbackBreakdown[1].cells[0][1]), /^=BYROW\(A11#,/);
  assert.match(
    text(layout.fallbackBreakdown[1].cells[0][0]),
    /SORTBY\(c,a,-1\)/,
  );
  assert.match(text(layout.fallbackBreakdown[1].cells[0][0]), /SUMIFS\(/);
  assert.match(layout.notes.join(" "), /up to 10 Region values/);
  assert.equal(layout.charts[0].dataRows, 10);
});

test("only the largest categories are charted in a management view, with a note", () => {
  const layout = buildDashboardLayout(
    base({
      categories: ["A", "B"],
      totalCategories: 30,
      audience: "management",
    }),
  );
  assert.match(layout.notes.join(" "), /the 2 largest of 30 Region values/);
});
