import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// The model registry may open SQLite in the cwd; keep tests off the dev database.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-routing-")));

let applyTierPolicy: typeof import("../src/services/autoRouter.js").applyTierPolicy;
let isAutoModel: typeof import("../src/services/autoRouter.js").isAutoModel;
let resolveRoute: typeof import("../src/services/autoRouter.js").resolveRoute;
let tierFromComplexity: typeof import("../src/services/autoRouter.js").tierFromComplexity;
let applyHybridContext: typeof import("../src/services/hybridContext.js").applyHybridContext;
let trimToolOutput: typeof import("../src/services/hybridContext.js").trimToolOutput;
let attachTurnContext: typeof import("../src/services/tokenOptimizer.js").attachTurnContext;
let memoizeTurnContext: typeof import("../src/services/tokenOptimizer.js").memoizeTurnContext;
let turnKey: typeof import("../src/services/tokenOptimizer.js").turnKey;
let cosine: typeof import("../src/services/semanticCache.js").cosine;
let semanticCacheQuestion: typeof import("../src/services/semanticCache.js").semanticCacheQuestion;
let creditWeight: typeof import("../src/services/billingPolicy.js").creditWeight;

before(async () => {
  ({ applyTierPolicy, isAutoModel, resolveRoute, tierFromComplexity } =
    await import("../src/services/autoRouter.js"));
  ({ applyHybridContext, trimToolOutput } = await import(
    "../src/services/hybridContext.js"
  ));
  ({ attachTurnContext, memoizeTurnContext, turnKey } = await import(
    "../src/services/tokenOptimizer.js"
  ));
  ({ cosine, semanticCacheQuestion } = await import(
    "../src/services/semanticCache.js"
  ));
  ({ creditWeight } = await import("../src/services/billingPolicy.js"));
  const db = await import("../src/db.js");
  await db.initDb();
  await db.initModelRegistry();
});

// ─── Auto router ──────────────────────────────────────────────────────────────

test("complexity maps to tiers", () => {
  assert.equal(tierFromComplexity("EASY"), "light");
  assert.equal(tierFromComplexity("MEDIUM"), "normal");
  assert.equal(tierFromComplexity("HARD"), "heavy");
  assert.equal(isAutoModel("vynor-auto"), true);
  assert.equal(isAutoModel("deepseek-v3"), false);
});

test("auto uses V4.1 Flash for every tier, explicit models pass through", async () => {
  assert.equal(
    (await resolveRoute("vynor-auto", "light", "free")).model,
    "deepseek/deepseek-flash",
  );
  assert.equal(
    (await resolveRoute("vynor-auto", "heavy", "free")).model,
    "deepseek/deepseek-flash",
  );
  assert.deepEqual(await resolveRoute("deepseek-v3", "heavy", "pro"), {
    model: "deepseek-v3",
    tier: "heavy",
    auto: false,
  });
});

test("only deep logic reasoning reaches V4 Pro; big coding stays on Flash", async () => {
  const { refineTier } = await import("../src/services/autoRouter.js");
  assert.equal(
    refineTier("heavy", "find the race condition in the payment queue worker"),
    "deep",
  );
  assert.equal(
    refineTier("heavy", "do a security audit of the auth module"),
    "deep",
  );
  assert.equal(
    refineTier("heavy", "refactor the whole dashboard into hooks"),
    "heavy",
  );
  // Deep keywords never upgrade light/normal turns.
  assert.equal(refineTier("normal", "what is an algorithm"), "normal");

  assert.equal(
    (await resolveRoute("vynor-auto", "deep", "pro")).model,
    "deepseek/deepseek-v4-pro",
  );
  assert.equal(
    (await resolveRoute("vynor-auto", "heavy", "pro")).model,
    "deepseek/deepseek-flash",
  );
  // Plans without Pro still get deep reasoning, on Flash with thinking.
  const free = await resolveRoute("vynor-auto", "deep", "free");
  assert.equal(free.model, "deepseek/deepseek-flash");
  assert.deepEqual(applyTierPolicy({}, "deep").thinking, { type: "enabled" });
});

test("auto falls back to the plan default when a tier model is not entitled", async () => {
  process.env.AUTO_MODEL_HEAVY = "deepseek/deepseek-v4-pro"; // not on the free plan
  try {
    assert.equal(
      (await resolveRoute("vynor-auto", "heavy", "free")).model,
      "deepseek/deepseek-flash",
    );
    assert.equal(
      (await resolveRoute("vynor-auto", "heavy", "pro")).model,
      "deepseek/deepseek-v4-pro",
    );
  } finally {
    delete process.env.AUTO_MODEL_HEAVY;
  }
});

