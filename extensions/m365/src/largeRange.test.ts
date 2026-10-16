import assert from "node:assert/strict";
import { test } from "node:test";
import { dataRef, excelText, headerRef, viewFormula } from "./largeRange.js";

const range = {
  sheetName: "detail-report",
  startColumn: 0,
  startRow: 0,
  endRow: 520125,
  columns: 10,
};

test("large range references cover the whole source and quote the sheet", () => {
  assert.equal(dataRef(range), "'detail-report'!$A$2:$J$520126");
  assert.equal(headerRef(range), "'detail-report'!$A$1:$J$1");
  assert.equal(
    dataRef({ ...range, sheetName: "Bob's data" }),
    "'Bob''s data'!$A$2:$J$520126",
  );
});

test("text is escaped so it can never end a formula string early", () => {
  assert.equal(excelText('a"b'), '"a""b"');
  assert.equal(excelText("=1+1"), '"=1+1"');
});

test("a view is one spilled formula: filter, sort, then keep the first rows", () => {
  assert.equal(
    viewFormula(range, {
      filter: { index: 6, operator: ">", value: 5 },
      sort: { index: 7, direction: "desc" },
      limit: 10,
    }),
    `=LET(d,'detail-report'!$A$2:$J$520126,f,FILTER(d,INDEX(d,,7)>5,""),s,SORTBY(f,INDEX(f,,8),-1),t,TAKE(s,10),IFERROR(t,"No rows match"))`,
  );
  assert.equal(
    viewFormula(range, {
      filter: { index: 5, operator: "contains", value: 'OSP"X' },
    }),
    `=LET(d,'detail-report'!$A$2:$J$520126,f,FILTER(d,ISNUMBER(SEARCH("OSP""X",INDEX(d,,6))),""),IFERROR(f,"No rows match"))`,
  );
  assert.equal(
    viewFormula(range, { sort: { index: 0, direction: "asc" } }),
    `=LET(d,'detail-report'!$A$2:$J$520126,s,SORTBY(d,INDEX(d,,1),1),IFERROR(s,"No rows match"))`,
  );
});

test("a view formula refuses an index outside the range or a bad number", () => {
  assert.throws(
    () => viewFormula(range, { sort: { index: 10, direction: "asc" } }),
    /outside the source range/,
  );
  assert.throws(
    () =>
      viewFormula(range, {
        filter: { index: 0, operator: ">", value: Number.NaN },
      }),
    /not a finite number/,
  );
  assert.throws(
    () => viewFormula(range, { limit: 0 }),
    /positive whole number/,
  );
});
