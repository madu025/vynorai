import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerExcelPreviewPlan } from "../src/services/m365ExcelPlan.js";
import {
  createExcelPreviewPlan,
  excelPlansMatch,
} from "../../extensions/m365/src/excel.js";

const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D5",
  hasHeaders: true,
  values: [
    ["Month", "Region", "Sales", "Cost"],
    ["Jan", "North", 1200, 800],
    ["Feb", "South", 1500, 950],
    ["Mar", "North", 1800, 1100],
    ["Apr", "East", 1350, 900],
  ],
};

test("server and add-in build the same plan for explicit column choices", () => {
  const specs = {
    chart: { category: 1, value: 2, chartType: "pie" as const },
    pivot: { rows: 1, values: 3 },
  };
  const actions = ["chart", "pivot-table"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec.valueColumn, "Sales");
  assert.equal(server.actions[1].spec.rowsColumn, "Region");
});

test("a plan with different column choices is not accepted as the same plan", () => {
  const actions = ["chart"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, {
    chart: { category: 1, value: 3, chartType: "column" },
  });
  const local = createExcelPreviewPlan(input as any, [...actions], 500, {
    chart: { category: 1, value: 2, chartType: "column" },
  });
  assert.equal(excelPlansMatch(local, server), false);
});

test("the server refuses unusable column choices", () => {
  const bad = (specs: unknown, actions = ["chart"]) =>
    createServerExcelPreviewPlan(input, actions, 500, specs as any);
  assert.throws(
    () => bad({ chart: { category: 1, value: 1, chartType: "column" } }),
    /different columns/,
  );
  assert.throws(
    () => bad({ chart: { category: 1, value: 99, chartType: "column" } }),
    /different columns/,
  );
  assert.throws(
    () => bad({ chart: { category: 2, value: 1, chartType: "column" } }),
    /must contain numbers/,
  );
  assert.throws(
    () => bad({ pivot: { rows: 1, values: 2 } }),
    /needs a PivotTable action/,
  );
});

test("plans without column choices are unchanged", () => {
  const server = createServerExcelPreviewPlan(input, ["chart"], 500);
  assert.equal(server.actions[0].spec, undefined);
});
