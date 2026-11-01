import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEALTH_MAX_CELLS,
  HEALTH_SCAN_MAX_CELLS,
  HEALTH_SCAN_MAX_COLUMNS,
  HEALTH_SCAN_MAX_ROWS,
  healthReadPlan,
  scanDataHealth,
  type HealthCell,
  type HealthKind,
} from "./dataHealth.js";
import { readDataHealthValues } from "./taskpaneWorkspaceContext.js";

const HEAD = ["Order No", "Region", "Amount", "Order Date"];
const clean = (n = 20): HealthCell[][] => [
  HEAD,
  ...Array.from({ length: n }, (_, i): HealthCell[] => [
    `INV-${1000 + i}`,
    i % 2 ? "Western" : "Central",
    100 + (i % 7) * 3,
    `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
  ]),
];
const find = (values: HealthCell[][], kind: HealthKind, column?: string) =>
  scanDataHealth({ values }).findings.find(
    (f) => f.kind === kind && (column === undefined || f.column === column),
  );

test("clean data gives no findings", () => {
  const report = scanDataHealth({ values: clean() });
  assert.deepEqual(report.findings, []);
  assert.equal(report.rowsChecked, 20);
  assert.equal(report.partialRows, false);
  assert.equal(report.address, "A1:D21");
});

test("empty range and a single row give no findings and do not throw", () => {
  assert.deepEqual(scanDataHealth({ values: [] }).findings, []);
  assert.deepEqual(scanDataHealth({ values: [[]] }).findings, []);
  assert.deepEqual(scanDataHealth({ values: [[null, "", "  "]] }).findings, []);
  assert.deepEqual(scanDataHealth({ values: [HEAD] }).findings, []);
  assert.deepEqual(scanDataHealth({ values: [[1, 2, 3, 4]] }).findings, []);
  assert.equal(scanDataHealth({ values: [HEAD] }).rowsChecked, 0);
});

test("duplicate rows over all columns, with addresses and a ready request", () => {
  const values = clean();
  values[5] = [...values[2]]; // row 6 repeats row 3
  values[9] = values[2].map((v) =>
    typeof v === "string" ? v.toUpperCase() : v,
  ); // case only
  const f = find(values, "duplicate_rows");
  assert.ok(f);
  assert.equal(f.count, 2);
  assert.deepEqual(f.cells, ["A6", "A10"]);
  assert.equal(f.severity, "high");
  assert.equal(f.request, "Remove duplicate rows from A1:D21");
});

test("a repeated key with different other values is its own finding, not a duplicate row", () => {
  const values = clean();
  values[7][0] = values[3][0]; // same Order No, other columns differ
  assert.equal(find(values, "duplicate_rows"), undefined);
  const f = find(values, "duplicate_key");
  assert.ok(f);
  assert.equal(f.count, 1);
  assert.equal(f.column, "Order No");
  assert.deepEqual(f.cells, ["A8"]);
  assert.match(f.request, /where Order No appears more than once/);
});

test("a first column that is a category (few distinct values) is not treated as a key", () => {
  const values: HealthCell[][] = [
    ["Region", "Amount"],
    ...Array.from({ length: 12 }, (_, i): HealthCell[] => [
      i % 2 ? "East" : "West",
      i,
    ]),
  ];
  assert.equal(find(values, "duplicate_key"), undefined);
});

test("blank cells in an otherwise full column; a mostly empty column is left alone", () => {
  const values = clean();
  values[4][1] = "";
  values[11][1] = null;
  const f = find(values, "blank_cells", "Region");
  assert.ok(f);
  assert.equal(f.count, 2);
  assert.deepEqual(f.cells, ["B5", "B12"]);
  const sparse = clean().map((row, i): HealthCell[] =>
    i % 2 ? [...row.slice(0, 3), ""] : row,
  );
  assert.equal(find(sparse, "blank_cells", "Order Date"), undefined);
});

test("fully blank rows are separators, not blank cells", () => {
  const values = clean();
  values[6] = ["", "", "", ""];
  assert.equal(scanDataHealth({ values }).findings.length, 0);
});

test("numbers stored as text, but not identifiers with leading zeros", () => {
  const values = clean();
  values[2][2] = "250";
  values[3][2] = " 1,200.50 ";
  const f = find(values, "number_text", "Amount");
  assert.ok(f);
  assert.equal(f.count, 2);
  assert.deepEqual(f.cells, ["C3", "C4"]);
  assert.equal(f.severity, "medium");
  const ids = clean().map((row, i): HealthCell[] =>
    i === 0 ? row : [row[0], row[1], `00${i}`, row[3]],
  );
  assert.equal(find(ids, "number_text"), undefined);
  assert.equal(
    find(
      clean().map((r, i) => (i ? [r[0], r[1], "12", r[3]] : r)),
      "number_text",
      "Amount",
    )?.severity,
    "high",
  );
});

test("mixed types: text among numbers and numbers among text", () => {
  const values = clean();
  values[3][2] = "N/A";
  const a = find(values, "mixed_types", "Amount");
  assert.ok(a);
  assert.deepEqual(a.cells, ["C4"]);
  const names = clean();
  names[2][1] = 42;
  const b = find(names, "mixed_types", "Region");
  assert.ok(b);
  assert.deepEqual(b.cells, ["B3"]);
});

test("leading and trailing spaces, including non-breaking and zero-width, one finding with at most 5 cells", () => {
  const values = clean(30);
  for (let r = 1; r <= 8; r += 1)
    values[r][1] = r % 2 ? ` ${values[r][1]}` : `${values[r][1]} `;
  values[9][1] = `x​`;
  const f = find(values, "extra_spaces");
  assert.ok(f);
  assert.equal(f.count, 9);
  assert.equal(f.cells.length, HEALTH_MAX_CELLS);
  assert.deepEqual(f.cells, ["B2", "B3", "B4", "B5", "B6"]);
  assert.equal(f.severity, "low");
  assert.equal(find(clean(), "extra_spaces"), undefined);
});

test("inconsistent date formats; one consistent format is fine", () => {
  const values = clean();
  values[4][3] = "15/01/2026";
  values[6][3] = "3 Feb 2026";
  const f = find(values, "date_formats", "Order Date");
  assert.ok(f);
  assert.equal(f.count, 2);
  assert.deepEqual(f.cells, ["D5", "D7"]);
  const slash = clean().map((r, i) =>
    i ? [r[0], r[1], r[2], `${(i % 28) + 1}/01/2026`] : r,
  );
  assert.equal(find(slash, "date_formats"), undefined);
});

test("real dates mixed with a date typed as text", () => {
  const values = clean().map((r, i) => (i ? [r[0], r[1], r[2], 46000 + i] : r));
  values[3][3] = "12/03/2026";
  const f = find(values, "date_formats", "Order Date");
  assert.ok(f);
  assert.deepEqual(f.cells, ["D4"]);
});

test("numeric outliers use median/MAD with a high bar", () => {
  const values = clean(30);
  values[10][2] = 99999;
  const f = find(values, "outliers", "Amount");
  assert.ok(f);
  assert.equal(f.count, 1);
  assert.deepEqual(f.cells, ["C11"]);
  // A value that is only somewhat high is not flagged.
  const mild = clean(30);
  mild[10][2] = 140;
  assert.equal(find(mild, "outliers"), undefined);
  // Identifier-like columns are not scanned.
  const ids = clean(30).map((r, i) =>
    i
      ? [r[0], r[1], 5000 + i, r[3]]
      : ["Order No", "Region", "Customer ID", "Order Date"],
  );
  ids[10][2] = 99999;
  assert.equal(find(ids, "outliers"), undefined);
  // Fewer than 10 numbers: not enough to judge.
  assert.equal(
    find(
      clean(8).map((r, i) => (i === 3 ? [r[0], r[1], 99999, r[3]] : r)),
      "outliers",
    ),
    undefined,
  );
});

test("Sinhala, Tamil and other Unicode text is read correctly", () => {
  const values: HealthCell[][] = [
    ["නම", "නගරය", "මුදල"],
    ["කමල්", "කොළඹ", 100],
    ["நிமல்", "யாழ்ப்பாணம்", 110],
    ["サクラ", "東京", 120],
    ["කමල්", "කොළඹ", 100],
    [" සුනිල්", "මහනුවර ", 105],
    ["නිමල්", "காலி", 95],
    ["අමල්", "ගම්පහ", 101],
  ];
  const report = scanDataHealth({ values });
  const kinds = report.findings.map((f) => f.kind);
  assert.ok(kinds.includes("duplicate_rows"));
  assert.ok(kinds.includes("extra_spaces"));
  assert.deepEqual(
    report.findings.find((f) => f.kind === "duplicate_rows")?.cells,
    ["A5"],
  );
  assert.equal(
    report.findings.find((f) => f.kind === "extra_spaces")?.count,
    2,
  );
  // A Sinhala header names the column in a request.
  const blank = [
    ...values.map((r) => [...r]),
    ...Array.from({ length: 10 }, (_, i): HealthCell[] => [
      `පුද්ගලයා ${i}`,
      `නගරය ${i}`,
      200 + i,
    ]),
  ];
  blank[2][2] = "";
  const f = scanDataHealth({ values: blank }).findings.find(
    (x) => x.kind === "blank_cells",
  );
  assert.equal(f?.column, "මුදල");
  assert.match(f!.request, /මුදල/);
});

test("canonically equivalent Unicode text counts as a duplicate", () => {
  const values: HealthCell[][] = [
    ["Name", "City"],
    ["Café", "Paris"],
    ["Café", "Paris"],
    ["Other", "Rome"],
  ];
  assert.equal(find(values, "duplicate_rows")?.count, 1);
});

test("origin and sheet position are used for addresses", () => {
  const values = clean();
  values[2][1] = "";
  const report = scanDataHealth({ values, row: 10, column: 2 });
  assert.equal(report.address, "C10:F30");
  assert.deepEqual(
    report.findings.find((f) => f.kind === "blank_cells")?.cells,
    ["D12"],
  );
});

test("a huge column count is capped and reported as partly checked", () => {
  const wide = Array.from({ length: 80 }, (_, i) => `H${i}`);
  const values: HealthCell[][] = [
    wide,
    wide.map((_, i) => i),
    wide.map((_, i) => i),
  ];
  const report = scanDataHealth({ values, totalColumns: 16384 });
  assert.equal(report.columnsChecked, HEALTH_SCAN_MAX_COLUMNS);
  assert.equal(report.columnsTotal, 16384);
  assert.equal(report.partialColumns, true);
  assert.equal(report.address, "A1:AX3");
});

test("only the rows read are checked, and the report says how many exist", () => {
  const report = scanDataHealth({
    values: clean(100),
    totalRows: 90_000,
    totalColumns: 4,
  });
  assert.equal(report.rowsChecked, 100);
  assert.equal(report.rowsTotal, 89_999);
  assert.equal(report.partialRows, true);
});

test("the read plan bounds rows, columns and cells", () => {
  assert.deepEqual(healthReadPlan(0, 5), { rows: 0, columns: 0, chunkRows: 1 });
  const small = healthReadPlan(300, 6);
  assert.equal(small.rows, 300);
  const tall = healthReadPlan(1_000_000, 6);
  assert.equal(tall.rows, HEALTH_SCAN_MAX_ROWS + 1);
  const wide = healthReadPlan(1_000_000, 16384);
  assert.equal(wide.columns, HEALTH_SCAN_MAX_COLUMNS);
  assert.ok(wide.rows * wide.columns <= HEALTH_SCAN_MAX_CELLS);
  assert.ok(wide.chunkRows * wide.columns <= 40_000);
});

test("findings are ordered by severity, bounded, and the scan never changes its input", () => {
  const values = clean(40);
  values[2][1] = " Western";
  values[3][2] = "N/A";
  values[5] = [...values[4]];
  const snapshot = JSON.stringify(values);
  const report = scanDataHealth({ values });
  assert.equal(JSON.stringify(values), snapshot);
  const order = { high: 0, medium: 1, low: 2 };
  const ranks = report.findings.map((f) => order[f.severity]);
  assert.deepEqual(ranks, [...ranks].sort());
  for (const f of report.findings)
    assert.ok(f.cells.length <= HEALTH_MAX_CELLS);
});

test("the host read is bounded, chunked and never writes", async () => {
  const rows = 12_000;
  const cols = 50;
  const reads: string[] = [];
  const grid = (r: number, c: number) => `r${r}c${c}`;
  const make = (rowCount: number, columnCount: number, at = 0) => ({
    rowCount,
    columnCount,
    rowIndex: 4,
    columnIndex: 2,
    isNullObject: false,
    worksheet: { name: "Data", load() {} },
    load() {},
    getCell: (r: number) => ({
      getResizedRange: (dr: number, dc: number) => {
        reads.push(`${r}+${dr + 1}x${dc + 1}`);
        return {
          load() {},
          values: Array.from({ length: dr + 1 }, (_, i) =>
            Array.from({ length: dc + 1 }, (_, c) => grid(r + i + at, c)),
          ),
        };
      },
    }),
  });
  const used = make(rows, cols);
  const selected = {
    ...make(1, 1),
    worksheet: {
      name: "Data",
      load() {},
      getUsedRangeOrNullObject: () => used,
    },
  };
  const excel = {
    run: async (fn: (context: unknown) => Promise<unknown>) =>
      fn({
        workbook: { getSelectedRange: () => selected },
        sync: async () => {},
      }),
  };
  const result = await readDataHealthValues(excel);
  assert.ok(result);
  assert.equal(result.values.length, Math.floor(HEALTH_SCAN_MAX_CELLS / cols));
  assert.equal(result.totalRows, rows);
  assert.equal(result.row, 5);
  assert.equal(result.column, 2);
  assert.equal(result.sheetName, "Data");
  assert.ok(reads.length > 1);
  assert.equal(
    result.values[result.values.length - 1][0],
    `r${result.values.length - 1}c0`,
  );
  const empty = {
    ...make(1, 1),
    worksheet: {
      name: "Data",
      load() {},
      getUsedRangeOrNullObject: () => ({ load() {}, isNullObject: true }),
    },
  };
  assert.equal(
    await readDataHealthValues({
      run: async (fn: (context: unknown) => Promise<unknown>) =>
        fn({
          workbook: { getSelectedRange: () => empty },
          sync: async () => {},
        }),
    }),
    undefined,
  );
});
