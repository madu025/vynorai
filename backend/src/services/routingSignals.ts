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

export interface FeedbackRow {
  user_id: string;
  prompt_fp: string | null;
  signal: string;
}

export interface TierSummary {
  tier: string;
  prompts: number;
  avgRounds: number;
  avgCredits: number;
  underrouted: number;
  overrouted: number;
  reasked: number;
  unhelpful: number;
  helpful: number;
}

export interface RoutingSummary {
  prompts: number;
  likelyMisrouted: number;
  misroutePct: number;
  tiers: TierSummary[];
}

const CHEAP_TIERS = new Set(["light", "normal"]);
const COSTLY_TIERS = new Set(["heavy", "deep"]);

export function summarizeRouting(
  rows: RoutingRow[],
  feedback: FeedbackRow[] = [],
): RoutingSummary {
  const votes = new Map<string, string>();
  for (const f of feedback)
    if (f.prompt_fp) votes.set(`${f.user_id}:${f.prompt_fp}`, f.signal);
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
      unhelpful: number;
      helpful: number;
    }
  >();
  let misrouted = 0;
  for (const [key, group] of prompts) {
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
      unhelpful: 0,
      helpful: 0,
    };
    t.prompts++;
    t.rounds += rounds;
    t.credits += credits;
    if (under) t.under++;
    if (over) t.over++;
    if (reasked) t.reasked++;
    const vote = votes.get(key);
    if (vote === "unhelpful") t.unhelpful++;
    if (vote === "helpful") t.helpful++;
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
        unhelpful: t.unhelpful,
        helpful: t.helpful,
      }))
      .sort((a, b) => b.prompts - a.prompts),
  };
}

export interface TaskCreditStats {
  median: number;
  p90: number;
  samples: number;
}

const statsCache = new Map<
  string,
  { at: number; value: TaskCreditStats | null }
>();

/**
 * Credits a user's own prompts (all rounds of one prompt) cost over the last
 * 30 days: the basis for "your typical task costs about N credits" before a
 * task starts. Null until there are at least 5 prompts. Cached 10 minutes.
 */
export async function taskCreditStats(
  userId: string,
  query: (sql: string, params: any[]) => Promise<Array<{ credits: number }>>,
): Promise<TaskCreditStats | null> {
  const hit = statsCache.get(userId);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const since = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const rows = await query(
    `SELECT COALESCE(SUM(credits_charged), 0) AS credits
     FROM request_economics
     WHERE user_id = ? AND prompt_fp IS NOT NULL AND created_at >= ?
     GROUP BY prompt_fp`,
    [userId, since],
  ).catch(() => []);
  const credits = rows
    .map((r) => Number(r.credits) || 0)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const value =
    credits.length < 5
      ? null
      : {
          median: credits[Math.floor(credits.length / 2)],
          p90: credits[
            Math.min(credits.length - 1, Math.floor(credits.length * 0.9))
          ],
          samples: credits.length,
        };
  statsCache.set(userId, { at: Date.now(), value });
  return value;
}
