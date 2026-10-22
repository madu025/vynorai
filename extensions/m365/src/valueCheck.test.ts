import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeNearDuplicates,
  findNearDuplicates,
  groupingColumns,
} from "./valueCheck.js";

const ROWS = [
  [" Central  ", 1],
  ["Central", 2],
  ["central", 3],
  ["Eastern", 4],
  ["Eastern", 5],
  [null, 6],
];

test("spellings that differ only by spaces or capitals are one group", () => {
  const found = findNearDuplicates(ROWS, 0);
  assert.equal(found?.groups.length, 1);
  assert.deepEqual(
    found?.groups[0].sort(),
    [" Central  ", "Central", "central"].sort(),
  );
});

test("clean columns, numbers and blanks report nothing", () => {
  assert.equal(findNearDuplicates([["A"], ["B"], ["A"], [null]], 0), undefined);
  assert.equal(findNearDuplicates(ROWS, 1), undefined);
});

test("the grouping columns come from the pivot, summary and dashboard specs", () => {
  assert.deepEqual(
    groupingColumns({
      pivot: { rows: 3, subRows: 4 },
      summary: { group: 3 },
      dashboard: { category: 7 },
    }),
    [3, 4, 7],
  );
  assert.deepEqual(groupingColumns({}), []);
});

test("the notice names the column and says how to fix it", () => {
  const text = describeNearDuplicates(["Region", "Qty"], ROWS, {
    pivot: { rows: 0 },
  });
  assert.match(text ?? "", /"Region" has 1 value written in more than one way/);
  assert.match(text ?? "", /trim extra spaces/);
  assert.equal(
    describeNearDuplicates(["Region", "Qty"], ROWS, { pivot: { rows: 1 } }),
    undefined,
  );
});

test("cleanFirstInstruction puts a clean step in front and the reader plans clean then pivot", async () => {
  const { cleanFirstInstruction } = await import("./valueCheck.js");
  const { interpretInstruction } = await import("./intent.js");
  const text = cleanFirstInstruction("Pivot total Net Amount by Region.");
  assert.equal(text, "clean the data, then pivot total Net Amount by Region");
  const result: any = interpretInstruction(
    text,
    ["Order No", "Region", "Net Amount"],
    [["001", "North", 5]] as any,
  );
  assert.ok(result.actions.includes("clean"));
  assert.ok(result.actions.includes("pivot-table"));
  assert.equal(cleanFirstInstruction("clean the data"), "clean the data");
  assert.equal(cleanFirstInstruction("  "), "");
});
