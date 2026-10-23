import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPLORE_MAX_QUESTIONS,
  exploreFor,
  type ExploreColumn,
  type ExploreItem,
} from "./exploreView.js";
import { answerQuestion, interpretInstruction, looksLikeQuestion } from "./intent.js";
import { isPayrollRequest } from "./payroll.js";

const sales: ExploreColumn[] = [
  { name: "Order Date", role: "date" },
  { name: "Region", role: "category" },
  { name: "Product", role: "category" },
  { name: "Net Amount", role: "measure" },
  { name: "Qty", role: "measure" },
];
const staff: ExploreColumn[] = [
  { name: "Emp No", role: "identifier" },
  { name: "Name", role: "identifier" },
  { name: "Department", role: "category" },
  { name: "Basic", role: "measure" },
  { name: "Allowance", role: "measure" },
];
const VAT = 0.18;
const ids = (items: ExploreItem[]) => items.map((item) => item.id);

/** Rows shaped like the roles, so the real reader can be asked about each request sentence. */
function rowsFor(columns: ExploreColumn[]) {
  const words = ["Western", "Central", "Southern", "Northern"];
  return Array.from({ length: 12 }, (_, i) =>
    columns.map((column) =>
      column.role === "measure"
        ? 1000 + i * 137
        : column.role === "date"
          ? 46000 + i * 20
          : `${words[i % words.length]}${column.name === "Product" ? " item" : ""}`,
    ),
  );
}

test("a sales selection gets a summary, a VAT column, a month column and questions with its own headers", () => {
  const view = exploreFor(sales, { vatRate: VAT });
  assert.deepEqual(ids(view.templates), ["summary", "vat", "month"]);
  assert.equal(view.templates[0].title, "Summary by Region");
  assert.equal(view.templates[0].request, "Create a summary of Net Amount by Region");
  assert.equal(view.templates[1].detail, "18% VAT on Net Amount");
  assert.equal(view.templates[1].request, "Add a column VAT that is [Net Amount] * 0.18");
  assert.equal(view.templates[2].request, "Add a column Month that is month of Order Date");
  assert.deepEqual(view.questions.map((q) => q.request), [
    "Which Region has the highest Net Amount?",
    "Which Region has the lowest Net Amount?",
    "Which Product has the highest Net Amount?",
    "What is the total Net Amount?",
  ]);
  assert.equal(view.payroll, false);
});

test("a summary needs both a category and a measure, and questions need a measure", () => {
  const noMeasure = exploreFor([
    { name: "Region", role: "category" },
    { name: "Product", role: "category" },
  ], { vatRate: VAT });
  assert.deepEqual(noMeasure.templates, []);
  assert.deepEqual(noMeasure.questions, []);

  const noCategory = exploreFor([
    { name: "Order Date", role: "date" },
    { name: "Net Amount", role: "measure" },
  ], { vatRate: VAT });
  assert.deepEqual(ids(noCategory.templates), ["vat", "month"]);
  assert.deepEqual(ids(noCategory.questions), ["total"]);
});

test("nothing is offered without a schema", () => {
  for (const none of [undefined, []]) {
    const view = exploreFor(none, { vatRate: VAT });
    assert.deepEqual(view, { templates: [], questions: [], payroll: false });
  }
});

test("VAT is offered only on a money column, never on a quantity, a tax column or a total", () => {
  const qtyOnly = exploreFor([
    { name: "Region", role: "category" },
    { name: "Qty", role: "measure" },
  ], { vatRate: VAT });
  assert.equal(ids(qtyOnly.templates).includes("vat"), false);
  const grossOnly = exploreFor([
    { name: "Region", role: "category" },
    { name: "Gross Amount", role: "measure" },
    { name: "Total", role: "measure" },
  ], { vatRate: VAT });
  assert.equal(ids(grossOnly.templates).includes("vat"), false);
  // The next money column is used when the first one already holds tax.
  const second = exploreFor([
    { name: "Gross Amount", role: "measure" },
    { name: "Net Amount", role: "measure" },
  ], { vatRate: VAT });
  assert.match(second.templates.find((t) => t.id === "vat")!.request, /\[Net Amount\]/);
  // No rate known, or a VAT column already there: no template.
  assert.equal(ids(exploreFor(sales).templates).includes("vat"), false);
  assert.equal(
    ids(exploreFor([...sales, { name: "VAT", role: "measure" }], { vatRate: VAT }).templates).includes("vat"),
    false,
  );
});

