import assert from "node:assert/strict";
import fs from "node:fs";
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

test("the backend expression engine is an exact copy of the add-in one", () => {
  const strip = (text: string) =>
    text
      .replace(/^\/\*\*[\s\S]*?\*\/\n/, "")
      .replace(/\r\n/g, "\n")
      .trim();
  const addIn = fs.readFileSync(
    new URL("../../extensions/m365/src/expression.ts", import.meta.url),
    "utf8",
  );
  const backend = fs.readFileSync(
    new URL("../src/services/m365Expression.ts", import.meta.url),
    "utf8",
  );
  assert.equal(strip(backend), strip(addIn));
});

test("server and add-in build the same plan for an expression column", () => {
  const specs = {
    addColumn: { name: "Margin %", expression: "(Sales - Cost) / Sales" },
  };
  const server = createServerExcelPreviewPlan(
    input,
    ["add-column"],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    input as any,
    ["add-column"],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  const spec = server.actions.find((a: any) => a.kind === "add-column")!.spec;
  assert.equal(spec.expression, "(Sales - Cost) / Sales");
  assert.equal(spec.percentFormat, true);
  assert.deepEqual(spec.refs, [2, 3]);
});

test("the server refuses unsafe or unusable expressions", () => {
  const bad = (addColumn: unknown) =>
    createServerExcelPreviewPlan(input, ["add-column"], 500, {
      addColumn,
    } as any);
  assert.throws(
    () => bad({ name: "X", expression: "Sales + Revenue" }),
    /not a column/,
  );
  assert.throws(
    () => bad({ name: "X", expression: "HYPERLINK(Sales)" }),
    /not supported/,
  );
  assert.throws(
    () => bad({ name: "X", expression: "Sales; Cost" }),
    /Unsupported character/,
  );
  assert.throws(
    () => bad({ name: "X", expression: "Region + Sales" }),
    /must contain numbers/,
  );
  assert.throws(
    () => bad({ name: "=X", expression: "Sales + Cost" }),
    /not allowed/,
  );
  assert.throws(
    () => bad({ name: "X", expression: "Sales", left: 2 }),
    /either an expression or two columns/,
  );
});

test("server and add-in build the same summary plan and the server checks it", () => {
  const specs = {
    summary: {
      group: 1,
      values: [
        { column: 2, aggregation: "sum" as const },
        { column: 3, aggregation: "average" as const },
      ],
    },
  };
  const server = createServerExcelPreviewPlan(input, ["summary"], 500, specs);
  const local = createExcelPreviewPlan(input as any, ["summary"], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  const action = server.actions.find((a: any) => a.kind === "summary")!;
  assert.equal(action.targetSheet, "Sheet1_Vynor_Totals");
  assert.deepEqual(action.spec.groups, ["North", "South", "East"]);
  const bad = (summary: unknown) =>
    createServerExcelPreviewPlan(input, ["summary"], 500, { summary } as any);
  assert.throws(
    () => bad({ group: 1, values: [{ column: 1, aggregation: "sum" }] }),
    /differ from the group/,
  );
  assert.throws(
    () => bad({ group: 1, values: [{ column: 2, aggregation: "median" }] }),
    /Unsupported aggregation/,
  );
  assert.throws(() => bad({ group: 1, values: [] }), /between one and four/);
  assert.throws(
    () => bad({ group: 9, values: [{ column: 2, aggregation: "sum" }] }),
    /group by/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["chart"], 500, {
        summary: { group: 1, values: [{ column: 2, aggregation: "sum" }] },
      } as any),
    /summary action/,
  );
});

test("server and add-in agree on format, quality and pivot filter plans", () => {
  const formatSpecs = {
    format: {
      totalRow: true,
      conditional: [
        { column: 2, rule: "data-bars" as const },
        { column: 3, rule: "negative" as const },
      ],
      validation: [{ column: 1, rule: "list" as const }],
    },
  };
  const actions = ["format", "quality"] as const;
  const server = createServerExcelPreviewPlan(
    input,
    [...actions],
    500,
    formatSpecs,
  );
  const local = createExcelPreviewPlan(
    input as any,
    [...actions],
    500,
    formatSpecs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  const targets = server.actions.map((a: any) => a.targetSheet);
  assert.deepEqual(targets, ["Sheet1_Vynor_Format", "Sheet1_Vynor_Report"]);
  const format = server.actions.find((a: any) => a.kind === "format")!;
  assert.deepEqual(format.spec.validation[0].values, [
    "North",
    "South",
    "East",
  ]);
  const pivotSpecs = { pivot: { rows: 1, values: 2, filter: 0 } };
  const pivotServer = createServerExcelPreviewPlan(
    input,
    ["pivot-table"],
    500,
    pivotSpecs,
  );
  const pivotLocal = createExcelPreviewPlan(
    input as any,
    ["pivot-table"],
    500,
    pivotSpecs,
  );
  assert.equal(excelPlansMatch(pivotLocal, pivotServer), true);
  assert.equal(pivotServer.actions[0].spec.filterColumn, "Month");
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["format"], 500, {
        format: { conditional: [{ column: 1, rule: "data-bars" }] },
      } as any),
    /column of numbers/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["pivot-table"], 500, {
        pivot: { rows: 1, values: 2, filter: 1 },
      } as any),
    /filter field/,
  );
});
