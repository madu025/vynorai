import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advancedForecast,
  buildCohortRetention,
  buildSensitivityMatrix,
  classifySentiment,
  clusterNumeric,
  compareRootCauses,
  findAnomalies,
  findFuzzyMatches,
  financialMetrics,
  groupSimilarValues,
  keywordCounts,
  scoreFraudRisk,
  splitStructuredValue,
} from "./advancedAnalytics.js";

test("advanced forecast returns trend, seasonal indices and bounded confidence intervals", () => {
  const result = advancedForecast(
    [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32],
    2,
  );
  assert.equal(result.forecast.length, 2);
  assert.equal(result.seasonality.length, 12);
  assert.ok(result.lower[0] <= result.forecast[0]);
  assert.ok(result.upper[0] >= result.forecast[0]);
  assert.ok(result.slope > 0);
});

test("cohort retention groups customers by first active month", () => {
  const rows = [
    ["A", "2026-01-10"],
    ["A", "2026-02-10"],
    ["B", "2026-01-12"],
    ["B", "2026-03-12"],
  ];
  const result = buildCohortRetention(rows, 0, 1);
  assert.deepEqual(result, [
    { cohort: "2026-01", period: "2026-01", customers: 2, retention: 1 },
    { cohort: "2026-01", period: "2026-02", customers: 1, retention: 0.5 },
    { cohort: "2026-01", period: "2026-03", customers: 1, retention: 0.5 },
  ]);
});

test("sensitivity matrix is deterministic and skips non-finite results", () => {
  assert.deepEqual(
    buildSensitivityMatrix(
      [
        [1, 2],
        [10, 20],
      ],
      ([price, cost]) => price - cost,
    ),
    [
      { values: [1, 10], result: -9 },
      { values: [1, 20], result: -19 },
      { values: [2, 10], result: -8 },
      { values: [2, 20], result: -18 },
    ],
  );
});

test("financial metrics are explainable and safe for zero revenue", () => {
  assert.deepEqual(
    financialMetrics({
      revenue: 100,
      cogs: 40,
      operatingExpenses: 20,
      investedCapital: 50,
    }),
    {
      revenue: 100,
      cogs: 40,
      operatingExpenses: 20,
      netIncome: 40,
      grossProfit: 60,
      grossMargin: 0.6,
      operatingMargin: 0.4,
      roi: 0.8,
      ebitda: 40,
    },
  );
});

test("fuzzy matching reports candidates without changing source values", () => {
  const result = findFuzzyMatches(["John Doe", "Jon Doe", "Jane Doe"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].left, "John Doe");
  assert.equal(result[0].right, "Jon Doe");
});

test("anomaly, clustering and text analysis are deterministic", () => {
  assert.deepEqual(
    findAnomalies([1, 2, 2, 3, 100]).map((item) => item.index),
    [4],
  );
  const clusters = clusterNumeric(
    [
      [0, 0],
      [0, 1],
      [10, 10],
      [10, 11],
    ],
    2,
  );
  assert.equal(clusters.labels.length, 4);
  assert.equal(clusters.centroids.length, 2);
  assert.equal(classifySentiment("great and helpful"), "positive");
  assert.equal(classifySentiment("bad and broken"), "negative");
  assert.deepEqual(keywordCounts(["alpha beta alpha", "beta gamma"], 2), [
    { keyword: "alpha", count: 2 },
    { keyword: "beta", count: 2 },
  ]);
});

test("risk, root-cause and structured splitting remain explainable and non-destructive", () => {
  const risk = scoreFraudRisk({
    amount: 900,
    amountMedian: 100,
    amountQ3: 200,
    duplicateKey: true,
    velocityCount: 5,
    unusualHour: true,
  });
  assert.equal(risk.level, "high");
  assert.ok(risk.reasons.includes("duplicate_transaction_key"));
  assert.deepEqual(
    compareRootCauses([
      { category: "North", current: 80, previous: 100 },
      { category: "South", current: 95, previous: 100 },
    ])[0],
    {
      category: "North",
      current: 80,
      previous: 100,
      change: -20,
      contribution: 0.8,
    },
  );
  assert.deepEqual(splitStructuredValue("2026-02-03").parts, {
    year: "2026",
    month: "02",
    day: "03",
  });
  assert.deepEqual(groupSimilarValues(["John Doe", "Jon Doe", "Jane Doe"])[0], [
    "John Doe",
    "Jon Doe",
  ]);
});
