import assert from "node:assert/strict";
import test from "node:test";
import { findSheetBlocks, MAX_SHEET_BLOCKS } from "./sheetBlocks.js";

/** A grid of `rows` x `cols` empty strings (Excel reads empty cells as ""). */
function grid(rows: number, cols: number): unknown[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(""));
}
function put(
  values: unknown[][],
  row: number,
  col: number,
  block: unknown[][],
) {
  block.forEach((line, r) =>
    line.forEach((value, c) => {
      values[row + r][col + c] = value;
    }),
  );
}
const table = (headers: string[], rows: number) => [
  headers,
  ...Array.from({ length: rows }, (_, r) =>
    headers.map((_, c) => (c === 0 ? `Item ${r + 1}` : (r + 1) * (c + 1))),
  ),
];

test("a single table is one block with its headers", () => {
  const values = table(["Region", "Sales", "Cost"], 5);
  const blocks = findSheetBlocks({ values, usedAddress: "Sheet1!A1:C6" });
  assert.deepEqual(blocks, [
    {
      address: "A1:C6",
      headerRow: 1,
      headers: ["Region", "Sales", "Cost"],
      rows: 6,
      columns: 3,
    },
  ]);
});

test("two tables stacked with a blank row are two blocks", () => {
  const values = grid(10, 3);
  put(values, 0, 0, table(["Month", "Sales"], 3));
  put(values, 5, 0, table(["Product", "Qty", "Price"], 4));
  const blocks = findSheetBlocks({ values, usedAddress: "A1:C10" });
  assert.deepEqual(
    blocks.map((b) => [b.address, b.headerRow, b.headers]),
    [
      ["A1:B4", 1, ["Month", "Sales"]],
      ["A6:C10", 6, ["Product", "Qty", "Price"]],
    ],
  );
});

test("two tables side by side with a blank column are two blocks", () => {
  const values = grid(6, 7);
  put(values, 0, 0, table(["Name", "Dept", "Pay"], 5));
  put(values, 0, 4, table(["Dept", "Budget", "Head"], 3));
  const blocks = findSheetBlocks({ values, usedAddress: "A1:G6" });
  assert.deepEqual(
    blocks.map((b) => [b.address, b.rows, b.columns]),
    [
      ["A1:C6", 6, 3],
      ["E1:G4", 4, 3],
    ],
  );
});

test("a summary on top, a table at A20 and a side table at H1", () => {
  const values = grid(30, 10);
  put(values, 0, 0, table(["KPI", "Value"], 3));
  put(
    values,
    19,
    0,
    table(["Date", "Customer", "Amount", "Status", "Rep"], 10),
  );
  put(values, 0, 7, table(["Rep", "Target", "Area"], 25));
  const blocks = findSheetBlocks({ values, usedAddress: "A1:J30" });
  assert.deepEqual(
    blocks.map((b) => b.address),
    ["A1:B4", "H1:J26", "A20:E30"],
  );
});

test("a table that starts at A20 keeps its real address", () => {
  const values = table(["Code", "Name", "Stock"], 8);
  const blocks = findSheetBlocks({ values, usedAddress: "Stock!A20:C28" });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].address, "A20:C28");
  assert.equal(blocks[0].headerRow, 20);
});

test("a used range that starts off A1 shifts every block", () => {
  const values = grid(8, 6);
  put(values, 0, 0, table(["A", "B"], 2));
  put(values, 4, 3, table(["C", "D", "E"], 3));
  const blocks = findSheetBlocks({ values, usedAddress: "C5:H12" });
  assert.deepEqual(
    blocks.map((b) => b.address),
    ["C5:D7", "F9:H12"],
  );
});

test("a stray note cell is not a block", () => {
  const values = grid(12, 5);
  put(values, 0, 0, table(["Item", "Qty", "Price"], 6));
  values[10][4] = "checked by Nimal";
  const blocks = findSheetBlocks({ values, usedAddress: "A1:E11" });
  assert.deepEqual(
    blocks.map((b) => b.address),
    ["A1:C7"],
  );
});

