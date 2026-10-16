import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnalysisConsentError,
  buildSchemaSummary,
  createAnalysisRequest,
  recommendationToInstruction,
  redactPersonalData,
  validateAnalysisResult,
} from "./analysis.js";
import { createExcelPreviewPlan, selectExcelActions } from "./excel.js";
import { inspectSelectedExcelRange } from "./officeExcel.js";

const regions = ["Colombo", "Kandy", "Galle"];
const salesRows = Array.from({ length: 12 }, (_, index) => [
  `CUST-${1000 + index}`,
  regions[index % 3],
  `person${index}@example.com`,
  100 + index * 10,
  `2026-03-${String(index + 1).padStart(2, "0")}`,
]);
const sales = {
  workbookId: "book",
  worksheetName: "Sales",
  address: "Sheet1!A1:E13",
  hasHeaders: true,
  values: [
    ["Customer ID", "Region", "Contact", "Revenue", "Order date"],
    ...salesRows,
  ],
};

test("local summary carries structure only, never cell values", () => {
  const summary = buildSchemaSummary(sales);
  const serialized = JSON.stringify(summary);
  for (const secret of [
    "CUST-1000",
    "person1@example.com",
    "Colombo",
    "Kandy",
    "Galle",
  ])
    assert.doesNotMatch(serialized, new RegExp(secret));

  assert.equal(summary.rowCount, 12);
  assert.equal(summary.columnCount, 5);
  const byName = Object.fromEntries(summary.columns.map((c) => [c.name, c]));
  assert.equal(byName["Customer ID"].roleHint, "identifier");
  assert.equal(byName["Customer ID"].numeric, undefined);
  assert.equal(byName["Customer ID"].distinct, undefined);
  assert.equal(byName.Contact.containsPersonalData, true);
  assert.equal(byName.Contact.roleHint, "identifier");
  assert.equal(byName.Region.roleHint, "category");
  assert.equal(byName.Region.distinct, 3);
  assert.deepEqual(byName.Region.topShares, [0.333, 0.333, 0.333]);
  assert.equal(byName.Revenue.roleHint, "measure");
  assert.deepEqual(byName.Revenue.numeric, { min: 100, max: 210 });
  assert.equal(byName["Order date"].roleHint, "date");
  assert.deepEqual(byName["Order date"].date, {
    min: "2026-03-01",
    max: "2026-03-12",
  });
});

test("personal data in headers and values is redacted or flagged", () => {
  assert.equal(
    redactPersonalData("Mail owner@example.com or call +94 77 123 4567"),
    "Mail [personal-data] or call [personal-data]",
  );
  assert.equal(redactPersonalData("Amount 15000000"), "Amount 15000000");
  const summary = buildSchemaSummary({
    ...sales,
    values: [
      ["owner@example.com", "Revenue"],
      ["a", 1],
      ["b", 2],
    ],
  });
  assert.equal(summary.columns[0].name, "[personal-data]");
  assert.equal(summary.columns[0].containsPersonalData, true);
  assert.doesNotMatch(JSON.stringify(summary), /owner@example/);
});

test("two-row merged headers are normalized before summarizing", () => {
  const summary = buildSchemaSummary({
    workbookId: "book",
    worksheetName: "Plan",
    address: "A1:D4",
    hasHeaders: true,
    values: [
      ["Sales", "", "Cost", ""],
      ["Q1", "Q2", "Q1", "Q2"],
      [10, 20, 5, 6],
      [11, 21, 7, 8],
    ],
  });
  assert.equal(summary.headerRowCount, 2);
  assert.equal(summary.rowCount, 2);
  assert.deepEqual(
    summary.columns.map((column) => column.name),
    ["Sales Q1", "Sales Q2", "Cost Q1", "Cost Q2"],
  );
  assert.ok(summary.columns.every((column) => column.roleHint === "measure"));
});

test("ambiguous headers fail before anything could be sent", () => {
  assert.throws(
    () =>
      buildSchemaSummary({
        ...sales,
        values: [
          ["A", "A"],
          [1, 2],
        ],
      }),
    /unique header/,
  );
});

test("an analysis request cannot be built without explicit consent", () => {
  const summary = buildSchemaSummary(sales);
  for (const consent of [false, undefined, "true", 1] as any[])
    assert.throws(
      () => createAnalysisRequest(summary, consent),
      AnalysisConsentError,
    );
  assert.deepEqual(createAnalysisRequest(summary, true).consent, true);
});

