/**
 * Trains the request-tier classifier on ml/tier-dataset.jsonl and writes
 * src/services/tierModel.generated.ts.
 *
 *   npx tsx src/scripts/trainTierClassifier.ts
 *
 * Split 70 / 15 / 15: train, validation (picks the H threshold), test (the
 * numbers reported). Also scores the current rule-based router on the same
 * test set, so a model is only shipped when it is measurably better.
 */
import fs from "fs";
import path from "path";

import {
  TIER_CLASSES,
  TierLetter,
  TierModel,
  decideTier,
  tierFeatures,
  tierProbabilities,
} from "../services/tierClassifier.js";

const DIM = 1 << 14;
const EPOCHS = 40;
const L2 = 1e-5;
const DATA = path.resolve("ml/tier-dataset.jsonl"); // run from backend/
const OUT = path.resolve("src/services/tierModel.generated.ts");
// Hand-labeled by Claude: gap-filling training examples, and an independent
// test set written apart from the DeepSeek-generated data.
const ML_DIR = path.resolve("ml");
const claudeFiles = (test: boolean) =>
  fs
    .readdirSync(ML_DIR)
    .filter(
      (f) => /^tier-claude.*\.jsonl$/.test(f) && f.includes("test") === test,
    )
    .map((f) => path.join(ML_DIR, f));

type Example = { text: string; label: TierLetter };

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function train(examples: Example[]): { bias: number[]; w: Float32Array } {
  const k = TIER_CLASSES.length;
  const w = new Float32Array(DIM * k);
  const bias = [0, 0, 0];
  const counts = TIER_CLASSES.map(
    (c) => examples.filter((e) => e.label === c).length,
  );
  // Balanced classes: H is rare but the decision that matters most.
  const classWeight = counts.map((n) => examples.length / (k * Math.max(1, n)));
  const feats = examples.map((e) => tierFeatures(e.text, DIM));
  const rand = rng(7);
  const order = examples.map((_, i) => i);

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const lr = 0.5 / (1 + epoch * 0.15);
    for (const i of shuffle(order, rand)) {
      const y = TIER_CLASSES.indexOf(examples[i].label);
      const logits = [...bias];
      for (const idx of feats[i])
        for (let c = 0; c < k; c++) logits[c] += w[idx * k + c];
      const max = Math.max(...logits);
      const exps = logits.map((z) => Math.exp(z - max));
      const sum = exps.reduce((a, b) => a + b, 0);
      for (let c = 0; c < k; c++) {
        const grad = (exps[c] / sum - (c === y ? 1 : 0)) * classWeight[y];
        bias[c] -= lr * grad * 0.1;
        for (const idx of feats[i]) {
          const j = idx * k + c;
          w[j] -= lr * (grad + L2 * w[j]);
        }
      }
    }
  }
  return { bias, w };
}

