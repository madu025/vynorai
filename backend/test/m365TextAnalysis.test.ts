import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeTextBatch,
  TEXT_ANALYSIS_CONTRACT_VERSION,
} from "../src/services/m365TextAnalysis.js";
import { setM365AnalysisRunnerForTests } from "../src/services/m365Analysis.js";

const user = {
  id: "text-user",
  email: "owner@example.com",
  hasActiveSubscription: true,
  subscriptionPlan: "pro",
};

test("text analysis masks PII, batches inputs and validates a strict response", async () => {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  setM365AnalysisRunnerForTests(async (_user, messages) => {
    calls.push(messages);
    const batch = JSON.parse(messages[1].content) as Array<{ index: number }>;
    return JSON.stringify({
      results: batch.map(({ index }) => ({
        index,
        label: "positive",
        keywords: ["helpful"],
        confidence: 0.9,
        evidence: "positive wording",
      })),
    });
  });
  try {
    const result = await analyzeTextBatch(user, {
      feature: "sentiment",
      consent: true,
      texts: Array.from({ length: 26 }, (_, index) =>
        index === 0 ? "great help owner@example.com" : `great ${index}`,
      ),
    });
    assert.equal(result.contractVersion, TEXT_ANALYSIS_CONTRACT_VERSION);
    assert.equal(result.results.length, 26);
    assert.equal(result.batches, 2);
    assert.equal(result.maskedCount, 1);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(calls), /owner@example\.com/);
  } finally {
    setM365AnalysisRunnerForTests();
  }
});

test("text analysis rejects invalid labels instead of returning model guesses", async () => {
  setM365AnalysisRunnerForTests(async () =>
    JSON.stringify({
      results: [
        {
          index: 0,
          label: "maybe",
          keywords: [],
          confidence: 0.5,
          evidence: "x",
        },
      ],
    }),
  );
  try {
    await assert.rejects(
      analyzeTextBatch(user, {
        feature: "sentiment",
        consent: true,
        texts: ["unclear"],
      }),
      /AI_TEXT_ANALYSIS_INVALID/,
    );
  } finally {
    setM365AnalysisRunnerForTests();
  }
});
