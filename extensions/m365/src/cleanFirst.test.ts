import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerExcelPreviewPlan } from "../../../backend/src/services/m365ExcelPlan.js";
import { createExcelPreviewPlan, excelPlansMatch } from "./excel.js";

const HEADERS = ["Order No", "Region", "Net Amount"];
const ROWS = [
  ["1", " Central ", 10],
  ["2", "Central", 20],
  ["3", "North", 5],
];
const DATA: any = {
  workbookId: "w",
  worksheetName: "S",
  address: "A1:C4",
  values: [HEADERS, ...ROWS],
  hasHeaders: true,
};

test("a clean step is planned before the PivotTable and chart that read from it, on both sides", () => {
  const specs: any = {
    clean: { operations: ["trim"] },
    pivot: { rows: 1, values: 2, aggregation: "sum" },
    chart: { category: 1, value: 2, chartType: "column" },
  };
  const local = createExcelPreviewPlan(
    DATA,
    ["pivot-table", "chart", "clean"],
    500,
    specs,
  );
  const server = createServerExcelPreviewPlan(
    DATA,
    ["pivot-table", "chart", "clean"],
    500,
    specs,
  );
  const kinds = local.actions.map((action: any) => action.kind);
  assert.ok(
    kinds.indexOf("clean") < kinds.indexOf("pivot-table"),
    kinds.join(),
  );
  assert.ok(kinds.indexOf("clean") < kinds.indexOf("chart"), kinds.join());
  assert.ok(excelPlansMatch(local, server as any));
});
