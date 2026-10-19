import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { detectMacroRequest, generateMacro } from "./macroGen.js";

const HEADERS = ["Service ID", "Region", "Sales", "Cost"];
const ROWS = [
  ["HK001", "North", 10, 4],
  ["HK002", "South", 20, 8],
];

const syntaxErrors = (code: string) =>
  ts.transpileModule(code, { reportDiagnostics: true }).diagnostics ?? [];

test("detects the language a code request asks for", () => {
  assert.equal(
    detectMacroRequest("write an Office Script that adds a Total column"),
    "office-script",
  );
  assert.equal(
    detectMacroRequest("write a VBA macro that sorts the sheet"),
    "vba",
  );
  assert.equal(detectMacroRequest("sort by Sales"), undefined);
});

test("Office Script: Total column sums only the numeric columns and parses as TypeScript", () => {
  const result = generateMacro(
    "write an Office Script that adds a Total column",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.code, /\["Sales", "Cost"\]/);
  assert.doesNotMatch(result.code, /Service ID/);
  assert.match(result.code, /setFormulas/);
  assert.equal(syntaxErrors(result.code).length, 0);
  assert.ok(result.notes.some((note) => /did not run this code/.test(note)));
});

test("Total never adds dates, identifiers or rates", () => {
  const headers = [
    "Order No",
    "Ship Date",
    "Due",
    "Discount %",
    "Qty",
    "Price",
  ];
  const rows = [
    [1001, 45720, 45730, 0.1, 2, 5.5],
    [1002, 45721, 45731, 0.2, 3, 6],
  ];
  const result = generateMacro(
    "write an Office Script that adds a Total column",
    headers,
    rows,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.code, /\["Qty", "Price"\]/);
  assert.doesNotMatch(result.code, /Order No|Ship Date|"Due"|Discount/);
});

test("VBA: sort by a named column, descending, and freeze the header", () => {
  const result = generateMacro(
    "write a VBA macro that sorts by Sales descending and freezes the header",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.code, /Application\.Match\("Sales"/);
  assert.match(result.code, /xlDescending/);
  assert.match(result.code, /FreezePanes = True/);
  assert.match(result.code, /^Sub VynorMacro\(\)[\s\S]*End Sub$/);
});

test("sorting without a column falls back to the first column and says so", () => {
  const result = generateMacro(
    "write a VBA macro that sorts the sheet",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.code, /Application\.Match\("Service ID"/);
  assert.ok(result.notes.some((note) => /first column/.test(note)));
});

test("an unknown sort column fails closed and lists the real columns", () => {
  const result = generateMacro(
    "write an Office Script that sorts by Margin",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.problem, /Service ID, Region, Sales, Cost/);
});

test("a column rule it cannot guess is refused, not invented", () => {
  const result = generateMacro(
    "write an Office Script that adds a Profit column",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, false);
});

test("every recipe together produces valid TypeScript in Office Script", () => {
  const result = generateMacro(
    "write an Office Script that adds a Total column, sorts by Cost, freezes the header, autofit the columns, removes duplicates, turns on filter buttons and bolds the header",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.steps.length, 7);
  assert.equal(syntaxErrors(result.code).length, 0);
});

test("a header with quotes is escaped in both languages", () => {
  const headers = ['Ref "A"', "Amount"];
  const rows = [["x", 5]];
  const script = generateMacro(
    'write an Office Script that sorts by Ref "A"',
    headers,
    rows,
  );
  assert.equal(script.ok && syntaxErrors(script.code).length === 0, true);
  const macro = generateMacro(
    'write a VBA macro that sorts by Ref "A"',
    headers,
    rows,
  );
  assert.equal(macro.ok && macro.code.includes('"Ref ""A"""'), true);
});

test("a request outside the recipes names what is supported", () => {
  const result = generateMacro(
    "write a macro that emails every customer",
    HEADERS,
    ROWS,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.problem, /sort by a column/);
});
