import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanChipText, nextSteps } from "./followUps.js";
import type { WorkspaceSchema } from "./smartWorkspace.js";

const schema: WorkspaceSchema = {
  hasMeasure: true,
  hasDate: true,
  hasCategory: true,
  hasText: true,
  sampleRows: 20,
  columns: [
    { name: "Net Amount", role: "measure" },
    { name: "Channel", role: "category" },
    { name: "Order ID", role: "identifier" },
    { name: "Order Date", role: "date" },
  ],
  blankColumns: ["Channel"],
};

test("the answer's own question comes first and the list is at most three", () => {
  const steps = nextSteps({ questions: ["- Want a bar chart?"], schema });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].text, "Want a bar chart?");
});

test("what was just asked and Inspect formulas are never offered", () => {
  const steps = nextSteps({ schema, asked: "Total Net Amount by Channel" });
  assert.ok(steps.every((s) => !/total net amount by channel/i.test(s.text)));
  assert.ok(steps.every((s) => !/inspect formulas/i.test(s.text)));
  assert.ok(steps.length > 0);
});

test("without a schema only the answer's questions remain", () => {
  assert.deepEqual(
    nextSteps({ questions: ["Split by month?"] }).map((s) => s.text),
    ["Split by month?"],
  );
  assert.deepEqual(nextSteps({}), []);
});

test("a leading bullet or dash is stripped from chip text", () => {
  assert.equal(cleanChipText("- Want me to run it?"), "Want me to run it?");
  assert.equal(cleanChipText("• Next?"), "Next?");
  assert.equal(cleanChipText("Fine?"), "Fine?");
});

import { shortQuestion } from "./followUps.js";

test("a follow-up question becomes a short chip", () => {
  assert.equal(
    shortQuestion(
      "Total: 3,000 orders, perfectly even across channels — want this as a summary sheet or chart?",
    ),
    "Want a summary sheet or chart?",
  );
  assert.equal(
    shortQuestion(
      "- Want me to run the same check across the other sheets (OrderLines, Customers, Products)?",
    ),
    "Want me to run the same check?",
  );
  assert.ok(shortQuestion("x ".repeat(30) + "?").split(" ").length <= 9);
});

test("the answer's own question is the first chip with the full sentence kept", () => {
  const steps = nextSteps({
    questions: ["Total is 3,000 — want this as a summary sheet or chart?"],
    schema: undefined,
  });
  assert.equal(steps[0].label, "Want a summary sheet or chart?");
  assert.match(steps[0].full ?? "", /Total is 3,000/);
});

test("an offer question becomes a clean chip and the request it fills is the person's own words", () => {
  // Live run 2026-11-02: the chip read "Should I write these two to a sorted sheet,?" and filled the
  // request box with the assistant's own question.
  const [step] = nextSteps({
    questions: [
      "Should I write these two to a sorted sheet, or sort the main data by sales instead?",
    ],
  });
  assert.equal(step.label, "Should I write these two to a sorted sheet?");
  assert.equal(step.text, "Write these two to a sorted sheet");
  const [want] = nextSteps({
    questions: ["Do you want me to add a chart of Sales by Region?"],
  });
  assert.equal(want.text, "Add a chart of Sales by Region");
  const [open] = nextSteps({ questions: ["Which region grew fastest?"] });
  assert.equal(open.text, "Which region grew fastest?");
  for (const question of [
    "Want this as a pivot, a chart, a summary table, or a dashboard with filters on Region?",
    "Should I add totals; or format the numbers as currency, with two decimals?",
  ])
    assert.doesNotMatch(
      nextSteps({ questions: [question] })[0].label,
      /[,;:]\?$/,
    );
});
