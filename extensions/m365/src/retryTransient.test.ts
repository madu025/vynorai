import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransient, retryTransient } from "./retryTransient.js";

const coded = (code: string) => Object.assign(new Error(code), { code });

test("only busy-service and network errors are worth another try", () => {
  for (const code of [
    "HTTP_502",
    "HTTP_503",
    "HTTP_504",
    "HTTP_429",
    "HTTP_522",
    "HTTP_525",
    "NETWORK_ERROR",
  ])
    assert.equal(isTransient(coded(code)), true, code);
  for (const code of [
    "HTTP_403",
    "HTTP_520",
    "HTTP_524",
    "HTTP_401",
    "CREDITS_EXHAUSTED",
    "REQUEST_ABORTED",
    "approval_mismatch",
  ])
    assert.equal(isTransient(coded(code)), false, code);
  assert.equal(isTransient(new Error("stopped")), false);
  assert.equal(isTransient("x"), false);
});

test("a busy service is retried with growing waits, then succeeds", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await retryTransient(
    async () => {
      calls += 1;
      if (calls < 3) throw coded("HTTP_503");
      return "ok";
    },
    { tries: 3, delays: [100, 300], wait: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 300]);
});

test("it gives up after the last try and keeps the original error", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls += 1;
        throw coded("HTTP_503");
      },
      { tries: 3, delays: [1, 1], wait: async () => {} },
    ),
    (error: any) => error.code === "HTTP_503",
  );
  assert.equal(calls, 3);
});

test("a refusal or a stop is never retried", async () => {
  for (const code of ["HTTP_403", "CREDITS_EXHAUSTED", "REQUEST_ABORTED"]) {
    let calls = 0;
    await assert.rejects(
      retryTransient(
        async () => {
          calls += 1;
          throw coded(code);
        },
        { tries: 3, delays: [1, 1], wait: async () => {} },
      ),
    );
    assert.equal(calls, 1, code);
  }
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls += 1;
        throw coded("HTTP_503");
      },
      {
        tries: 3,
        delays: [1, 1],
        wait: async () => {},
        shouldStop: () => true,
      },
    ),
  );
  assert.equal(calls, 1, "pressing Stop ends the retries");
});
