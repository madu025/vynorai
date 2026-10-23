import assert from "node:assert/strict";
import { test } from "node:test";
import type { StagedChange } from "./agent.js";
import {
  lintChanges,
  lintFormula,
  repairChanges,
  repairFormula,
} from "./formulaLint.js";

test("GROUPBY with field_headers 1 on ranges below the header is flagged", () => {
  const formula = "=GROUPBY(TRIM('Orders'!D2:D301),'Orders'!J2:J301,SUM,1,0)";
  const issues = lintFormula(formula);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /first data row is dropped/);
});

test("field_headers 3 is flagged too, 0 and omitted are not", () => {
  assert.equal(lintFormula("=GROUPBY(A2:A9,B2:B9,SUM,3)").length, 1);
  assert.equal(lintFormula("=GROUPBY(A2:A9,B2:B9,SUM,0,0)").length, 0);
  assert.equal(lintFormula("=GROUPBY(A2:A9,B2:B9,SUM)").length, 0);
});

test("ranges that include the header row may say 1", () => {
  assert.equal(lintFormula("=GROUPBY(A1:A9,B1:B9,SUM,1)").length, 0);
});

test("PIVOTBY reads field_headers from its fifth argument", () => {
  assert.equal(lintFormula("=PIVOTBY(A2:A9,C2:C9,B2:B9,SUM,1)").length, 1);
  assert.equal(lintFormula("=PIVOTBY(A1:A9,C1:C9,B1:B9,SUM,3)").length, 0);
});

test("nested calls and quoted commas do not confuse the argument split", () => {
  const formula =
    "=GROUPBY(DATE(YEAR('Orders'!B2:B301),MONTH('Orders'!B2:B301),1),'Orders'!J2:J301,SUM,0,0)";
  assert.equal(lintFormula(formula).length, 0);
  assert.equal(
    lintFormula('=GROUPBY(IF(A2:A9="a,b",1,2),B2:B9,SUM,1)').length,
    1,
  );
});

test("lintChanges names the cell and ignores other changes", () => {
  const changes: { change: StagedChange }[] = [
    {
      change: {
        kind: "write_formula",
        sheet: "Region Summary",
        cell: "A2",
        formula: "=GROUPBY(Orders!D2:D301,Orders!J2:J301,SUM,1,0)",
      },
    },
    {
      change: {
        kind: "write_formula",
        sheet: "S",
        cell: "A1",
        formula: "=SUM(A2:A9)",
      },
    },
  ];
  const issues = lintChanges(changes);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^'Region Summary'!A2:/);
});

test("the mistake is repaired: 1 becomes 0 and 3 becomes 2, the rest of the formula is untouched", () => {
  const formula =
    "=GROUPBY(TRIM(Orders!D2:D301),HSTACK(Orders!J2:J301,Orders!K2:K301),HSTACK(SUM,SUM),1,0)";
  const fixed = repairFormula(formula);
  assert.equal(
    fixed,
    "=GROUPBY(TRIM(Orders!D2:D301),HSTACK(Orders!J2:J301,Orders!K2:K301),HSTACK(SUM,SUM),0,0)",
  );
  assert.deepEqual(lintFormula(fixed), []);
  assert.equal(
    repairFormula("=PIVOTBY(A2:A9,C2:C9,B2:B9,SUM,3)"),
    "=PIVOTBY(A2:A9,C2:C9,B2:B9,SUM,2)",
  );
  // A correct formula is returned as it was.
  assert.equal(
    repairFormula("=GROUPBY(A1:A9,B1:B9,SUM,1)"),
    "=GROUPBY(A1:A9,B1:B9,SUM,1)",
  );
});

test("repairChanges fixes staged formulas in place and counts them", () => {
  const changes = [
    {
      change: {
        kind: "write_formula",
        sheet: "S",
        cell: "A1",
        formula: "=GROUPBY(A2:A9,B2:B9,SUM,1,0)",
      } as StagedChange,
    },
    {
      change: {
        kind: "write_formula",
        sheet: "S",
        cell: "A9",
        formula: "=SUM(A2:A9)",
      } as StagedChange,
    },
  ];
  assert.equal(repairChanges(changes), 1);
  assert.equal(lintChanges(changes).length, 0);
});

test("lintChanges flags a write inside the area a table formula spills into", () => {
  const spill = {
    kind: "write_formula" as const,
    sheet: "Orders with Region",
    cell: "A1",
    formula:
      '=VSTACK(HSTACK(Orders!A1:L1,"Region ID"),HSTACK(Orders!A2:L3001,XLOOKUP(Orders!C2:C3001,Customers!A2:A3001,Customers!E2:E3001,"Not found")))',
  };
  const header = {
    kind: "write_values" as const,
    sheet: "Orders with Region",
    cell: "M1",
    values: [["Region ID"]],
  };
  const issues = lintChanges([{ change: spill }, { change: header }]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /M1.*#SPILL!/);
  const outside = { ...header, cell: "N1" };
  assert.equal(lintChanges([{ change: spill }, { change: outside }]).length, 0);
  const otherSheet = { ...header, sheet: "Other" };
  assert.equal(
    lintChanges([{ change: spill }, { change: otherSheet }]).length,
    0,
  );
});
