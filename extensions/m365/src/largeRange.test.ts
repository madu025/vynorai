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

import { parseExpression } from "./expression.js";
import { addColumnFormula, columnRef, keyColumnFormula } from "./largeRange.js";

test("a computed column is one MAP over whole columns, so every function stays row by row", () => {
  assert.equal(columnRef(range, 6), "'detail-report'!$G$2:$G$520126");
  assert.equal(
    addColumnFormula(range, { leftIndex: 6, operator: "+", rightIndex: 7 }),
    `=MAP('detail-report'!$G$2:$G$520126,'detail-report'!$H$2:$H$520126,LAMBDA(_v6,_v7,_v6+_v7))`,
  );
  assert.equal(
    addColumnFormula(range, { leftIndex: 6, operator: "/", rightIndex: 7 }),
    `=MAP('detail-report'!$G$2:$G$520126,'detail-report'!$H$2:$H$520126,LAMBDA(_v6,_v7,IF(_v7=0,"",_v6/_v7)))`,
  );
  const headers = ["a", "b", "c", "d", "e", "f", "Qty", "Issued", "i", "j"];
  const parsed = parseExpression("MAX(Qty, Issued) - 1", headers);
  assert.equal(
    addColumnFormula(range, {}, parsed.ast),
    `=MAP('detail-report'!$G$2:$G$520126,'detail-report'!$H$2:$H$520126,LAMBDA(_v6,_v7,(MAX(_v6,_v7)-1)))`,
  );
  assert.equal(
    keyColumnFormula(range),
    `=LET(a,'detail-report'!$A$2:$A$520126,IF(a="","",a))`,
  );
});

test("derived columns and lookups become spilled formulas over the whole range", () => {
  const base = { sourceIndex: 6 };
  assert.match(
    addColumnFormula(range, { ...base, derived: "running-total" }),
    /^=SCAN\(0,'detail-report'!\$G\$2:\$G\$520126,LAMBDA\(a,b,IF\(ISNUMBER\(b\),a\+b,a\)\)\)$/,
  );
  assert.match(
    addColumnFormula(range, { ...base, derived: "rank" }),
    /^=XMATCH\(.*SORT\(.*,,-1\)\)$/,
  );
  assert.match(
    addColumnFormula(range, { ...base, derived: "percent-change" }),
    /VSTACK\(NA\(\),DROP\(cur,-1\)\)/,
  );
  assert.match(
    addColumnFormula(range, { ...base, derived: "yoy", lag: 12 }),
    /DROP\(cur,-12\)/,
  );
  assert.match(
    addColumnFormula(range, { ...base, derived: "moving-average", window: 3 }),
    /SEQUENCE\(ROWS\(cur\)\)<3/,
  );
  assert.equal(
    addColumnFormula(range, { ...base, derived: "date-group", group: "month" }),
    `=TEXT('detail-report'!$G$2:$G$520126,"yyyy-mm")`,
  );
  assert.equal(
    addColumnFormula(range, {
      lookup: {
        sheet: "Items",
        sourceKeyIndexes: [5],
        lookupKeyIndexes: [0],
        returnIndex: 2,
        rows: 40,
        matchMode: "exact",
      },
    }),
    `=MAP('detail-report'!$F$2:$F$520126,LAMBDA(_v5,IFERROR(INDEX('Items'!$C$2:$C$41,MATCH(_v5,'Items'!$A$2:$A$41,0)),"")))`,
  );
  assert.throws(
    () => addColumnFormula(range, { derived: "yoy", sourceIndex: 6 }),
    /lag/i,
  );
  assert.throws(
    () =>
      addColumnFormula(range, { leftIndex: 99, operator: "+", rightIndex: 1 }),
    /outside the source range/,
  );
});

import { cleanFormula, largeCleanRows } from "./largeRange.js";

test("clean-up is one spilled formula and never turns a blank into zero", () => {
  assert.equal(
    cleanFormula(range, { operations: ["trim"] }),
    `=LET(d,TAKE('detail-report'!$A$2:$J$520126,50000),t,IF(ISTEXT(d),TRIM(d),d),k,IF(t="","",t),k)`,
  );
  assert.equal(
    cleanFormula(range, {
      operations: ["trim", "text-to-number", "fill-blanks", "dedupe"],
      fillBlanks: 'n/"a',
      fillBlanksColumnIndex: 2,
    }),
    `=LET(d,TAKE('detail-report'!$A$2:$J$520126,50000),t,IF(ISTEXT(d),TRIM(d),d),n,IF(ISTEXT(t)*ISERROR(DATEVALUE(t))*(((LEFT(t,1)<>"0")+(MID(t,2,1)=".")>0)*(LEN(t)<16)),IFERROR(VALUE(SUBSTITUTE(TRIM(t),",","")),t),t),b,IF(SEQUENCE(1,COLUMNS(n))=3,IF(n="","n/""a",n),n),u,UNIQUE(b),u)`,
  );
  assert.throws(
    () => cleanFormula(range, { operations: ["fuzzy-dedupe"] }),
    /Fuzzy duplicate/,
  );
  assert.throws(
    () =>
      cleanFormula(range, {
        operations: ["fill-blanks"],
        fillBlanks: 1,
        fillBlanksColumnIndex: 40,
      }),
    /outside the source range/,
  );
});

