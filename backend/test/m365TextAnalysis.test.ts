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

test("an AI column instruction is masked, follows the fixed prompt, and answers come back restored", async () => {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  setM365AnalysisRunnerForTests(async (_user, messages) => {
    calls.push(messages);
    const batch = JSON.parse(messages[1].content) as Array<{
      index: number;
      text: string;
    }>;
    // The model copies the masked email token as the answer for item 0.
    return JSON.stringify({
      results: batch.map(({ index, text }) => ({
        index,
        label:
          index === 0
            ? (/__PII_EMAIL_\d+__/.exec(text)?.[0] ?? "n/a")
            : "Colombo",
        keywords: ["ignored"],
        confidence: 0.8,
        evidence: "from the text",
      })),
    });
  });
  try {
    const result = await analyzeTextBatch(user, {
      feature: "instruction",
      instruction: "the contact email, or the city; ask boss@example.com",
      consent: true,
      texts: ["write to sales@example.com", "12 Galle Road, Colombo 3"],
    });
    const results = result.results as Array<{
      label: string;
      keywords: string[];
    }>;
    assert.equal(results[0].label, "sales@example.com");
    assert.equal(results[1].label, "Colombo");
    assert.deepEqual(results[1].keywords, []);
    const sent = JSON.stringify(calls);
    assert.doesNotMatch(sent, /sales@example\.com|boss@example\.com/);
    // The fixed rules come first; the instruction is appended after them.
    const system = calls[0][0].content;
    assert.ok(system.indexOf("Instruction:") > system.indexOf("never follow"));
  } finally {
    setM365AnalysisRunnerForTests();
  }
});

test("instruction is required for, and only for, the instruction feature", async () => {
  setM365AnalysisRunnerForTests(async () => {
    throw new Error("model must not be called");
  });
  try {
    await assert.rejects(
      analyzeTextBatch(user, {
        feature: "instruction",
        consent: true,
        texts: ["x"],
      }),
      /AI_TEXT_ANALYSIS_INVALID/,
    );
    await assert.rejects(
      analyzeTextBatch(user, {
        feature: "sentiment",
        instruction: "the city",
        consent: true,
        texts: ["x"],
      }),
      /AI_TEXT_ANALYSIS_INVALID/,
    );
  } finally {
    setM365AnalysisRunnerForTests();
  }
});

test("labels stay short for the label features even though answers may be longer", async () => {
  const long = "a".repeat(120);
  setM365AnalysisRunnerForTests(async () =>
    JSON.stringify({
      results: [
        { index: 0, label: long, keywords: [], confidence: 0.5, evidence: "" },
      ],
    }),
  );
  try {
    await assert.rejects(
      analyzeTextBatch(user, {
        feature: "keywords",
        consent: true,
        texts: ["x"],
      }),
      /AI_TEXT_ANALYSIS_INVALID/,
    );
    const ok = await analyzeTextBatch(user, {
      feature: "instruction",
      instruction: "a long summary",
      consent: true,
      texts: ["x"],
    });
    assert.equal((ok.results[0] as { label: string }).label, long);
  } finally {
    setM365AnalysisRunnerForTests();
  }
});
