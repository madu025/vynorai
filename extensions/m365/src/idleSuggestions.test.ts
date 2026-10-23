import assert from "node:assert/strict";
import { test } from "node:test";
import { idleSuggestions } from "./idleSuggestions.js";

const schema = {
  hasMeasure: true,
  hasDate: true,
  hasCategory: true,
  hasText: false,
  sampleRows: 25,
  columns: [
    { name: "Order ID", role: "identifier" },
    { name: "Channel", role: "category" },
    { name: "Net Amount", role: "measure" },
    { name: "Order Date", role: "date" },
  ],
  blankColumns: ["Channel"],
};

test("suggestions name the real columns and the generic one is last", () => {
  const list = idleSuggestions(schema);
  assert.ok(list.length >= 3 && list.length <= 4);
  assert.equal(list[0].title, "Total Net Amount by Channel");
  assert.equal(list[0].text, "total Net Amount by Channel");
  assert.ok(list.some((s) => s.title === "Find duplicate Order ID"));
  assert.ok(list.some((s) => s.title === "Fill blank cells in Channel"));
});

test("no columns, no suggestion cards", () => {
  assert.deepEqual(idleSuggestions(undefined), []);
  assert.deepEqual(idleSuggestions({ ...schema, columns: [] }), []);
});

test("a table with only text still gets data quality and formulas cards", () => {
  const list = idleSuggestions({
    ...schema,
    columns: [{ name: "Notes", role: "text" }],
    blankColumns: [],
  });
  assert.equal(list[0].title, "Check data quality");
  assert.equal(list[list.length - 1].title, "Inspect formulas");
});