test("thinking is explicitly off except on heavy turns; max_tokens can only be lowered", () => {
  // DeepSeek V4 thinks by default, so "off" must be sent explicitly.
  const light = applyTierPolicy({ messages: [] }, "light");
  assert.deepEqual(light.thinking, { type: "disabled" });
  assert.equal(light.reasoning_effort, undefined);
  assert.equal(light.max_tokens, 4096);

  const heavy = applyTierPolicy({ messages: [] }, "heavy");
  assert.deepEqual(heavy.thinking, { type: "enabled" });
  // Heavy coding thinks briefly; only deep logic pays for full reasoning.
  assert.equal(heavy.reasoning_effort, "low");
  assert.equal(
    applyTierPolicy({ messages: [] }, "deep").reasoning_effort,
    "high",
  );
  assert.equal(
    applyTierPolicy({ messages: [], reasoning_effort: "max" }, "heavy")
      .reasoning_effort,
    "max",
  );

  // A user-chosen reasoning model keeps thinking even on a light turn.
  assert.deepEqual(
    applyTierPolicy({ model: "deepseek-r1" }, "light").thinking,
    { type: "enabled" },
  );

  assert.equal(
    applyTierPolicy({ max_tokens: 100_000 }, "normal").max_tokens,
    8192,
  );
  assert.equal(applyTierPolicy({ max_tokens: 500 }, "heavy").max_tokens, 500);
  // Agent turns (tools) can write whole files even on the light tier.
  assert.equal(
    applyTierPolicy({ tools: [{ type: "function" }] }, "light").max_tokens,
    16_384,
  );
  // Explicit client thinking settings are respected.
  assert.deepEqual(
    applyTierPolicy({ thinking: { type: "disabled" } }, "heavy").thinking,
    { type: "disabled" },
  );
});

test("auto and Flash are the 1x baseline; V4 Pro is weighted", () => {
  assert.equal(creditWeight("vynor-auto"), 1);
  assert.equal(creditWeight("deepseek-flash"), 1);
  assert.equal(creditWeight("deepseek-v4-pro"), 5);
});

// ─── Prefix-cache layout ──────────────────────────────────────────────────────

const history = [
  { role: "system", content: "rules" },
  { role: "user", content: "first" },
  { role: "assistant", content: "ok" },
  { role: "user", content: "second" },
];

test("turn context rides at the end of the last message, prefix untouched", () => {
  const out = attachTurnContext(history, "RAG HITS");
  assert.deepEqual(out.slice(0, 3), history.slice(0, 3));
  assert.match(
    out[3].content,
    /^second\n\n<vynor-context [^>]*>\nRAG HITS\n<\/vynor-context>$/,
  );
  assert.equal(attachTurnContext(history, "  "), history);
});

test("in a tool loop, context goes on the last tool result, not the prompt", () => {
  const loop = [
    ...history,
    { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
    { role: "tool", tool_call_id: "t1", content: "file text" },
  ];
  const out = attachTurnContext(loop, "RAG HITS");
  // Everything the next turn resends unchanged stays byte-identical.
  assert.deepEqual(out.slice(0, 5), loop.slice(0, 5));
  assert.match(out[5].content, /^file text\n\n<vynor-context/);
});

test("turn context is computed once per turn", async () => {
  const key = turnKey("user-a", history);
  let calls = 0;
  const compute = async () => `ctx-${++calls}`;
  assert.equal(await memoizeTurnContext(key, compute), "ctx-1");
  assert.equal(await memoizeTurnContext(key, compute), "ctx-1");
  assert.notEqual(turnKey("user-b", history), key);
});

// ─── Hybrid context ───────────────────────────────────────────────────────────

function conversation(turns: number) {
  const msgs: any[] = [{ role: "system", content: "rules" }];
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "user", content: `question ${i}` });
    msgs.push({ role: "assistant", content: `answer ${i}` });
  }
  return msgs;
}

test("the window start moves in steps, so the prefix is stable across turns", () => {
  const firstStarts = new Set<string>();
  for (let turns = 19; turns <= 23; turns++) {
    const { body } = applyHybridContext(
      { messages: conversation(turns) },
      "pro",
    );
    firstStarts.add(body.messages[1].content);
  }
  // 38..46 messages: same quantized drop for the whole range.
  assert.equal(firstStarts.size, 1);
});

test("window never starts on an orphaned tool result", () => {
  const msgs: any[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "do the task" },
  ];
  for (let i = 0; i < 30; i++) {
    msgs.push({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: `c${i}`, function: { name: "read_file", arguments: "{}" } },
      ],
    });
    msgs.push({ role: "tool", tool_call_id: `c${i}`, content: `file ${i}` });
  }
  const { body } = applyHybridContext({ messages: msgs }, "pro");
  const kept = body.messages.filter((m: any) => m.role !== "system");
  assert.equal(kept[0].content, "do the task"); // the user's request survives
  assert.equal(kept[1].role, "assistant"); // then a complete tool exchange
  const callIds = new Set(
    kept.flatMap((m: any) => (m.tool_calls ?? []).map((c: any) => c.id)),
  );
  for (const m of kept)
    if (m.role === "tool") assert.ok(callIds.has(m.tool_call_id));
});

