import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxAddress,
  clearPosition,
  parseBox,
  placeChart,
  resolveChartPosition,
} from "./chartPlacement.js";

test("a position round-trips as A1 text", () => {
  assert.deepEqual(parseBox("A9:G24"), {
    row: 8,
    column: 0,
    rows: 16,
    columns: 7,
  });
  assert.equal(boxAddress(parseBox("A9:G24")!), "A9:G24");
  assert.equal(boxAddress(parseBox("AB3")!), "AB3");
  assert.equal(parseBox("Sheet1!A1"), undefined);
});

test("an empty position is kept", () => {
  const box = parseBox("H2:M16")!;
  assert.deepEqual(
    clearPosition(box, [
      ["", ""],
      [null, ""],
    ]),
    box,
  );
});

test("a position over data moves under the last filled cell of its columns", () => {
  const box = parseBox("A9:G24")!;
  // data in rows 9..30 (indexes 0..21 from row 9): the chart goes to row 32
  const values = Array.from({ length: 30 }, (_, i) =>
    i < 22 ? ["", "", "", "", "x"] : ["", ""],
  );
  const moved = clearPosition(box, values);
  assert.equal(boxAddress(moved), "A32:G47");
});

test("placeChart keeps a free box, goes under short data and beside long data", () => {
  const box = parseBox("A9:G24")!;
  const free = { blocked: false, lastFilledRow: -1, usedEndColumn: 7 };
  assert.deepEqual(placeChart(box, free), box);
  const short = { blocked: true, lastFilledRow: 29, usedEndColumn: 8 };
  assert.equal(boxAddress(placeChart(box, short)), "A32:G47");
  // 20,000 rows of data: not 20,000 rows down, but one blank column right of everything (I)
  const long = { blocked: true, lastFilledRow: 19_999, usedEndColumn: 8 };
  assert.equal(boxAddress(placeChart(box, long)), "J9:P24");
});

/** A sheet with `rows` filled rows in columns A..C, answering only the reads resolveChartPosition makes. */
function fakeSheet(rows: number, fillCol = 3) {
  const reads: string[] = [];
  const filled = (r: number, c: number) => r < rows && c < fillCol;
  const range = (r: number, c: number, nr: number, nc: number) => ({
    load(what: unknown) {
      reads.push(`load ${nr}x${nc}@${r},${c} ${JSON.stringify(what)}`);
    },
    get values() {
      reads.push(`values ${nr}x${nc}`);
      return Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => (filled(r + i, c + j) ? "x" : "")),
      );
    },
    getUsedRangeOrNullObject() {
      let last = -1;
      for (let i = 0; i < nr; i++)
        for (let j = 0; j < nc; j++) if (filled(r + i, c + j)) last = r + i;
      return last < 0
        ? { isNullObject: true, load() {} }
        : {
            isNullObject: false,
            rowIndex: r,
            rowCount: last - r + 1,
            load() {},
          };
    },
  });
  return {
    reads,
    getUsedRangeOrNullObject: () => ({
      isNullObject: rows === 0,
      rowIndex: 0,
      rowCount: rows,
      columnIndex: 0,
      columnCount: fillCol,
      load() {},
    }),
    getRangeByIndexes: range,
  };
}
const sync = async () => {};

test("a chart over 20,000 rows of data goes beside it, reading no cell values of the data", async () => {
  const sheet = fakeSheet(20_000);
  const place = await resolveChartPosition(sheet, sync, "A9:G24");
  assert.equal(place, "E9:K24");
  // only the 16 x 7 box was read as values, never the 20,000 rows
  assert.ok(
    sheet.reads
      .filter((x) => x.startsWith("values"))
      .every((x) => x === "values 16x7"),
  );
});

test("a chart over short data goes under it; a free or off-data position is kept", async () => {
  assert.equal(
    await resolveChartPosition(fakeSheet(30), sync, "A9:G24"),
    "A32:G47",
  );
  assert.equal(
    await resolveChartPosition(fakeSheet(30), sync, "H2:M16"),
    "H2:M16",
  );
  assert.equal(
    await resolveChartPosition(fakeSheet(0), sync, "A9:G24"),
    "A9:G24",
  );
  assert.equal(
    await resolveChartPosition(fakeSheet(5), sync, "A9:G24"),
    "A9:G24",
  );
  assert.equal(
    await resolveChartPosition(fakeSheet(30), sync, "Sheet1!A1"),
    "Sheet1!A1",
  );
});
