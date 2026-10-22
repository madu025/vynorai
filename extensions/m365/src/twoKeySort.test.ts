import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerExcelPreviewPlan } from "../../../backend/src/services/m365ExcelPlan.js";
import { createExcelPreviewPlan, excelPlansMatch } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { viewFormula } from "./largeRange.js";
import { applyView } from "./transform.js";

const HEADERS = ["Order No", "Region", "Qty"];
const ROWS = [
  ["1", "North", 3],
  ["2", "South", 1],
  ["3", "North", 5],
  ["4", "South", 9],
  ["5", "North", null],
];

test("the reader turns 'sorted by A then B' into one view with two keys", () => {
  const result: any = interpretInstruction(
    "show the rows sorted by Region then Qty descending",
    HEADERS,
    ROWS as any,
  );
  assert.deepEqual(result.actions, ["view"]);
  assert.deepEqual(result.specs.view.sort, { column: 1, direction: "asc" });
  assert.deepEqual(result.specs.view.thenSort, {
    column: 2,
    direction: "desc",
  });
});

test("two columns that are the same column are refused", () => {
  const result: any = interpretInstruction(
    "sort by Region then Region",
    HEADERS,
    ROWS as any,
  );
  assert.deepEqual(result.actions, []);
  assert.match(result.problems[0], /two different columns/);
});

test("rows that tie on the first key are ordered by the second, blanks last", () => {
  const view = applyView(ROWS as any, {
    sort: { index: 1, direction: "asc" },
    thenSort: { index: 2, direction: "desc" },
  });
  assert.deepEqual(
    view.rows.map((row) => row[0]),
    ["3", "1", "5", "4", "2"],
  );
});

test("a single key still sorts exactly as before", () => {
  const view = applyView(ROWS as any, {
    sort: { index: 2, direction: "desc" },
  });
  assert.deepEqual(
    view.rows.map((row) => row[0]),
    ["4", "3", "1", "2", "5"],
  );
});

test("the sheet formula sorts by both keys in one SORTBY", () => {
  const formula = viewFormula(
    { sheetName: "S", startColumn: 0, startRow: 0, endRow: 99, columns: 3 },
    {
      sort: { index: 1, direction: "asc" },
      thenSort: { index: 2, direction: "desc" },
    },
  );
  assert.match(
    formula,
    /SORTBY\([^)]*INDEX\([^)]*,,2\),1,INDEX\([^)]*,,3\),-1\)/,
  );
});

test("the client plan and the server plan agree on the second key", () => {
  const specs: any = {
    view: {
      sort: { column: 1, direction: "asc" },
      thenSort: { column: 2, direction: "desc" },
    },
  };
  const data: any = {
    workbookId: "w",
    worksheetName: "S",
    address: "A1:C6",
    values: [HEADERS, ...ROWS],
    hasHeaders: true,
  };
  const local = createExcelPreviewPlan(data, ["view"], 500, specs);
  const server = createServerExcelPreviewPlan(data, ["view"], 500, specs);
  assert.ok(excelPlansMatch(local, server as any));
  assert.deepEqual((local.actions[0] as any).spec.thenSort, {
    column: "Qty",
    index: 2,
    direction: "desc",
  });
});

test("a second key without a first, or on the same column, is rejected", () => {
  const data: any = {
    workbookId: "w",
    worksheetName: "S",
    address: "A1:C6",
    values: [HEADERS, ...ROWS],
    hasHeaders: true,
  };
  assert.throws(() =>
    createExcelPreviewPlan(data, ["view"], 500, {
      view: { thenSort: { column: 2, direction: "asc" } },
    } as any),
  );
  assert.throws(() =>
    createExcelPreviewPlan(data, ["view"], 500, {
      view: {
        sort: { column: 2, direction: "asc" },
        thenSort: { column: 2, direction: "desc" },
      },
    } as any),
  );
});
