/**
 * Live A/B: old agent policy (thinking off on light/normal) vs new (thinking on).
 *
 *   npx tsx src/scripts/liveQualityAB.ts [runsPerArm]
 *
 * Task mirrors the audit failure seen in the IDE: given a real directory
 * listing and a list of expected files, say which are missing. The expected
 * answer is computed from disk, so each reply is scored exactly. The prompt is
 * Singlish on purpose. The key comes from the environment / backend config and
 * is never printed.
 */
import fs from "fs";
import path from "path";
import { applyTierPolicy } from "../services/autoRouter.js";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = (
  process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com"
).replace(/\/$/, "");
const MODEL = process.env.DEEPSEEK_CHAT_MODEL || "deepseek-flash";
const RUNS = Number(process.argv[2] || 5);
if (!KEY) {
  console.error("No DEEPSEEK_API_KEY available.");
  process.exit(2);
}

const listing = fs
  .readdirSync(path.resolve(process.cwd(), "../core"), { recursive: true })
  .map(String)
  .filter((f) => /\.(ts|json)$/.test(f) && !f.includes("node_modules"))
  .map((f) => f.split("\\").join("/"))
  .filter((f) => /^(agent|workspace|protocol)\//.test(f))
  .sort();
// Real files, plus case/near-miss decoys that look present but are not.
const real = listing.filter(
  (f) => !f.includes(".vitest.") && !f.includes(".test."),
);
const expected = [
  ...real.slice(0, 12),
  "agent/ContextPlanner.ts",
  "agent/taskRuntime.ts",
  "agent/TaskEventJournal.ts",
  "agent/ToolBroker.ts",
  "agent/toolrisk.ts",
  "agent/RedactSecrets.ts",
  "workspace/WorkspaceSessionservice.ts",
  "workspace/types.d.ts",
  "protocol/Core.ts",
  "agent/VerificationDiscovery.ts",
];
const truth = expected.filter((f) => !listing.includes(f)).sort();

const prompt = `core eke (agent, workspace, protocol) thiyena files list eka meka:
${listing.map((f) => `- ${f}`).join("\n")}

Architecture plan eke me files thiyenna one kiyala thiyenawa:
${expected.map((f) => `- ${f}`).join("\n")}

Plan eke thiyena files walin listing eke NATHI ewa monawada? Listing eka hariyatama balanna (nama eka akuru-akuru samaga ganna).
Reply with ONLY JSON: {"missing": ["file", ...]}`;

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a workspace file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

async function ask(agentThinks: boolean) {
  if (agentThinks) delete process.env.AGENT_THINKING;
  else process.env.AGENT_THINKING = "off";
  const body = applyTierPolicy(
    {
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      tools,
      stream: false,
    },
    "normal",
  );
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  let got: string[] | null = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    got = m ? (JSON.parse(m[0]).missing as string[]).slice().sort() : null;
  } catch {
    got = null;
  }
  return {
    thinking: body.thinking?.type,
    status: res.status,
    ms: Date.now() - t0,
    reasoningTokens:
      json?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    outTokens: json?.usage?.completion_tokens ?? 0,
    exact: !!got && JSON.stringify(got) === JSON.stringify(truth),
    got,
  };
}

async function main() {
  console.log("Ground truth (missing):", JSON.stringify(truth));
  const arms: Array<[string, boolean]> = [
    ["BEFORE (thinking off)", false],
    ["AFTER  (thinking on, low)", true],
  ];
  for (const [label, think] of arms) {
    const runs: Awaited<ReturnType<typeof ask>>[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await ask(think));
    const ok = runs.filter((r) => r.exact).length;
    const avg = (k: "ms" | "reasoningTokens" | "outTokens") =>
      Math.round(runs.reduce((s, r) => s + r[k], 0) / runs.length);
    console.log(
      `${label}: thinking=${runs[0].thinking} exact ${ok}/${RUNS} | avg ${avg("ms")}ms, ${avg("outTokens")} out tok (${avg("reasoningTokens")} reasoning)`,
    );
    runs
      .filter((r) => !r.exact)
      .slice(0, 2)
      .forEach((r) =>
        console.log(
          "   wrong answer:",
          JSON.stringify(r.got),
          "status",
          r.status,
        ),
      );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error("crashed:", e?.message ?? e);
  process.exit(1);
});
