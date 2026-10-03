import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  decideTier,
  tierFeatures,
  tierProbabilities,
  type TierModel,
} from "../src/services/tierClassifier.ts";

test("features are deterministic, bounded by dim, and include shape signals", () => {
  const a = tierFeatures("Refactor src/auth.ts and src/db.ts", 1024);
  assert.deepEqual(a, tierFeatures("Refactor src/auth.ts and src/db.ts", 1024));
  assert.ok(a.every((i) => i >= 0 && i < 1024));
  assert.notDeepEqual(a, tierFeatures("what is a closure?", 1024));
});

test("probabilities follow the weights; H needs to clear its threshold", () => {
  const dim = 64;
  const w = new Float32Array(dim * 3);
  // Push every feature of this text toward H.
  for (const i of tierFeatures("design the architecture", dim))
    w[i * 3 + 2] += 1;
  const model: TierModel = {
    dim,
    bias: [0, 0, 0],
    weightsB64: "x",
    hThreshold: 0.6,
    trainedAt: "",
  };
  const p = tierProbabilities("design the architecture", model, w);
  assert.ok(Math.abs(p.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.equal(decideTier(p, 0.6), "H");
  assert.equal(decideTier([0.2, 0.35, 0.45], 0.6), "N");
  assert.equal(decideTier([0.5, 0.3, 0.2], 0.6), "L");
});

test("background jobs fall back to DeepSeek when the GPU server fails", async () => {
  let localCalls = 0;
  const server = http.createServer((_req, res) => {
    localCalls++;
    res.statusCode = 500;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOCAL_LLM_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.LOCAL_LLM_ROLES = "compaction";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith("https://api.deepseek.com")) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.thinking, { type: "disabled" });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "- summary" } }] }),
      );
    }
    return realFetch(url, init);
  }) as typeof fetch;
  try {
    const { config } = await import("../src/config.ts");
    (config.aiKeys as any).deepseek = "sk-test";
    const { runBackgroundLlm } = await import(
      "../src/services/backgroundLlm.ts"
    );
    const out = await runBackgroundLlm(
      "compaction",
      [{ role: "user", content: "x" }],
      50,
    );
    assert.equal(localCalls, 1);
    assert.deepEqual(out, { text: "- summary", target: "deepseek" });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LOCAL_LLM_URL;
    delete process.env.LOCAL_LLM_ROLES;
    server.close();
  }
});

test("the bundled model routes real prompts sensibly", async () => {
  const { classifyTier } = await import("../src/services/tierClassifier.ts");
  const tier = (t: string) => classifyTier(t)?.letter;
  assert.equal(tier("hi"), "L");
  assert.equal(tier("Now add jest tests for it."), "N");
  assert.equal(tier("login page ekak hadanna react walin"), "N");
  assert.equal(
    tier(
      "There is a race condition when two IDE windows save sessions concurrently. Redesign the index writes to be safe across processes.",
    ),
    "H",
  );
});