test("a cleaned copy covers a bounded number of rows so Excel on the web can hold it", () => {
  assert.equal(largeCleanRows(10), 50000);
  assert.equal(largeCleanRows(40), 12500);
  assert.equal(largeCleanRows(500), 1000);
  assert.equal(largeCleanRows(5000), 1000);
});

import { qualityReportCells } from "./largeRange.js";

test("the quality report is a small table of live formulas over every row", () => {
  const cells = qualityReportCells(range, ["Item", "Qty"]);
  assert.equal(cells[1][1], `=ROWS('detail-report'!$A$2:$A$520126)`);
  assert.equal(cells[2][0], "Column");
  assert.equal(cells.length, 5);
  assert.equal(cells[3][0], "Item");
  assert.equal(
    cells[3][1],
    `=ROWS('detail-report'!$A$2:$A$520126)-COUNTBLANK('detail-report'!$A$2:$A$520126)`,
  );
  assert.equal(cells[4][6], "=MAX(0,B5-F5)");
  assert.equal(
    cells[4][9],
    `=IF(COUNT('detail-report'!$B$2:$B$520126)>0,MIN('detail-report'!$B$2:$B$520126),"")`,
  );
});

import { splitColumnFormulas } from "./largeRange.js";

test("splitting a name column is spilled formulas over every row", () => {
  const out = splitColumnFormulas(
    {
      sheetName: "detail-report",
      startColumn: 0,
      startRow: 0,
      endRow: 520124,
      columns: 10,
    },
    4,
  );
  assert.ok(
    out.first.startsWith("=MAP('detail-report'!$E$2:$E$520125,LAMBDA(v,"),
  );
  assert.ok(out.last.includes("TRIM(MID(v,"));
  assert.ok(out.source.startsWith("=LET(a,'detail-report'!$E$2:$E$520125"));
});

import { unpivotFormula, unpivotRows } from "./largeRange.js";

test("an unpivot is one bounded spilled formula", () => {
  const formula = unpivotFormula(
    {
      sheetName: "detail-report",
      startColumn: 0,
      startRow: 0,
      endRow: 520124,
      columns: 10,
    },
    {
      dimensions: [0, 1, 2],
      values: [6, 7],
      valueHeaders: ["Requested Quantity", "Issued Quantity"],
    },
  );
  assert.ok(formula.startsWith("=LET(d,TAKE('detail-report'!$A$2:$J$520125,"));
  assert.ok(formula.includes("VSTACK(HSTACK(CHOOSECOLS(d,1,2,3)"));
  assert.ok(formula.includes('"Issued Quantity"'));
  assert.equal(unpivotRows(5, 2), 50000);
  assert.throws(() =>
    unpivotFormula(
      { sheetName: "s", startColumn: 0, startRow: 0, endRow: 9, columns: 3 },
      { dimensions: [0], values: [1], valueHeaders: ["b"] },
    ),
  );
});

import { histogramCells } from "./largeRange.js";

test("a histogram of a very large column is ten COUNTIFS bins over every row", () => {
  const cells = histogramCells(
    {
      sheetName: "Big",
      startColumn: 0,
      startRow: 0,
      endRow: 520124,
      columns: 10,
    },
    6,
    "Requested Quantity",
  );
  assert.equal(cells.length, 11);
  assert.equal(cells[0][0], "Requested Quantity");
  assert.ok(
    cells[1][1].startsWith("=COUNTIFS('Big'!$G$2:$G$520125,\">=\"&C2,"),
  );
  assert.ok(cells[10][1].includes('"<="&D11'));
  assert.ok(cells[1][1].includes('"<"&D2'));
});

import { readFileSync } from "node:fs";

