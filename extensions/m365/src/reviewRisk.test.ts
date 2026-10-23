import assert from "node:assert/strict";
import test from "node:test";
import type { AgentHost, StagedChange } from "./agent.js";
import { reviewRisk } from "./reviewRisk.js";
import { checkSimpleFormulas, isSimpleAggregate } from "./simpleChecks.js";

const formula = (cell: string, text: string, extra: object = {}) => ({
  change: { kind: "write_formula", sheet: "Data", cell, formula: text, ...extra } as StagedChange,
});

test("a plain total over one column, a format or a small text write is low risk", () => {
  assert.equal(reviewRisk([formula("B12", "=SUM(B2:B11)")]).high, false);
  assert.equal(
    reviewRisk([{ change: { kind: "format_range", sheet: "Data", address: "A1:C1", bold: true } as StagedChange }]).high,
    false,
  );
  assert.equal(
    reviewRisk([{ change: { kind: "write_values", sheet: "Data", cell: "A12", values: [["Total"]] } as StagedChange }]).high,
    false,
  );
});

test("cross-sheet, lookup, array, in-place and large changes go to the reviewers", () => {
  assert.equal(reviewRisk([formula("B12", "=SUM(Other!B2:B11)")]).high, true);
  assert.equal(reviewRisk([formula("B2", "=XLOOKUP(A2,Z:Z,Y:Y)")]).high, true);
  assert.equal(reviewRisk([formula("B2", "=B2*1.18")]).high, true, "not a plain aggregate: rules cannot verify it");
  assert.equal(reviewRisk([formula("B2", "=SUM(B2:B3)", { fillRange: "B2:B900" })]).high, true);
  assert.equal(
    reviewRisk([{ change: { kind: "sort_range", sheet: "Data", address: "A1:C9", column: "B", descending: true } as StagedChange }]).high,
    true,
  );
  assert.equal(
    reviewRisk([{ change: { kind: "excel_action", tool: "filter_range", args: {} } as StagedChange }]).high,
    true,
  );
  const many = Array.from({ length: 4 }, () => formula("B12", "=SUM(B2:B11)"));
  assert.equal(reviewRisk(many).high, true);
  assert.equal(reviewRisk([]).high, false);
});

const host = (values: unknown[]) =>
  ({
    readRange: async () => ({ address: "x", values: values.map((v) => [v]) }),
  }) as unknown as AgentHost;
const column = ["Amount", 10, 20, 30, 40]; // numbers on rows 2..5

test("a total over the whole column passes the rules", async () => {
  assert.deepEqual(await checkSimpleFormulas([formula("B6", "=SUM(B2:B5)")], host(column)), []);
});

test("a range one row short, a range that starts late, and the wrong column are caught", async () => {
  const short = await checkSimpleFormulas([formula("B6", "=SUM(B2:B4)")], host(column));
  assert.match(short[0], /stops at row 4.*run to row 5/);
  const late = await checkSimpleFormulas([formula("B6", "=SUM(B3:B5)")], host(column));
  assert.match(late[0], /starts at row 3.*start at row 2/);
  const wrong = await checkSimpleFormulas([formula("C6", "=SUM(B2:B5)")], host(column));
  assert.match(wrong[0], /sums column B but the result sits under column C/);
  const none = await checkSimpleFormulas([formula("B6", "=SUM(B2:B5)")], host(["Name", "a", "b", "c", "d"]));
  assert.match(none[0], /holds no numbers/);
});

test("only the plain aggregate is verifiable", () => {
  assert.equal(isSimpleAggregate(formula("B6", "=SUM(B2:B5)").change as never), true);
  assert.equal(isSimpleAggregate(formula("B6", "=SUM(B2:C5)").change as never), false);
  assert.equal(isSimpleAggregate(formula("B6", "=B2+B3").change as never), false);
});

test("a typed-in total is not low risk", () => {
  assert.equal(
    reviewRisk([{ change: { kind: "write_values", sheet: "Data", cell: "A12", values: [["Total", 1120]] } as StagedChange }]).high,
    true,
  );
});

test("a write onto cells that already hold something is detected, a new sheet is not", async () => {
  const { overwritesExisting } = await import("./simpleChecks.js");
  const filled = { readRange: async () => ({ address: "x", values: [["Total", 5]] }) } as unknown as AgentHost;
  const empty = { readRange: async () => ({ address: "x", values: [[null, ""]] }) } as unknown as AgentHost;
  const write = { change: { kind: "write_values", sheet: "Data", cell: "A2", values: [["Total", 1]] } as StagedChange };
  assert.equal(await overwritesExisting([write], filled), true);
  assert.equal(await overwritesExisting([write], empty), false);
  const created = { change: { kind: "create_sheet", name: "Data" } as StagedChange };
  assert.equal(await overwritesExisting([created, write], filled), false);
});