test("a one-cell title above the headers becomes the block title", () => {
  const values = grid(7, 4);
  values[0][0] = "Sales Report 2025";
  put(values, 1, 0, table(["Region", "Q1", "Q2", "Q3"], 5));
  const [block, ...rest] = findSheetBlocks({ values, usedAddress: "A1:D7" });
  assert.equal(rest.length, 0);
  assert.equal(block.address, "A2:D7");
  assert.equal(block.title, "Sales Report 2025");
  assert.equal(block.headerRow, 2);
  assert.deepEqual(block.headers, ["Region", "Q1", "Q2", "Q3"]);
});

test("a title on its own row, then a blank row, is dropped as a note", () => {
  const values = grid(8, 3);
  values[0][1] = "Stock list";
  put(values, 2, 0, table(["SKU", "Name", "Qty"], 5));
  const blocks = findSheetBlocks({ values, usedAddress: "A1:C8" });
  assert.deepEqual(
    blocks.map((b) => [b.address, b.title]),
    [["A3:C8", undefined]],
  );
});

test("a block of numbers has no headers", () => {
  const values = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const [block] = findSheetBlocks({ values, usedAddress: "A1:C2" });
  assert.equal(block.headers, undefined);
  assert.equal(block.headerRow, 1);
});

test("a block cut by the scan edge reaches to the end of the used range", () => {
  const values = table(["Date", "Amount"], 199);
  const blocks = findSheetBlocks({
    values,
    usedAddress: "A1:B5000",
    usedRows: 5000,
    usedColumns: 2,
  });
  assert.deepEqual(blocks, [
    {
      address: "A1:B5000",
      headerRow: 1,
      headers: ["Date", "Amount"],
      rows: 5000,
      columns: 2,
      clipped: true,
    },
  ]);
});

test("the number of blocks is capped", () => {
  const values = grid(40, 3);
  for (let i = 0; i < 13; i += 1) put(values, i * 3, 0, table(["K", "V"], 1));
  const blocks = findSheetBlocks({ values, usedAddress: "A1:C40" });
  assert.equal(blocks.length, MAX_SHEET_BLOCKS);
  assert.equal(blocks[0].address, "A1:B2");
});

test("an empty grid has no blocks", () => {
  assert.deepEqual(
    findSheetBlocks({ values: grid(5, 5), usedAddress: "A1" }),
    [],
  );
  assert.deepEqual(findSheetBlocks({ values: [], usedAddress: "A1" }), []);
});

async function workbookOf(rows: unknown[][]) {
  const { gridWorkbook } = await import("../test/batch/gridWorkbook.js");
  const { createOfficeAgentHost } = await import("./officeAgentHost.js");
  const book = gridWorkbook("Sales", rows);
  await book.runtime.run(async (context: any) => {
    // The fake sheet has no table collection to load; the real one does.
    const sheet = context.workbook.worksheets.getItem("Sales");
    sheet.tables.load = () => undefined;
    sheet.tables.items = [];
  });
  const host = createOfficeAgentHost(
    book.runtime as any,
    async () => ({}) as any,
  );
  return (await host.getWorkbook()) as any;
}

test("get_workbook lists the blocks of a sheet with several", async () => {
  const workbook = await workbookOf([
    ["KPI", "Value"],
    ["Sales", 10],
    ["Cost", 4],
    ["", ""],
    ["Date", "Customer", "Amount"],
    ["d1", "c1", 5],
    ["d2", "c2", 6],
  ]);
  assert.deepEqual(
    workbook.sheets[0].blocks.map((b: any) => [b.address, b.headers]),
    [
      ["A1:B3", ["KPI", "Value"]],
      ["A5:C7", ["Date", "Customer", "Amount"]],
    ],
  );
  assert.match(workbook.data.note, /2 separate blocks/);
});

test("get_workbook leaves a one-block sheet as it was", async () => {
  const workbook = await workbookOf([
    ["Region", "Sales"],
    ["North", 10],
    ["South", 4],
  ]);
  assert.equal("blocks" in workbook.sheets[0], false);
  assert.equal("note" in workbook.data, false);
});
