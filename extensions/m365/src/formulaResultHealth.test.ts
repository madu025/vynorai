import assert from "node:assert/strict";
import { test } from "node:test";
import { HEALTH_MAX_ROWS, formulaResultHealth } from "./formulaResultHealth.js";

test("a join that gives Not found on every row is reported", () => {
  const health = formulaResultHealth(Array(3000).fill("Not found"));
  assert.equal(health.checked, HEALTH_MAX_ROWS);
  assert.equal(health.misses, HEALTH_MAX_ROWS);
  assert.match(health.warning ?? "", /100%.*not found/);
});

test("a #SPILL! result is reported even when it is one cell", () => {
  const health = formulaResultHealth(["#SPILL!"]);
  assert.equal(health.errors, 1);
  assert.equal(health.firstError, "#SPILL!");
  assert.match(health.warning ?? "", /#SPILL!/);
});

test("a few unmatched rows in a good join are not a warning", () => {
  const values = [...Array(95).fill("North"), ...Array(5).fill("Not found")];
  const health = formulaResultHealth(values);
  assert.equal(health.misses, 5);
  assert.equal(health.warning, undefined);
});

test("30% or more not found is a warning; numbers and blanks are fine", () => {
  assert.match(
    formulaResultHealth(["Not found", "not found", "No match", "N/A", 12, ""]).warning ?? "",
    /4 of 6/,
  );
  assert.equal(formulaResultHealth([1, 2, 3, "", "East"]).warning, undefined);
  assert.equal(formulaResultHealth([]).warning, undefined);
});

test("two cells that both missed are reported; one of two is not", () => {
  assert.ok(formulaResultHealth(["Not found", "Not found"]).warning);
  assert.equal(formulaResultHealth(["Not found", "South"]).warning, undefined);
});

test("a text that only starts like a word is not a miss", () => {
  assert.equal(formulaResultHealth(Array(10).fill("Missing invoice paid")).warning, undefined);
});

test("the not-found limit is 30%, the same as the check before review", () => {
  const rows = (misses: number) => [...Array(10 - misses).fill("East"), ...Array(misses).fill("Not found")];
  assert.ok(formulaResultHealth(rows(3)).warning);
  assert.equal(formulaResultHealth(rows(2)).warning, undefined);
});