test("a month column is not offered for a year or month label, or when Month already exists", () => {
  const year = exploreFor([
    { name: "Year", role: "date" },
    { name: "Region", role: "category" },
    { name: "Sales", role: "measure" },
  ]);
  assert.equal(ids(year.templates).includes("month"), false);
  const has = exploreFor([...sales, { name: "Month", role: "category" }]);
  assert.equal(ids(has.templates).includes("month"), false);
});

test("an employee list gets the payroll sheet and no VAT column", () => {
  const view = exploreFor(staff, { vatRate: VAT });
  assert.equal(view.payroll, true);
  assert.deepEqual(ids(view.templates), ["summary", "payroll"]);
  assert.ok(isPayrollRequest(view.templates[1].request));
  assert.equal(exploreFor(sales, { vatRate: VAT }).payroll, false);
});

test("a header with brackets or a line break is never put in a request", () => {
  const view = exploreFor([
    { name: "Region", role: "category" },
    { name: "Amount [Rs]", role: "measure" },
    { name: "Net\nAmount", role: "measure" },
  ], { vatRate: VAT });
  for (const item of [...view.templates, ...view.questions])
    assert.doesNotMatch(item.request, /[[\]\n]/);
  assert.deepEqual(exploreFor([{ name: "Amount [Rs]", role: "measure" }], { vatRate: VAT }), {
    templates: [],
    questions: [],
    payroll: false,
  });
});

test("there are never more than four questions", () => {
  assert.ok(exploreFor(sales, { vatRate: VAT }).questions.length <= EXPLORE_MAX_QUESTIONS);
});

test("every offered request is one the built-in reader understands, on the selection's own headers", () => {
  for (const columns of [sales, staff]) {
    const headers = columns.map((column) => column.name);
    const rows = rowsFor(columns);
    const view = exploreFor(columns, { vatRate: VAT });
    assert.ok(view.templates.length > 0);
    for (const template of view.templates) {
      if (template.id === "payroll") {
        assert.ok(isPayrollRequest(template.request), template.request);
        continue;
      }
      const read = interpretInstruction(template.request, headers, rows);
      const expected = template.id === "summary" ? "summary" : "add-column";
      assert.ok(read.actions.includes(expected as never), `${template.request} -> ${read.actions}`);
      assert.deepEqual(read.problems, [], template.request);
    }
    for (const question of view.questions) {
      assert.ok(looksLikeQuestion(question.request), question.request);
      const answer = answerQuestion(question.request, headers, rows);
      assert.ok(answer, question.request);
    }
  }
});

test("the summary request reads the offered group and measure columns", () => {
  const view = exploreFor(sales, { vatRate: VAT });
  const headers = sales.map((column) => column.name);
  const read = interpretInstruction(view.templates[0].request, headers, rowsFor(sales));
  assert.equal(read.specs.summary?.group, headers.indexOf("Region"));
  assert.equal(read.specs.summary?.values[0].column, headers.indexOf("Net Amount"));
});

test("a question names the group that really leads, so the tap leads to a true answer", () => {
  const headers = ["Region", "Net Amount"];
  const rows = [
    ["Western", 100],
    ["Central", 900],
    ["Western", 200],
  ];
  const question = exploreFor(
    [{ name: "Region", role: "category" }, { name: "Net Amount", role: "measure" }],
  ).questions[0];
  assert.match(answerQuestion(question.request, headers, rows)!.answer, /^Central has the highest Net Amount: 900/);
});