test("server answers are accepted only when they match the strict contract", () => {
  const good = {
    summary: "Sales data",
    columns: [
      {
        index: 3,
        name: "Revenue",
        inferredType: "integer",
        role: "measure",
        confidence: 0.9,
        reason: "Numeric",
      },
    ],
    dataQuality: [{ severity: "info", message: "ok", confidence: 0.5 }],
    recommendations: [
      {
        kind: "chart",
        title: "Revenue by region",
        columns: [1, 3],
        chartType: "column",
        confidence: 0.8,
        reason: "Category and measure",
      },
    ],
  };
  assert.equal(validateAnalysisResult(good, 5).recommendations.length, 1);
  const rejected: unknown[] = [
    null,
    "text",
    { ...good, extra: true },
    { ...good, summary: "" },
    {
      ...good,
      recommendations: [{ ...good.recommendations[0], kind: "delete-rows" }],
    },
    {
      ...good,
      recommendations: [{ ...good.recommendations[0], columns: [9] }],
    },
    {
      ...good,
      recommendations: [{ ...good.recommendations[0], confidence: 2 }],
    },
    {
      ...good,
      recommendations: [{ ...good.recommendations[0], formula: "=A1" }],
    },
  ];
  for (const value of rejected)
    assert.throws(
      () => validateAnalysisResult(value, 5),
      /AI_ANALYSIS_INVALID/,
    );
});

test("a recommendation becomes an existing allowlisted preview plan, never a mutation", () => {
  const base = {
    title: "t",
    columns: [1, 3],
    confidence: 0.9,
    reason: "r",
  };
  const chart = recommendationToInstruction({ ...base, kind: "chart" });
  const pivot = recommendationToInstruction({ ...base, kind: "pivot-table" });
  const table = recommendationToInstruction({ ...base, kind: "table" });
  assert.deepEqual(selectExcelActions(chart!), ["chart"]);
  assert.deepEqual(selectExcelActions(pivot!), ["pivot-table"]);
  assert.deepEqual(selectExcelActions(table!), ["table"]);
  assert.equal(
    recommendationToInstruction({ ...base, kind: "filter" }),
    undefined,
  );
  assert.equal(
    recommendationToInstruction({ ...base, kind: "grouping" }),
    undefined,
  );

  const plan = createExcelPreviewPlan(sales as any, selectExcelActions(chart!));
  assert.equal(plan.requiresConfirmation, true);
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["chart"],
  );
});

test("building a summary only reads the selection and writes nothing", async () => {
  const touched: string[] = [];
  const range = (values: unknown[][]) => ({
    address: "Sheet1!A1:E13",
    rowCount: values.length,
    columnCount: values[0].length,
    worksheet: { name: "Sales", load: () => touched.push("worksheet.load") },
    load: (properties: unknown) => touched.push(`load:${String(properties)}`),
    getCell: (row: number) => ({
      getResizedRange: (rows: number) => ({
        values: values.slice(row, row + rows + 1),
        load: () => touched.push("chunk.load"),
      }),
    }),
  });
  const workbook = {
    getSelectedRange: () => {
      touched.push("getSelectedRange");
      return range(sales.values);
    },
    // Anything else (tables, worksheets, charts, pivotTables) is absent: touching it would throw.
  };
  const input = await inspectSelectedExcelRange(
    { run: (callback) => callback({ workbook, sync: async () => undefined }) },
    "book",
  );
  const summary = buildSchemaSummary(input);
  assert.equal(summary.columnCount, 5);
  assert.ok(touched.every((entry) => !/(^|\.)add\b|write|values=/.test(entry)));
  assert.equal(touched.includes("getSelectedRange"), true);
});

test("the AI summary of a sampled range reports the real number of rows", () => {
  const summary = buildSchemaSummary({
    workbookId: "w",
    worksheetName: "Big",
    address: "A1:B600000",
    values: [
      ["Item", "Qty"],
      ["a", 1],
      ["b", 2],
    ],
    hasHeaders: true,
    sample: { totalRows: 520125, sampledRows: 2 },
  } as any);
  assert.equal(summary.rowCount, 520124);
});
