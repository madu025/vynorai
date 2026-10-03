/**
 * Request-tier classifier (L / N / H) that runs inside the backend process.
 *
 * Multinomial logistic regression over hashed word and bigram features,
 * distilled from DeepSeek labels on synthetic prompts (see
 * scripts/buildTierDataset.ts and scripts/trainTierClassifier.ts). It answers
 * in well under a millisecond with no model server, so routing keeps working
 * at any load. Mutation authority never comes from here.
 */
import { TIER_MODEL } from "./tierModel.generated.js";

export type TierLetter = "L" | "N" | "H";
export const TIER_CLASSES: TierLetter[] = ["L", "N", "H"];

export interface TierModel {
  dim: number;
  bias: number[];
  /** Float32 weights, row-major [feature][class], base64. */
  weightsB64: string;
  /** Minimum P(H) to pick H; below it the turn stays L or N (thinking is costly). */
  hThreshold: number;
  trainedAt: string;
  metrics?: Record<string, unknown>;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function bucket(value: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && value >= edges[i]) i++;
  return i;
}

/** Hashed feature indices for a message. Shared by training and inference. */
export function tierFeatures(text: string, dim: number): number[] {
  const raw = text.slice(0, 4000);
  const lower = raw.toLowerCase();
  const words = lower.match(/[a-z0-9_]+/g) ?? [];
  const feats: string[] = [];
  for (let i = 0; i < words.length; i++) {
    feats.push(`w:${words[i]}`);
    if (i > 0) feats.push(`b:${words[i - 1]}_${words[i]}`);
  }
  feats.push(`len:${bucket(raw.length, [15, 40, 90, 180, 400, 900])}`);
  feats.push(`words:${bucket(words.length, [3, 8, 20, 50, 120])}`);
  const files =
    raw.match(
      /[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|kt|php|sql|css|json|ya?ml)\b/gi,
    ) ?? [];
  feats.push(`files:${bucket(new Set(files).size, [1, 2, 4])}`);
  if (raw.includes("```") || /[{};]\s*$/m.test(raw)) feats.push("code");
  if (raw.trim().endsWith("?")) feats.push("question");
  feats.push("bias_feature");
  return feats.map((f) => fnv1a(f) % dim);
}

let weights: Float32Array | null = null;

function loadWeights(model: TierModel): Float32Array {
  if (!weights) {
    // Copy into a fresh buffer: a pooled Buffer's offset need not be 4-aligned.
    const bytes = Uint8Array.from(Buffer.from(model.weightsB64, "base64"));
    weights = new Float32Array(bytes.buffer);
  }
  return weights;
}

export function tierProbabilities(
  text: string,
  model: TierModel = TIER_MODEL,
  w: Float32Array = loadWeights(model),
): number[] {
  const k = TIER_CLASSES.length;
  const logits = [...model.bias];
  for (const idx of tierFeatures(text, model.dim)) {
    for (let c = 0; c < k; c++) logits[c] += w[idx * k + c];
  }
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function decideTier(probs: number[], hThreshold: number): TierLetter {
  if (probs[2] >= hThreshold) return "H";
  return probs[0] >= probs[1] ? "L" : "N";
}

/** Classify a cleaned user message. Returns null if no trained model is bundled. */
export function classifyTier(
  text: string,
): { letter: TierLetter; probs: number[] } | null {
  if (!TIER_MODEL.weightsB64) return null;
  const probs = tierProbabilities(text);
  return { letter: decideTier(probs, TIER_MODEL.hThreshold), probs };
}
