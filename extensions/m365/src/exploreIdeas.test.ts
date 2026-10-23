import assert from "node:assert/strict";
import test from "node:test";
import {
  columnStats,
  ideasRequest,
  parseIdeas,
  rankCategories,
  rankMeasures,
} from "./exploreIdeas.js";
import { exploreFor } from "./exploreView.js";

const rows = Array.from({ length: 40 }, (_, i) => [
  `INV-${i}`,
  ["East", "West", "North"][i % 3],
  10.5,
  3,
  10.5 * 3,
]);
const headers = ["Invoice", "Region", "Unit Price", "Qty", "Net Amount"];

test("counts per column come from the sample", () => {
  const stats = columnStats(headers, rows);
  assert.equal(stats["Region"].distinct, 3);
  assert.equal(stats["Invoice"].distinct, 40);
  assert.equal(stats["Net Amount"].fractional, 40);
  assert.equal(stats["Qty"].fractional, 0);
});

test("a total column beats a per-unit price, and an identifier is not a group", () => {
  const stats = columnStats(headers, rows);
  assert.equal(rankMeasures(["Unit Price", "Qty", "Net Amount"], stats)[0], "Net Amount");
  assert.equal(rankMeasures(["Unit Price", "Net Amount"])[0], "Net Amount");
  assert.deepEqual(rankCategories(["Invoice", "Region"], stats), ["Region"]);
});

test("Explore uses the ranking for its templates and questions", () => {
  const stats = columnStats(headers, rows);
  const view = exploreFor(
    [
      { name: "Invoice", role: "category" },
      { name: "Region", role: "category" },
      { name: "Unit Price", role: "measure" },
      { name: "Qty", role: "measure" },
      { name: "Net Amount", role: "measure" },
    ],
    { stats },
  );
  assert.equal(view.templates[0].request, "Create a summary of Net Amount by Region");
});

test("the ideas request holds names, roles and counts, never a cell value", () => {
  const text = ideasRequest(
    [
      { name: "Region", role: "category" },
      { name: "Net Amount", role: "measure" },
    ],
    columnStats(headers, rows),
  );
  assert.match(text, /Region \[category\] \(3 different values/);
  assert.doesNotMatch(text, /INV-1|East/);
});

test("the agent's reply becomes at most four plain request sentences", () => {
  const ideas = parseIdeas(
    [
      "Here you go:",
      "- Create a summary of Net Amount by Region",
      "- **Which Region has the lowest Net Amount?**",
      "- =HYPERLINK(\"http://x\")",
      "- see https://example.com now please",
      "- ok",
      "- Create a summary of net amount by region",
      "1. Add a column Month that is month of Date",
      "- Chart Net Amount by Region as columns",
      "- One more idea that is long enough",
    ].join("\n"),
  );
  assert.deepEqual(ideas, [
    "Create a summary of Net Amount by Region",
    "Which Region has the lowest Net Amount?",
    "Add a column Month that is month of Date",
    "Chart Net Amount by Region as columns",
  ]);
});
