import assert from "node:assert/strict";
import { test } from "node:test";
import type { StagedChange } from "./agent.js";
import { previewCells, previewTarget } from "./changePreview.js";

const values = (cell: string, rows: unknown[][]): StagedChange =>
  ({ kind: "write_values", sheet: "Data", cell, values: rows }) as StagedChange;

test("a values write reads just the cells it will overwrite, bounded", () => {
  const big = values(
    "B2",
    Array.from({ length: 20 }, () => Array.from({ length: 9 }, () => 1)),
  );
  assert.deepEqual(previewTarget(big), {
    sheet: "Data",
    address: "B2:G7",
    total: 180,
    newSheet: false,
  });
  assert.equal(previewTarget(values("C3", [["x"]]))?.address, "C3");
});

test("a formula write previews its first cell", () => {
  const change = {
    kind: "write_formula",
    sheet: "Data",
    cell: "K2",
    formula: "=SUM(H:H)",
    fillRange: "K2:K500",
  } as StagedChange;
  assert.equal(previewTarget(change)?.address, "K2");
  assert.deepEqual(previewCells(change, [[7]]), [
    { cell: "K2", before: "7", after: "=SUM(H:H)" },
  ]);
});

test("before and after line up cell by cell, with empties named", () => {
  const change = values("B2", [
    ["Region", "Total"],
    ["West", 100],
  ]);
  assert.deepEqual(
    previewCells(change, [
      ["", "old"],
      [null, 5],
    ]),
    [
      { cell: "B2", before: "(empty)", after: "Region" },
      { cell: "C2", before: "old", after: "Total" },
      { cell: "B3", before: "(empty)", after: "West" },
      { cell: "C3", before: "5", after: "100" },
    ],
  );
});

test("a new sheet has nothing to overwrite and an unread range says so", () => {
  const change = values("A1", [["x"]]);
  assert.equal(previewCells(change, [["old"]], true)[0].before, "(empty)");
  assert.equal(previewCells(change, undefined)[0].before, "(not read)");
  assert.equal(previewTarget(change, new Set(["Data"]))?.newSheet, true);
});

test("the list stops at 12 cells and long text is cut", () => {
  const change = values("A1", [
    Array.from({ length: 6 }, (_, i) => "x".repeat(80) + i),
    Array.from({ length: 6 }, () => 2),
    Array.from({ length: 6 }, () => 3),
  ]);
  const cells = previewCells(change, undefined);
  assert.equal(cells.length, 12);
  assert.ok(cells[0].after.endsWith("...") && cells[0].after.length === 60);
});

test("other kinds of change show no cells", () => {
  const change = { kind: "create_sheet", name: "New" } as StagedChange;
  assert.equal(previewTarget(change), undefined);
  assert.deepEqual(previewCells(change, undefined), []);
});
