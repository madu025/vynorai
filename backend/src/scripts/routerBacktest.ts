/**
 * Backtest the Auto router on hand-labelled prompts (no user data):
 * the bundled classifier vs the rules router it replaced.
 *
 *   npx tsx src/scripts/routerBacktest.ts
 *
 * missedHard: a prompt that needs deep reasoning sent to a cheap tier (quality risk)
 * falseHard:  an easy prompt sent to a reasoning tier (wasted credits)
 */
import fs from "fs";

import { refineTier, tierFromComplexity } from "../services/autoRouter.js";
import { analyzeIntentWithLocalSlm } from "../services/localSlmRouter.js";

type Letter = "L" | "N" | "H";
const FILES = ["ml/tier-claude-test.jsonl", "ml/tier-claude-test2.jsonl"];
// Relative credit cost of a tier for the same prompt (Flash = 1, Pro = 5).
const COST: Record<string, number> = {
  light: 1,
  normal: 1,
  heavy: 1.6,
  deep: 5,
};

const toLetter = (tier: string): Letter =>
  tier === "light" ? "L" : tier === "normal" ? "N" : "H";

async function run(
  mode: "classifier" | "rules",
  items: { text: string; label: Letter }[],
) {
  process.env.ROUTER_MODE = mode;
  let correct = 0,
    missedHard = 0,
    falseHard = 0,
    cost = 0,
    idealCost = 0;
  const ideal = { L: "light", N: "normal", H: "heavy" } as const;
  for (const { text, label } of items) {
    const d = await analyzeIntentWithLocalSlm(text);
    const tier = refineTier(tierFromComplexity(d.complexity), text);
    const got = toLetter(tier);
    if (got === label) correct++;
    if (label === "H" && got !== "H") missedHard++;
    if (label !== "H" && got === "H") falseHard++;
    cost += COST[tier];
    idealCost += COST[ideal[label]];
  }
  return { correct, missedHard, falseHard, cost, idealCost };
}

async function main() {
  const items = FILES.flatMap((f) =>
    fs
      .readFileSync(f, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l)),
  );
  const hard = items.filter((i) => i.label === "H").length;
  console.log(`Prompts: ${items.length} (hard ${hard})\n`);
  for (const mode of ["classifier", "rules"] as const) {
    const r = await run(mode, items);
    console.log(
      `${mode.padEnd(10)} accuracy ${((r.correct / items.length) * 100).toFixed(1)}%` +
        ` | missed hard ${r.missedHard}/${hard}` +
        ` | easy sent to reasoning ${r.falseHard}/${items.length - hard}` +
        ` | cost ${(r.cost / r.idealCost).toFixed(2)}x ideal`,
    );
  }
}

void main();
