import assert from "node:assert/strict";
import { test } from "node:test";

import {
  promptFingerprint,
  RoutingRow,
  summarizeRouting,
} from "../src/services/routingSignals.js";

function rows(
  fp: string,
  tier: string,
  rounds: number,
  opts: { output?: number; sends?: number; user?: string } = {},
): RoutingRow[] {
  return Array.from({ length: rounds }, (_, i) => ({
    user_id: opts.user ?? "u1",
    prompt_fp: fp,
    route_tier: tier,
    tool_followup: i < (opts.sends ?? 1) ? 0 : 1,
    output_tokens: opts.output ?? 500,
    credits_charged: 1000,
    created_at: `2026-10-04 10:00:${String(i).padStart(2, "0")}`,
  }));
}

test("fingerprints are per user, whitespace-insensitive and hide the text", () => {
  const a = promptFingerprint("u1", "fix  the login\nbug");
  assert.equal(a, promptFingerprint("u1", "fix the login bug"));
  assert.notEqual(a, promptFingerprint("u2", "fix the login bug"));
  assert.ok(a && !a.includes("login"));
  assert.equal(promptFingerprint("u1", "   "), null);
});

test("flags underrouted, overrouted and re-asked prompts", () => {
  const s = summarizeRouting([
    ...rows("a", "normal", 14), // underrouted
    ...rows("b", "deep", 1, { output: 80 }), // overrouted
    ...rows("c", "normal", 3, { sends: 2 }), // re-asked, fine otherwise
    ...rows("d", "heavy", 6), // fine
  ]);
  assert.equal(s.prompts, 4);
  assert.equal(s.likelyMisrouted, 2);
  assert.equal(s.misroutePct, 50);
  const normal = s.tiers.find((t) => t.tier === "normal")!;
  assert.equal(normal.underrouted, 1);
  assert.equal(normal.reasked, 1);
  assert.equal(s.tiers.find((t) => t.tier === "deep")!.overrouted, 1);
});

test("the same prompt from two users counts twice", () => {
  const s = summarizeRouting([
    ...rows("a", "normal", 2, { user: "u1" }),
    ...rows("a", "normal", 2, { user: "u2" }),
  ]);
  assert.equal(s.prompts, 2);
});
