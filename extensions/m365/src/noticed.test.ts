import assert from "node:assert/strict";
import { test } from "node:test";
import { noticeInData } from "./noticed.js";

const headers = ["Order Date", "Region", "Net Amount"];
const base = (n: number) =>
  Array.from({ length: n }, (_, i) => [`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, i % 2 ? "Western" : "Central", 100 + i]);

test("dates stored as text are found and offered as a fix", () => {
  const tiles = noticeInData(headers, base(12));
  const dates = tiles.find((t) => t.key === "dates");
  assert.ok(dates);
  assert.equal(dates.figure, "12");
  assert.match(dates.request, /fix the dates in Order Date/);
  assert.equal(tiles[0].key, "dates");
});

test("real dates are not flagged", () => {
  const rows = base(12).map((r) => [46000 + Number(r[2]), r[1], r[2]]);
  assert.equal(noticeInData(headers, rows).some((t) => t.key === "dates"), false);
});

test("an unusual value and a dominant group are noticed, with questions as requests", () => {
  const rows = Array.from({ length: 20 }, (_, i) => [46000 + i, i < 17 ? "Western" : "Central", i === 5 ? 9000 : 100 + i]);
  const tiles = noticeInData(headers, rows);
  const outlier = tiles.find((t) => t.key === "outliers");
  assert.equal(outlier?.figure, "1");
  assert.match(outlier!.request, /which Net Amount values are unusual/);
  const share = tiles.find((t) => t.key === "concentration");
  assert.match(share?.label ?? "", /Western/);
});

test("duplicate rows and blank cells are counted", () => {
  const rows: (string | number | null)[][] = [
    [46001, "A", 10], [46001, "A", 10], [46002, "B", 20], [46003, "B", null], [46004, "A", 30], [46005, "C", 40],
  ];
  const tiles = noticeInData(headers, rows);
  assert.equal(tiles.find((t) => t.key === "duplicates")?.figure, "1");
  assert.equal(tiles.find((t) => t.key === "blanks")?.figure, "1");
});

test("a clean small table gives no tiles, and at most three are returned", () => {
  assert.deepEqual(noticeInData(headers, [[46001, "A", 1]]), []);
  assert.ok(noticeInData(headers, base(40)).length <= 3);
});
