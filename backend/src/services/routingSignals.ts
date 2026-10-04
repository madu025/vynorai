/**
 * Routing quality signals for the tier classifier.
 *
 * Each upstream request records the tier the router chose and a keyed hash
 * of the user's prompt (never the text), so every round of one prompt can be
 * grouped. From that we estimate where the router was likely wrong:
 * - underrouted: a light/normal prompt that needed many agent rounds
 * - overrouted: a heavy/deep prompt answered in one short round
 * - re-asked: the user sent the same prompt again
 */
import crypto from "crypto";

import { config } from "../config.js";

export const UNDERROUTE_MIN_ROUNDS = 12;
export const OVERROUTE_MAX_OUTPUT_TOKENS = 300;

/** Keyed, per-user hash of the prompt: groups rounds without storing text. */
export function promptFingerprint(
  userId: string,
  prompt: string,
): string | null {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${userId}\n${text}`)
    .digest("hex")
    .slice(0, 24);
}

export interface RoutingRow {
  user_id: string;
  prompt_fp: string;
  route_tier: string | null;
  tool_followup: number;
  output_tokens: number;
  credits_charged: number | null;
  created_at: string;
}

export interface TierSummary {
  tier: string;
  prompts: number;
  avgRounds: number;
  avgCredits: number;
  underrouted: number;
  overrouted: number;
  reasked: number;
}

export interface RoutingSummary {
  prompts: number;
  likelyMisrouted: number;
  misroutePct: number;
  tiers: TierSummary[];
}

const CHEAP_TIERS = new Set(["light", "normal"]);
const COSTLY_TIERS = new Set(["heavy", "deep"]);

export function summarizeRouting(rows: RoutingRow[]): RoutingSummary {
  const prompts = new Map<string, RoutingRow[]>();
  for (const row of rows) {
    const key = `${row.user_id}:${row.prompt_fp}`;
    const list = prompts.get(key);
    if (list) list.push(row);
    else prompts.set(key, [row]);
  }

  const byTier = new Map<
    string,
    {
      prompts: number;
      rounds: number;
      credits: number;
      under: number;
      over: number;
      reasked: number;
    }
  >();
  let misrouted = 0;
  for (const group of prompts.values()) {
    group.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const tier = group[0].route_tier ?? "unknown";
    const rounds = group.length;
    const sends = group.filter((r) => !r.tool_followup).length;
    const output = group.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const credits = group.reduce((s, r) => s + (r.credits_charged || 0), 0);

    const under = CHEAP_TIERS.has(tier) && rounds >= UNDERROUTE_MIN_ROUNDS;
    const over =
      COSTLY_TIERS.has(tier) &&
      rounds === 1 &&
      output < OVERROUTE_MAX_OUTPUT_TOKENS;
    const reasked = sends >= 2;
    if (under || over) misrouted++;

    const t = byTier.get(tier) ?? {
      prompts: 0,
      rounds: 0,
      credits: 0,
      under: 0,
      over: 0,
      reasked: 0,
    };
    t.prompts++;
    t.rounds += rounds;
    t.credits += credits;
    if (under) t.under++;
    if (over) t.over++;
    if (reasked) t.reasked++;
    byTier.set(tier, t);
  }

  const total = prompts.size;
  return {
    prompts: total,
    likelyMisrouted: misrouted,
    misroutePct: total ? Math.round((misrouted / total) * 1000) / 10 : 0,
    tiers: [...byTier.entries()]
      .map(([tier, t]) => ({
        tier,
        prompts: t.prompts,
        avgRounds: Math.round((t.rounds / t.prompts) * 10) / 10,
        avgCredits: Math.round(t.credits / t.prompts),
        underrouted: t.under,
        overrouted: t.over,
        reasked: t.reasked,
      }))
      .sort((a, b) => b.prompts - a.prompts),
  };
}
