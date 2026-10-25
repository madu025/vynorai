import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSemanticModel } from "./semanticModel.js";

test("builds a bounded semantic model with real roles and relationship evidence", () => {
  const model = buildSemanticModel([
    {
      label: "Orders!A1:D4",
      headers: ["Order ID", "Customer ID", "Date", "Amount"],
      rows: [
        ["O1", "C1", "2025-01-01", 10],
        ["O2", "C1", "2025-01-02", 12],
        ["O3", "C2", "2025-01-03", 8],
      ],
    },
    {
      label: "Customers!A1:B3",
      headers: ["Customer ID", "Region"],
      rows: [
        ["C1", "North"],
        ["C2", "South"],
      ],
    },
  ]);
  const orders = model.tables.find((table) => table.label.startsWith("Orders"));
  assert.ok(orders);
  assert.equal(
    orders.columns.find((column) => column.name === "Amount")?.role,
    "measure",
  );
  assert.equal(
    orders.columns.find((column) => column.name === "Date")?.role,
    "date",
  );
  assert.equal(
    orders.columns.find((column) => column.name === "Customer ID")?.role,
    "key",
  );
  assert.equal(
    orders.columns
      .find((column) => column.name === "Amount")
      ?.measures?.includes("sum"),
    true,
  );
  assert.equal(model.relationships.length, 1);
  assert.equal(model.relationships[0].cardinality, "many-to-one");
  assert.equal(model.relationships[0].fromRowsWithoutPartner, 0);
  assert.equal(model.nativeFeature, "power-pivot-data-model-olap");
  assert.equal(model.implementation, "deterministic-local-metadata");
  assert.match(model.limitations[0], /not a native/i);
  assert.doesNotMatch(JSON.stringify(model), /"O1"|"C1"|"North"/);
});

test("reports bounded sampling and refuses to guess when there is no relationship", () => {
  const model = buildSemanticModel([
    {
      label: "A!A1:B21001",
      headers: ["Value", "Group"],
      rows: Array.from({ length: 20_001 }, (_, index) => [index, `G${index}`]),
    },
    {
      label: "B!A1:B3",
      headers: ["Name", "Text"],
      rows: [
        ["x", "one"],
        ["y", "two"],
      ],
    },
  ]);
  assert.equal(model.tables[0].rows, 20_000);
  assert.match(model.warnings.join(" "), /bounded to 20,000 rows/i);
  assert.equal(model.relationships.length, 0);
  assert.match(model.warnings.join(" "), /No relationship was inferred/i);
});
