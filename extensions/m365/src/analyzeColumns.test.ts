import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentToolError } from "./agent.js";
import { runColumnAnalysis } from "./analyzeColumns.js";

const headers = ["Txn ID", "Customer", "Region", "Amount", "Last Year", "Date"];
const rows = [
  ["T1", "Nimal Stores", "West", 100, 90, 45292],
  ["T2", "Nimal Store", "West", 110, 95, 45292],
  ["T3", "Kamal Traders", "South", 105, 120, 45323],
  ["T4", "Kamal Traders", "South", 95, 80, 45323],
  ["T5", "Saman Hardware", "North", 5000, 100, 45352],
  ["T5", "Nimal Stores", "West", 98, 100, 45352],
];

test("anomalies name the sheet row of each outlier", () => {
  const result = runColumnAnalysis("anomalies", headers, rows, {
    columns: ["amount"],
    firstRow: 2,
  });
  assert.equal(result.outliers, 1);
  assert.deepEqual((result.top as any[])[0], {
    row: 6,
    value: 5000,
    side: "high",
    iqrsBeyond: (result.top as any[])[0].iqrsBeyond,
  });
});

test("fuzzy matches pair spellings of the same name and warn against merging", () => {
  const result = runColumnAnalysis("fuzzy_matches", headers, rows, {
    columns: ["Customer"],
    firstRow: 2,
  });
  assert.equal(result.distinctValues, 4);
  assert.deepEqual(
    (result.top as any[]).map((pair) => [pair.left, pair.right]),
    [["Nimal Stores", "Nimal Store"]],
  );
  assert.match(String(result.caution), /never merge/);
});

test("root cause adds up by category and ranks the biggest change first", () => {
  const result = runColumnAnalysis("root_cause", headers, rows, {
    columns: ["Region", "Amount", "Last Year"],
    firstRow: 2,
  });
  const top = result.top as any[];
  assert.equal(top[0].category, "North");
  assert.equal(top[0].change, 4900);
  assert.equal(result.categories, 3);
});

test("fraud screen scores rows and flags a repeated transaction key", () => {
  const result = runColumnAnalysis("fraud_screen", headers, rows, {
    columns: ["Amount", "Txn ID"],
    firstRow: 2,
  });
  const top = result.top as any[];
  assert.equal(top[0].row, 6);
  assert.ok(top[0].reasons.includes("duplicate_transaction_key"));
  assert.ok(top[0].reasons.includes("amount_over_three_times_median"));
  assert.match(String(result.caution), /not a finding of fraud/);
});

test("cohorts read Excel date serial numbers", () => {
  const result = runColumnAnalysis("cohort_retention", headers, rows, {
    columns: ["Customer", "Date"],
    firstRow: 2,
  });
  assert.ok((result.cohorts as number) >= 2);
  assert.match(String((result.rows as any[])[0].cohort), /^2024-0\d$/);
});

test("clusters report sizes and centres by header, not row data", () => {
  const result = runColumnAnalysis("clusters", headers, rows, {
    columns: ["Amount", "Last Year"],
    firstRow: 2,
    k: 2,
  });
  const clusters = result.clusters as any[];
  assert.equal(clusters.length, 2);
  assert.equal(
    clusters.reduce((sum, cluster) => sum + cluster.rows, 0),
    rows.length,
  );
  assert.ok("Amount" in clusters[0].centre);
});

test("wrong columns come back as messages the model can act on", () => {
  assert.throws(
    () =>
      runColumnAnalysis("anomalies", headers, rows, {
        columns: ["Sales"],
        firstRow: 2,
      }),
    (error: Error) =>
      error instanceof AgentToolError && /Headers: Txn ID, Customer/.test(error.message),
  );
  assert.throws(
    () =>
      runColumnAnalysis("root_cause", headers, rows, {
        columns: ["Region"],
        firstRow: 2,
      }),
    /root_cause needs a category column, then the current and previous amount columns/,
  );
});
