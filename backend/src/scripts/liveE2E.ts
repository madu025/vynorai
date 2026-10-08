/**
 * Live end-to-end test of the VynorAI proxy pipeline with real DeepSeek.
 *
 *   npx tsx src/scripts/liveE2E.ts [runsPerPolicy]
 *
 * Starts the real chat handler (router, tier policy, hybrid context, provider
 * dispatch) on a temp SQLite DB and drives it like the IDE does: a Singlish
 * prompt, an agent tool list, and a multi-turn tool loop whose tool calls run
 * for real against this repository. Each final answer is scored against facts
 * read from disk. Compares the default agent policy with AGENT_THINKING=off.
 * No key is printed; it comes from the backend's own config/environment.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";

const REPO = path.resolve(process.cwd(), "..");
// Load the backend config from its own folder before moving to a temp cwd.
dotenv.config({ path: path.join(REPO, "backend", ".env") });
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-e2e-")));

const RUNS = Number(process.argv[2] || 3);
let express: any;
let initDb: () => Promise<void>;
let dbRun: (sql: string, params?: any[]) => Promise<any>;
let handleChatCompletions: (...args: any[]) => Promise<any>;

const tools = [
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "Search the repo with a regex. Returns file:line: text.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file (repo-relative path), optionally a line range.",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
        },
        required: ["filepath"],
      },
    },
  },
];

function runTool(name: string, args: any): string {
  try {
    if (name === "grep_search") {
      return execFileSync(
        "git",
        [
          "grep",
          "-n",
          "-I",
          "-P",
          String(args.query),
          "--",
          "backend/src",
          "core/workspace",
          "gui/src/components/mainInput",
        ],
        { cwd: REPO, encoding: "utf8", maxBuffer: 4_000_000 },
      ).slice(0, 8000);
    }
    if (name === "read_file") {
      const p = path.resolve(REPO, String(args.filepath));
      if (!p.startsWith(REPO)) return "denied";
      const lines = fs.readFileSync(p, "utf8").split("\n");
      const s = Math.max(1, Number(args.start || 1));
      const e = Math.min(lines.length, Number(args.end || s + 200));
      return lines
        .slice(s - 1, e)
        .map((l, i) => `${s + i}: ${l}`)
        .join("\n");
    }
  } catch (e: any) {
    return e?.status === 1 ? "No matches found." : `error: ${e?.message}`;
  }
  return "unknown tool";
}

const SYSTEM =
  "You are VynorAI, a coding agent in the user's IDE. Use tools to inspect the repository before answering. Never guess file paths: verify with tools. Answer concisely.";

const tasks = [
  {
    name: "trim cap",
    prompt:
      "backend eke tool output (grep/glob) trim karana function eka kothanada thiyenne, saha search tools walata cap eka (characters) kiyada? File path eka saha number eka kiyanna.",
    ok: (a: string) => /hybridContext\.ts/.test(a) && /24[, ]?000/.test(a),
  },
  {
    name: "sinhala guard",
    prompt:
      "Sinhala/Tamil prompt ekak 'light' tier ekata classify wenne nathuwa rakaganna code eka kothanada? File eka saha regex constant eke nama kiyanna.",
    ok: (a: string) =>
      /localSlmRouter\.ts/.test(a) && /NON_LATIN_SCRIPT/.test(a),
  },
];

async function chat(base: string, messages: any[]) {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "vynor-auto",
      messages,
      tools,
      stream: true,
    }),
  });
  const text = await res.text();
  let content = "";
  let reasoning = "";
  const calls = new Map<number, any>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    let j: any;
    try {
      j = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    const d = j.choices?.[0]?.delta ?? {};
    if (d.content) content += d.content;
    if (d.reasoning_content) reasoning += d.reasoning_content;
    for (const tc of d.tool_calls ?? []) {
      const c = calls.get(tc.index ?? 0) ?? { id: "", name: "", args: "" };
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
      calls.set(tc.index ?? 0, c);
    }
  }
  return {
    status: res.status,
    tier: res.headers.get("x-vynorai-tier"),
    model: res.headers.get("x-vynorai-model"),
    content,
    reasoning,
    calls: [...calls.values()],
    raw: res.status !== 200 ? text.slice(0, 300) : "",
  };
}

async function runTask(base: string, task: (typeof tasks)[number]) {
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: task.prompt },
  ];
  let toolCalls = 0;
  let meta = { tier: "", model: "" };
  for (let turn = 0; turn < 8; turn++) {
    const r = await chat(base, messages);
    if (r.status !== 200)
      return {
        pass: false,
        why: `HTTP ${r.status} ${r.raw}`,
        toolCalls,
        ...meta,
      };
    meta = { tier: r.tier ?? "", model: r.model ?? "" };
    if (!r.calls.length) {
      return {
        pass: task.ok(r.content),
        why: r.content.slice(0, 160).replace(/\s+/g, " "),
        toolCalls,
        ...meta,
      };
    }
    messages.push({
      role: "assistant",
      content: r.content || "",
      reasoning_content: r.reasoning || "",
      tool_calls: r.calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });
    for (const c of r.calls) {
      toolCalls++;
      let args: any = {};
      try {
        args = JSON.parse(c.args || "{}");
      } catch {}
      messages.push({
        role: "tool",
        tool_call_id: c.id,
        content: runTool(c.name, args),
      });
    }
  }
  return { pass: false, why: "no final answer in 8 turns", toolCalls, ...meta };
}

async function main() {
  express = (await import("express")).default;
  ({ initDb, dbRun } = await import("../db.js"));
  ({ handleChatCompletions } = await import("../services/aiProxy.js"));
  await initDb();
  await (await import("../services/memoryEngine.js")).ensureMemoryTables();
  const userId = "e2e-user";
  await dbRun(
    "INSERT OR REPLACE INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [userId, "e2e@test.lk", "k-e2e", "h-e2e"],
  );
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.post("/v1/chat/completions", (req: any, res: any) => {
    // Unique per-run salt keeps the exact-answer cache from masking a real call.
    handleChatCompletions(
      {
        id: userId,
        email: "e2e@test.lk",
        hasActiveSubscription: true,
        subscriptionPlan: "pro",
      },
      req.body,
      res,
    ).catch((e: any) => {
      if (!res.headersSent)
        res.status(500).json({ error: String(e?.message ?? e) });
    });
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  for (const policy of ["default (agent thinks)", "AGENT_THINKING=off"]) {
    if (policy.includes("off")) process.env.AGENT_THINKING = "off";
    else delete process.env.AGENT_THINKING;
    console.log(`\n== Policy: ${policy}`);
    for (const task of tasks) {
      let pass = 0;
      const notes: string[] = [];
      let tc = 0;
      for (let i = 0; i < RUNS; i++) {
        const r = await runTask(base, {
          ...task,
          prompt: `${task.prompt} (run ${policy[0]}${i}${Date.now() % 100000})`,
        });
        if (r.pass) pass++;
        else notes.push(r.why);
        tc += r.toolCalls;
        if (i === 0)
          console.log(`   [${task.name}] tier=${r.tier} model=${r.model}`);
      }
      console.log(
        `   [${task.name}] correct ${pass}/${RUNS}, avg tool calls ${(tc / RUNS).toFixed(1)}`,
      );
      notes.slice(0, 2).forEach((n) => console.log("     wrong:", n));
    }
  }
  server.close();
  process.exit(0);
}
main().catch((e) => {
  console.error("e2e crashed:", e?.stack ?? e);
  process.exit(1);
});
