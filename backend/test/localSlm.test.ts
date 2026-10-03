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
  process.env.LOCAL_SLM_ENABLED = "true";
  process.env.LOCAL_SLM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  slm = await import("../src/services/localSlmRouter.js");
  hybrid = await import("../src/services/hybridContext.js");
});

after(() => server.close());

test("the VPS model only picks the tier; mutation authority stays deterministic", async () => {
  letter = "H";
  const decision = await slm.analyzeIntentWithLocalSlm(
    "explain how the payment webhook works",
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
  for (let i = 0; i < 25; i++) {
    msgs.push({ role: "user", content: `question ${i}` });
    msgs.push({ role: "assistant", content: `answer ${i}` });
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
