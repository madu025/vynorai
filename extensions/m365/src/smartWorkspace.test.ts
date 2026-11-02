import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseSmartPath } from "./smartWorkspace.js";

// Requests the local reader turned into a wrong or partial plan in a live Excel run (2026-11-02).
const NEEDS_AGENT = [
  // a new column, then an action on that new column: the local plan wrote a formatted copy only
  "Add a column with profit margin and highlight rows under 10%",
  "Create a margin column and colour the rows below 5%",
  "add a profit margin column",
  // a filtered list plus a sort: the local answer gave the average only
  "Which products are above average sales? Sort them",
  "Which regions have sales below the average?",
  "List the customers with more than average Qty and rank them",
  // free-text extraction from an address: the local reader had no plan at all
  "Take the city from the Address column into a new column",
  "Extract the domain from the Email column",
];

const STAYS_LOCAL = [
  "Make a bar chart of total sales by region",
  "What is the total Sales?",
  "Highlight duplicates in Customer ID",
  "Add a column Profit that is [Sales] - [Cost]",
  "Show each row Qty as a percentage of the total Qty",
  "Freeze the header and add data bars on Sales",
  "Sort by Sales descending",
];

test("smart sends chained, filtered-list and extraction requests to the agent", () => {
  for (const request of NEEDS_AGENT)
    assert.equal(chooseSmartPath(request, "smart", true), "agent", request);
});

test("smart keeps ordinary single-step work local", () => {
  for (const request of STAYS_LOCAL)
    assert.equal(chooseSmartPath(request, "smart", true), "local", request);
});

test("explicit modes and a missing agent always win", () => {
  for (const request of NEEDS_AGENT) {
    assert.equal(chooseSmartPath(request, "local", true), "local");
    assert.equal(chooseSmartPath(request, "smart", false), "local");
  }
  assert.equal(
    chooseSmartPath("What is the total Sales?", "agent", true),
    "agent",
  );
});

test("a change to something already built goes to the agent, a new build stays local", () => {
  for (const request of [
    "On this dashboard sheet, change the title to Regional Sales Overview",
    "Change the Total of Sales by Region doughnut chart into a bar chart",
    "make the existing chart colours blue",
    "rename the dashboard title",
  ])
    assert.equal(chooseSmartPath(request, "smart", true), "agent", request);
  for (const request of [
    "Create a management dashboard of Sales by Region",
    "make a bar chart of sales by region",
    "create a pivot table of sales by region",
  ])
    assert.equal(chooseSmartPath(request, "smart", true), "local", request);
});

test("work on a new sheet or a named Excel function goes to the agent", () => {
  for (const request of [
    "Create a new sheet Region Summary with a GROUPBY of Orders Sales by Region, and a bar chart of it.",
    "Put a summary on another sheet",
    "Add a sheet called Totals with sales by month",
  ])
    assert.equal(chooseSmartPath(request, "smart", true), "agent", request);
  assert.equal(
    chooseSmartPath(
      "Create a management dashboard of Sales by Region",
      "smart",
      true,
    ),
    "local",
  );
});