test("terminal output is trimmed deterministically, file reads are not", () => {
  const noisy = `${"npm info ok\n".repeat(1000)}src/a.ts:3 error TS2304: Cannot find name 'x'\n${"done\n".repeat(1000)}`;
  const trimmed = trimToolOutput(noisy);
  assert.ok(trimmed.length < noisy.length / 2);
  assert.match(trimmed, /error TS2304/);
  assert.equal(trimToolOutput(noisy), trimmed);

  const msgs = [
    { role: "system", content: "rules" },
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "t1",
          function: { name: "run_terminal_command", arguments: "{}" },
        },
        { id: "t2", function: { name: "read_file", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "t1", content: noisy },
    { role: "tool", tool_call_id: "t2", content: noisy },
  ];
  const { body } = applyHybridContext({ messages: msgs }, "pro");
  assert.equal(body.messages[3].content, trimmed);
  assert.equal(body.messages[4].content, noisy);
});

test("an unchanged file read a second time becomes a pointer; changed or first reads stay", () => {
  const v1 = "export const a = 1;\n".repeat(40);
  const v2 = "export const a = 2;\n".repeat(40);
  const call = (id: string, name = "read_file") => ({
    role: "assistant",
    content: "",
    tool_calls: [{ id, function: { name, arguments: "{}" } }],
  });
  const msgs = [
    { role: "system", content: "rules" },
    { role: "user", content: "refactor a" },
    call("r1"),
    { role: "tool", tool_call_id: "r1", content: v1 },
    call("r2"),
    { role: "tool", tool_call_id: "r2", content: v1 }, // unchanged re-read
    call("e1", "multi_edit"),
    { role: "tool", tool_call_id: "e1", content: "ok" },
    call("r3"),
    { role: "tool", tool_call_id: "r3", content: v2 }, // changed: kept
    call("t1", "run_terminal_command"),
    { role: "tool", tool_call_id: "t1", content: v2 }, // not a read tool
  ];
  const { body, result } = applyHybridContext({ messages: msgs }, "pro");
  const tool = (id: string) =>
    body.messages.find((m: any) => m.tool_call_id === id).content;
  assert.equal(tool("r1"), v1); // original untouched (cached prefix)
  assert.match(
    tool("r2"),
    /^\[Unchanged: identical to an earlier read_file result/,
  );
  assert.equal(tool("r3"), v2);
  assert.equal(tool("t1"), v2);
  assert.ok(result.strategy.some((s: string) => s.startsWith("read-dedupe")));
});

test("the IDE compaction prompt is read-only, not a 'create' mutation", async () => {
  const { analyzeIntentWithLocalSlm } = await import(
    "../src/services/localSlmRouter.js"
  );
  const decision = await analyzeIntentWithLocalSlm(
    "Create a comprehensive summary of this conversation that captures all essential information",
  );
  assert.equal(decision.intent, "INQUIRY");
  assert.equal(decision.allowMutation, false);
});

// ─── Semantic cache eligibility ───────────────────────────────────────────────

test("only short generic first-turn questions use the semantic cache", () => {
  const ask = (content: string, extra: any[] = []) =>
    semanticCacheQuestion([
      { role: "system", content: "rules" },
      ...extra,
      { role: "user", content },
    ]);

  assert.equal(
    ask("How do I debounce an input in React?"),
    "how do i debounce an input in react?",
  );
  assert.equal(ask("fix this ```const x = 1```"), null);
  assert.equal(ask("explain @codebase"), null);
  assert.equal(ask("<vynor-context>x</vynor-context> what is this"), null);
  assert.equal(ask("hi"), null);
  assert.equal(
    ask("follow up", [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]),
    null,
  );
  // Agent and subagent turns carry tools: they must act on the workspace, not replay text.
  const tools = [{ type: "function", function: { name: "read_file" } }];
  assert.equal(
    semanticCacheQuestion(
      [{ role: "user", content: "How do I debounce an input in React?" }],
      tools,
    ),
    null,
  );
});

test("cosine of unit vectors", () => {
  const a = Float32Array.from([1, 0]);
  const b = Float32Array.from([0, 1]);
  assert.equal(cosine(a, a), 1);
  assert.equal(cosine(a, b), 0);
});

test("legacy DeepSeek ids served by Flash are entitled like Flash (old autocomplete configs)", async () => {
  const { canPlanUseModel } = await import("../src/services/modelRegistry.ts");
  for (const id of [
    "deepseek/deepseek-coder-v2",
    "deepseek-coder",
    "deepseek-chat",
    "deepseek/deepseek-chat-v3-0324",
    "deepseek-v4-flash",
  ]) {
    assert.equal(await canPlanUseModel("free", id), true, id);
  }
  // The legacy rule never unlocks Pro.
  assert.equal(
    /^(deepseek\/)?deepseek-(coder(-v2)?|chat(-v3[-\w]*)?|v3|v4-flash)$/i.test(
      "deepseek/deepseek-v4-pro",
    ),
    false,
  );
});

test("the backend prompt is added only when the client sends none", async () => {
  const { systemPromptFor } = await import("../src/services/aiProxy.js");
  const ide = {
    messages: [
      { role: "system", content: "IDE agent prompt" },
      { role: "user", content: "hi" },
    ],
  };
  assert.equal(systemPromptFor(ide), undefined);
  assert.equal(systemPromptFor({ system: "custom", messages: [] }), "custom");
  assert.match(
    String(systemPromptFor({ messages: [{ role: "user", content: "hi" }] })),
    /VynorAI/,
  );
});
