/**
 * Local SLM routing + background compaction against a fake llama.cpp server.
 * Env must be set before config.ts is imported, hence the dynamic imports.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

const requests: any[] = [];
let letter = "H";
let failSummary = false;
let server: http.Server;
let slm: typeof import("../src/services/localSlmRouter.js");
let hybrid: typeof import("../src/services/hybridContext.js");

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push(body);
      if (failSummary && body.max_tokens !== 1) {
        res.statusCode = 500;
        res.end("{}");
        return;
      }
      const content =
        body.max_tokens === 1
          ? letter
          : "- user is building a login form\n- decided on JWT";
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fakeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.ROUTER_MODE = "slm";
  process.env.LOCAL_SLM_ENABLED = "true";
  process.env.LOCAL_SLM_URL = fakeUrl;
  // Compaction runs on the background LLM; point its local role at the fake.
  process.env.LOCAL_LLM_URL = fakeUrl;
  process.env.LOCAL_LLM_ROLES = "compaction";
  slm = await import("../src/services/localSlmRouter.js");
  hybrid = await import("../src/services/hybridContext.js");
});

after(() => server.close());

test("the VPS model only picks the tier; mutation authority stays deterministic", async () => {
  letter = "H";
  const decision = await slm.analyzeIntentWithLocalSlm(
    "explain how the payment webhook architecture works",
  );
  assert.equal(decision.source, "local-slm");
  assert.equal(decision.complexity, "HARD");
  assert.equal(decision.intent, "INQUIRY");
  assert.equal(decision.allowMutation, false);

  const call = requests.at(-1);
  assert.equal(call.max_tokens, 1);
  assert.equal(call.temperature, 0);
  assert.equal(call.grammar, 'root ::= "L" | "N" | "H"');
});

test("a tool loop re-sending the same turn is classified once", async () => {
  letter = "N";
  const before = requests.length;
  await slm.analyzeIntentWithLocalSlm("add a logout button to the navbar");
  await slm.analyzeIntentWithLocalSlm("add a logout button to the navbar");
  await slm.analyzeIntentWithLocalSlm("add a logout button to the navbar");
  assert.equal(requests.length - before, 1);
});

test("dropped turns are summarized in the background and reused", async () => {
  const msgs: any[] = [{ role: "system", content: "rules" }];
  // Big enough to pass the compaction trigger of the pro plan budget.
  for (let i = 0; i < 25; i++) {
    msgs.push({ role: "user", content: `question ${i} ` + "q".repeat(12_000) });
    msgs.push({
      role: "assistant",
      content: `answer ${i} ` + "a".repeat(12_000),
    });
  }

  // First request: no summary yet, turns are dropped and a job is queued.
  const first = hybrid.applyHybridContext({ messages: msgs }, "pro", "safe", {
    scope: "user-1",
  });
  assert.ok(!first.result.strategy.includes("summary"));

  await new Promise((resolve) => setTimeout(resolve, 200));

  const second = hybrid.applyHybridContext({ messages: msgs }, "pro", "safe", {
    scope: "user-1",
  });
  assert.ok(second.result.strategy.includes("summary"));
  const firstUser = second.body.messages.find((m: any) => m.role === "user");
  assert.match(firstUser.content, /<earlier-conversation-summary>[\s\S]*JWT/);

  // Another user's identical conversation never sees this user's summary.
  const other = hybrid.applyHybridContext({ messages: msgs }, "pro", "safe", {
    scope: "user-2",
  });
  assert.ok(!other.result.strategy.includes("summary"));
});

test("dropped user requests stay verbatim even when no summary exists", async () => {
  const msgs: any[] = [{ role: "system", content: "rules" }];
  msgs.push({
    role: "user",
    content:
      "GOAL-7731 build the login page in TypeScript and never touch existing tests. " +
      "q".repeat(12_000),
  });
  msgs.push({ role: "assistant", content: "a".repeat(12_000) });
  for (let i = 1; i < 25; i++) {
    msgs.push({ role: "user", content: `question ${i} ` + "q".repeat(12_000) });
    msgs.push({
      role: "assistant",
      content: `answer ${i} ` + "a".repeat(12_000),
    });
  }

  // No scope: no summary is possible, the dropped goal must still survive.
  const one = hybrid.applyHybridContext({ messages: msgs }, "pro", "safe");
  assert.ok(one.result.strategy.includes("user-requests"));
  assert.ok(!one.result.strategy.includes("summary"));
  const firstUser = one.body.messages.find((m: any) => m.role === "user");
  assert.match(firstUser.content, /<earlier-conversation-omitted>/);
  assert.match(
    firstUser.content,
    /GOAL-7731 build the login page in TypeScript/,
  );
  assert.match(firstUser.content, /never touch existing tests/);
  // The clip keeps the block small: 12K of filler must not be copied over.
  assert.ok(firstUser.content.length < 12_000 + 8_000);

  // Same input, same block: the cached prefix stays stable between boundaries.
  const two = hybrid.applyHybridContext({ messages: msgs }, "pro", "safe");
  assert.deepEqual(two.body.messages, one.body.messages);
});

test("earlierActions lists tool + target of dropped tool calls, deduped and capped", () => {
  const call = (id: string, name: string, args: unknown) => ({
    id,
    type: "function",
    function: {
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  });
  const dropped: any[] = [
    { role: "user", content: "do it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        call("1", "read_file", { filepath: "src/a.ts" }),
        call("2", "read_file", { filepath: "src/a.ts" }),
        call("3", "run_terminal_command", { command: "npm test" }),
        call("4", "broken_tool", "{not json"),
      ],
    },
  ];
  const out = hybrid.earlierActions(dropped);
  assert.equal(
    out,
    "- read_file: src/a.ts\n- run_terminal_command: npm test\n- broken_tool",
  );
  assert.equal(hybrid.earlierActions([{ role: "user", content: "x" }]), "");

  const many: any[] = [
    {
      role: "assistant",
      content: "",
      tool_calls: Array.from({ length: 50 }, (_, i) =>
        call(String(i), "read_file", { filepath: `f${i}.ts` }),
      ),
    },
  ];
  const capped = hybrid.earlierActions(many);
  assert.match(capped, /10 earlier action\(s\) omitted/);
  assert.match(capped, /f49\.ts/);
  assert.doesNotMatch(capped, /f0\.ts/);
});

test("capSlmTier: short follow-ups never turn on thinking", async () => {
  const { capSlmTier } = await import("../src/services/localSlmRouter.ts");
  assert.equal(capSlmTier("H", "Now add jest tests for it."), "N");
  assert.equal(capSlmTier("H", "fix the race condition in the queue"), "H");
  assert.equal(capSlmTier("H", "x".repeat(400)), "H");
  assert.equal(capSlmTier("L", "refactor everything"), "L");
  assert.equal(capSlmTier("N", "hi"), "N");
});

test("isMutationRequest: rename/redesign style edits keep the edit tools", async () => {
  const { isMutationRequest } = await import(
    "../src/services/localSlmRouter.ts"
  );
  assert.equal(
    isMutationRequest("Rename writeFileAtomic to atomicWrite."),
    true,
  );
  assert.equal(isMutationRequest("Redesign the index writes"), true);
  assert.equal(isMutationRequest("what does this regex do"), false);
});

test("history is append-only below the compaction trigger (prefix stays cache-hot)", async () => {
  const msgs: any[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "refactor the billing module" },
  ];
  let prev: string[] = [];
  for (let i = 0; i < 40; i++) {
    msgs.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `c${i}`,
          type: "function",
          function: { name: "read_file", arguments: "{}" },
        },
      ],
    });
    msgs.push({
      role: "tool",
      tool_call_id: `c${i}`,
      content: `file ${i} ` + "x".repeat(1500),
    });
    const out = hybrid
      .applyHybridContext({ messages: msgs }, "pro", "safe")
      .body.messages.map((m: any) => JSON.stringify(m));
    // Every earlier prompt is an exact prefix of the next one.
    assert.deepEqual(out.slice(0, prev.length), prev);
    prev = out;
  }
});

test("the next compaction's summary is prepared before the drop, so no turn runs without it", async () => {
  const msgs: any[] = [{ role: "system", content: "rules" }];
  const req = (n: number) =>
    hybrid.applyHybridContext({ messages: msgs.slice(0, n) }, "pro", "safe", {
      scope: "presum-user",
    });
  // Grow the conversation until the first compaction actually drops turns.
  let firstDrop = -1;
  let atDrop: any = null;
  for (let i = 0; i < 60 && firstDrop < 0; i++) {
    msgs.push({ role: "user", content: `step ${i} ` + "u".repeat(10_000) });
    msgs.push({
      role: "assistant",
      content: `done ${i} ` + "a".repeat(10_000),
    });
    const r = req(msgs.length);
    if (r.result.strategy.some((s: string) => s.startsWith("window"))) {
      firstDrop = msgs.length;
      atDrop = r;
    }
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the background summary land
  }
  assert.ok(firstDrop > 0, "conversation never reached the compaction trigger");
  // The very request that first drops turns already carries their summary.
  assert.ok(
    atDrop.result.strategy.includes("summary"),
    JSON.stringify(atDrop.result.strategy),
  );
});

test("a failing summary is not retried on every request", async () => {
  hybrid.resetSummaryFailures();
  failSummary = true;
  try {
    const msgs: any[] = [{ role: "system", content: "rules" }];
    for (let i = 0; i < 25; i++) {
      msgs.push({
        role: "user",
        content: `FAILCASE ${i} ` + "q".repeat(12_000),
      });
      msgs.push({ role: "assistant", content: "a".repeat(12_000) });
    }
    const before = requests.length;
    hybrid.applyHybridContext({ messages: msgs }, "pro", "safe", {
      scope: "fail-user",
    });
    await new Promise((r) => setTimeout(r, 300));
    const afterFirst = requests.length;
    for (let i = 0; i < 5; i++) {
      hybrid.applyHybridContext({ messages: msgs }, "pro", "safe", {
        scope: "fail-user",
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(afterFirst > before, "first request tries the summary");
    assert.equal(requests.length, afterFirst, "no retry inside the backoff");
  } finally {
    failSummary = false;
    hybrid.resetSummaryFailures();
  }
});