function evaluate(pred: TierLetter[], gold: TierLetter[]) {
  const confusion: Record<string, Record<string, number>> = {};
  for (const g of TIER_CLASSES) confusion[g] = { L: 0, N: 0, H: 0 };
  pred.forEach((p, i) => confusion[gold[i]][p]++);
  const per: Record<string, { precision: number; recall: number; f1: number }> =
    {};
  for (const c of TIER_CLASSES) {
    const tp = confusion[c][c];
    const predicted = TIER_CLASSES.reduce((s, g) => s + confusion[g][c], 0);
    const actual = TIER_CLASSES.reduce((s, p) => s + confusion[c][p], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = actual ? tp / actual : 0;
    per[c] = {
      precision,
      recall,
      f1:
        precision + recall
          ? (2 * precision * recall) / (precision + recall)
          : 0,
    };
  }
  const accuracy = pred.filter((p, i) => p === gold[i]).length / gold.length;
  const macroF1 =
    TIER_CLASSES.reduce((s, c) => s + per[c].f1, 0) / TIER_CLASSES.length;
  // Wrongly thinking costs credits; wrongly not thinking costs quality.
  const falseH =
    pred.filter((p, i) => p === "H" && gold[i] !== "H").length / gold.length;
  const missedH =
    pred.filter((p, i) => p !== "H" && gold[i] === "H").length / gold.length;
  return { accuracy, macroF1, falseH, missedH, per, confusion };
}

function readJsonl(file: string): Example[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function main() {
  const all = readJsonl(DATA);
  const extra = claudeFiles(false).flatMap(readJsonl);
  const external = claudeFiles(true).flatMap(readJsonl);
  const data = shuffle(all, rng(42));
  const nTrain = Math.floor(data.length * 0.7);
  const nVal = Math.floor(data.length * 0.15);
  // Hand-labeled examples count twice: few, but they cover the gaps.
  const trainSet = [...data.slice(0, nTrain), ...extra, ...extra];
  const valSet = data.slice(nTrain, nTrain + nVal);
  const testSet = data.slice(nTrain + nVal);

  const { bias, w } = train(trainSet);
  const model: TierModel = {
    dim: DIM,
    bias,
    weightsB64: Buffer.from(w.buffer).toString("base64"),
    hThreshold: 0.5,
    trainedAt: new Date().toISOString(),
  };

  // Pick the H threshold on validation: best macro-F1 with H precision >= 0.7.
  const valProbs = valSet.map((e) => tierProbabilities(e.text, model, w));
  const valGold = valSet.map((e) => e.label);
  let best = { t: 0.5, f1: -1 };
  for (let t = 0.3; t <= 0.9001; t += 0.05) {
    const m = evaluate(
      valProbs.map((p) => decideTier(p, t)),
      valGold,
    );
    if (m.per.H.precision >= 0.7 && m.macroF1 > best.f1)
      best = { t, f1: m.macroF1 };
  }
  model.hThreshold = Math.round(best.t * 100) / 100;

  const testGold = testSet.map((e) => e.label);
  const ours = evaluate(
    testSet.map((e) =>
      decideTier(tierProbabilities(e.text, model, w), model.hThreshold),
    ),
    testGold,
  );

  // The rule router alone (not the bundled classifier) on the same test set.
  process.env.ROUTER_MODE = "rules";
  process.env.LOCAL_SLM_ENABLED = "false";
  const { analyzeIntentWithLocalSlm } = await import(
    "../services/localSlmRouter.js"
  );
  const rulesPred: TierLetter[] = [];
  for (const e of testSet) {
    const d = await analyzeIntentWithLocalSlm(e.text);
    rulesPred.push(
      d.complexity === "HARD" ? "H" : d.complexity === "MEDIUM" ? "N" : "L",
    );
  }
  const rules = evaluate(rulesPred, testGold);

  // Independent set: the new model, the bundled (previous) model, and rules.
  const extGold = external.map((e) => e.label);
  const extOurs = evaluate(
    external.map((e) =>
      decideTier(tierProbabilities(e.text, model, w), model.hThreshold),
    ),
    extGold,
  );
  const { TIER_MODEL: previous } = await import(
    "../services/tierModel.generated.js"
  );
  const extPrev = previous.weightsB64
    ? evaluate(
        external.map((e) => {
          const pw = new Float32Array(
            Uint8Array.from(Buffer.from(previous.weightsB64, "base64")).buffer,
          );
          return decideTier(
            tierProbabilities(e.text, previous, pw),
            previous.hThreshold,
          );
        }),
        extGold,
      )
    : null;
  const extRulesPred: TierLetter[] = [];
  for (const e of external) {
    const d = await analyzeIntentWithLocalSlm(e.text);
    extRulesPred.push(
      d.complexity === "HARD" ? "H" : d.complexity === "MEDIUM" ? "N" : "L",
    );
  }
  const extRules = evaluate(extRulesPred, extGold);

  const fmt = (m: ReturnType<typeof evaluate>) =>
    `acc ${(m.accuracy * 100).toFixed(1)}% | macroF1 ${(m.macroF1 * 100).toFixed(1)} | H P/R ${(m.per.H.precision * 100).toFixed(0)}/${(m.per.H.recall * 100).toFixed(0)} | false-H ${(m.falseH * 100).toFixed(1)}% | missed-H ${(m.missedH * 100).toFixed(1)}%`;
  console.log(
    `examples ${all.length} (train ${trainSet.length} / val ${valSet.length} / test ${testSet.length}), H threshold ${model.hThreshold}`,
  );
  console.log(`classifier: ${fmt(ours)}`);
  console.log(`rules     : ${fmt(rules)}`);
  console.log(
    "classifier confusion (rows = truth):",
    JSON.stringify(ours.confusion),
  );
  console.log(
    "rules confusion      (rows = truth):",
    JSON.stringify(rules.confusion),
  );
  if (external.length) {
    console.log(
      `-- independent Claude-labeled test set (${external.length}) --`,
    );
    console.log(`new model : ${fmt(extOurs)}`);
    if (extPrev) console.log(`previous  : ${fmt(extPrev)}`);
    console.log(`rules     : ${fmt(extRules)}`);
    console.log("new model confusion:", JSON.stringify(extOurs.confusion));
  }

  model.metrics = {
    examples: all.length,
    test: {
      accuracy: ours.accuracy,
      macroF1: ours.macroF1,
      falseH: ours.falseH,
      missedH: ours.missedH,
    },
    rulesBaseline: { accuracy: rules.accuracy, macroF1: rules.macroF1 },
    independentTest: external.length
      ? {
          examples: external.length,
          accuracy: extOurs.accuracy,
          macroF1: extOurs.macroF1,
        }
      : undefined,
  };
  fs.writeFileSync(
    OUT,
    `// Generated by scripts/trainTierClassifier.ts — do not edit by hand.\n` +
      `import type { TierModel } from "./tierClassifier.js";\n\n` +
      `export const TIER_MODEL: TierModel = ${JSON.stringify(model)};\n`,
  );
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