test("LET names in generated formulas are never cell references or the reserved c and r", () => {
  // Excel rejects LET(c,...) and LET(q1,...): the add-in would fail only inside a real workbook.
  for (const file of ["largeRange.ts", "statistics.ts", "transform.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const bad = /(?:LET\(|[,)]\s*)(?:c|r|[A-Za-z]{1,3}\d{1,7}),(?=[A-Za-z(])/g;
    const hits = source.match(bad) ?? [];
    assert.deepEqual(hits, [], `${file} has an invalid LET name`);
  }
});

test("an A1 address from the sheet gives the data rows right below the header", async () => {
  const { parseLocalRange } = await import("./transform.js");
  const parsed = parseLocalRange("A1:J520126");
  // parseLocalRange is 1-based, LargeRef is 0-based: the callers subtract one.
  const ref = {
    sheetName: "detail-report",
    startColumn: parsed.startColumn,
    startRow: parsed.startRow - 1,
    endRow: parsed.endRow - 1,
    columns: 10,
  };
  assert.equal(dataRef(ref), "'detail-report'!$A$2:$J$520126");
  assert.equal(headerRef(ref), "'detail-report'!$A$1:$J$1");
});

test("an equals filter compares as text so an ID with a leading zero matches", () => {
  assert.equal(
    viewFormula(range, {
      filter: { index: 9, operator: "=", value: "0112005016" },
    }),
    `=LET(d,'detail-report'!$A$2:$J$520126,f,FILTER(d,INDEX(d,,10)&""="0112005016",""),IFERROR(f,"No rows match"))`,
  );
  assert.match(
    viewFormula(range, { filter: { index: 6, operator: "!=", value: 5 } }),
    /INDEX\(d,,7\)&""<>"5"/,
  );
});

test("a whole-column figure inside a computed column reads the full source column", () => {
  const { ast } = parseExpression(
    "[Issued Quantity] / COLSUM([Issued Quantity])",
    [
      "Service ID",
      "RTOM",
      "LEA",
      "PAT Complete Date",
      "Status",
      "Item Code",
      "Requested Quantity",
      "Issued Quantity",
      "UoM",
      "Circuit ID",
    ],
  );
  const formula = addColumnFormula(range, {}, ast);
  // The total is worked out once, in a LET, not again inside the per-row function.
  assert.match(
    formula,
    /^=LET\(_k0,SUM\('detail-report'!\$H\$2:\$H\$520126\),MAP\(/,
  );
  assert.equal(formula.match(/SUM\(/g)?.length, 1);
  assert.match(formula, /_v7\/_k0\)/);
});

test("a row test is calculated for every row first, then the view filters on it", () => {
  const headers = [
    "Service ID",
    "RTOM",
    "LEA",
    "PAT Complete Date",
    "Status",
    "Item Code",
    "Requested Quantity",
    "Issued Quantity",
    "UoM",
    "Circuit ID",
  ];
  const { ast } = parseExpression(
    'AND([Status]="S",[Issued Quantity]<[Requested Quantity])',
    headers,
  );
  const formula = viewFormula(range, { where: ast, limit: 10 });
  assert.match(
    formula,
    /^=LET\(d,'detail-report'!\$A\$2:\$J\$520126,w,FILTER\(d,MAP\(/,
  );
  assert.match(formula, /t,TAKE\(w,10\)/);
  const both = viewFormula(range, {
    where: ast,
    sort: { index: 7, direction: "desc" },
  });
  assert.match(both, /s,SORTBY\(w,INDEX\(w,,8\),-1\)/);
});

test("per-group and conditional figures on very large data are worked out once, never per row", () => {
  const headers = [
    "Service ID",
    "RTOM",
    "LEA",
    "PAT Complete Date",
    "Status",
    "Item Code",
    "Requested Quantity",
    "Issued Quantity",
    "UoM",
    "Circuit ID",
  ];
  const share = addColumnFormula(
    range,
    {},
    parseExpression(
      "[Issued Quantity] / GROUPSUM([Issued Quantity], [RTOM])",
      headers,
    ).ast,
  );
  // One GROUPBY over the whole data, then one value per row walked by MAP next to the data.
  assert.equal(share.match(/GROUPBY\(/g)?.length, 1);
  assert.doesNotMatch(share, /SUMIFS/);
  assert.match(
    share,
    /^=LET\(_g0,LET\(_t,GROUPBY\('detail-report'!\$B\$2:\$B\$520126,'detail-report'!\$H\$2:\$H\$520126,SUM,0,0\),XLOOKUP\('detail-report'!\$B\$2:\$B\$520126,TAKE\(_t,,1\),TAKE\(_t,,-1\),"",0,2\)\),MAP\(/,
  );
  assert.match(share, /,_g0,LAMBDA\(_v1,_v7,_r0,/);
  assert.match(share, /_v7\/_r0/);
  // A row test with a whole-column figure is hoisted too (it was once recalculated for every row).
  const above = viewFormula(range, {
    where: parseExpression(
      '[Issued Quantity] > COLAVGIF([Issued Quantity], [Status], "S")',
      headers,
    ).ast,
  });
  assert.equal(above.match(/AVERAGEIFS\(/g)?.length, 1);
  assert.match(above, /w,FILTER\(d,LET\(_k0,IFERROR\(AVERAGEIFS\(/);
});
