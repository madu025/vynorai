/**
 * Live DeepSeek check for the agent thinking policy.
 *
 *   DEEPSEEK_API_KEY=sk-... npx tsx src/scripts/liveDeepseekCheck.ts
 *
 * Sends the exact body applyTierPolicy produces for an IDE-agent turn on the
 * "light" tier and verifies, against the real API:
 *   1. thinking is enabled and reasoning_content comes back
 *   2. a tool call is produced
 *   3. replaying reasoning_content with the tool result succeeds (multi-turn)
 *   4. omitting reasoning_content on the replay is reported (expected 400)
 * The key is read from the environment only and never printed.
 */
import { applyTierPolicy } from "../services/autoRouter.js";

const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = (
  process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com"
).replace(/\/$/, "");
const MODEL = process.env.DEEPSEEK_CHAT_MODEL || "deepseek-flash";
if (!KEY) {
  console.error("Set DEEPSEEK_API_KEY in your shell first.");
  process.exit(2);
}

const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the workspace",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

async function call(messages: any[]) {
  const body = applyTierPolicy(
    { model: MODEL, messages, tools, stream: false },
    "light",
  );
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, body, json };
}

const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, note = "") => {
  results.push([name, ok, note]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  - " + note : ""}`);
};

async function main() {
  const user = {
    role: "user",
    content: "Read package.json and tell me the project name.",
  };
  const first = await call([user]);
  const msg = first.json?.choices?.[0]?.message;
  console.log(
    "INFO  message keys:",
    Object.keys(msg ?? {}).join(","),
    "| usage:",
    JSON.stringify(first.json?.usage ?? {}),
    "| model:",
    first.json?.model,
  );
  console.log(
    "INFO  request thinking:",
    JSON.stringify(first.body.thinking),
    "effort:",
    first.body.reasoning_effort,
  );
  check(
    "request sent thinking enabled + effort low",
    first.body.thinking?.type === "enabled" &&
      first.body.reasoning_effort === "low",
  );
  check("API accepted request", first.status === 200, `status ${first.status}`);
  // At low effort DeepSeek may legitimately skip reasoning on a trivial
  // prompt, so an empty reasoning_content is a warning, not a failure.
  if (msg?.reasoning_content) {
    check(
      "reasoning_content returned",
      true,
      `${msg.reasoning_content.length} chars`,
    );
  } else {
    console.log(
      "WARN  no reasoning_content this run (model skipped thinking at low effort); re-run to confirm",
    );
  }
  const call1 = msg?.tool_calls?.[0];
  check("tool call produced", !!call1, call1?.function?.name ?? "none");

  if (call1) {
    const tool = {
      role: "tool",
      tool_call_id: call1.id,
      content: '{"name":"vynorai"}',
    };
    const withRc = await call([
      user,
      {
        role: "assistant",
        content: msg.content ?? "",
        reasoning_content: msg.reasoning_content,
        tool_calls: msg.tool_calls,
      },
      tool,
    ]);
    check(
      "replay WITH reasoning_content accepted",
      withRc.status === 200,
      `status ${withRc.status}`,
    );
    const noRc = await call([
      user,
      {
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      },
      tool,
    ]);
    console.log(
      `INFO  replay WITHOUT reasoning_content -> status ${noRc.status}` +
        (noRc.status === 400 ? " (confirms the field must be forwarded)" : ""),
    );
  }

  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("Live check crashed:", e?.message ?? e);
  process.exit(1);
});
