import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RUN_CODE_MAX_CELLS,
  checkCode,
  runSandboxedCode,
  splitHeaders,
  workerSource,
} from "./codeSandbox.js";

import {
  NODE_PRELUDE as PRELUDE,
  nodeSandboxWorker as nodeWorker,
} from "../test/batch/nodeSandbox.js";

const run = (code: string, timeoutMs?: number) =>
  runSandboxedCode(
    {
      headers: ["Region", "Amount"],
      rows: [
        ["West", 100],
        ["East", "250"],
        ["West", 50],
      ],
      code,
    },
    { createWorker: nodeWorker, source: workerSource(PRELUDE), timeoutMs },
  );

test("run_code: groups and totals the real rows", async () => {
  const outcome = await run(`
    const totals = {};
    for (const r of records) totals[r.Region] = (totals[r.Region] ?? 0) + num(r.Amount);
    return totals;
  `);
  assert.deepEqual(outcome, { ok: true, result: { West: 150, East: 250 } });
});

test("run_code: col() and helpers; NaN becomes text, not a broken result", async () => {
  const outcome = await run(
    `return { sum: col("Amount").map(num).reduce((a, b) => a + b, 0), bad: num("x") };`,
  );
  assert.deepEqual(outcome, { ok: true, result: { sum: 400, bad: "NaN" } });
});

test("run_code: no network or code loading inside the sandbox", async () => {
  const outcome = await run(`
    const g = (() => {}).constructor("return globalThis")();
    return {
      fetch: typeof fetch, viaGlobal: typeof g.fetch, xhr: typeof XMLHttpRequest,
      ws: typeof WebSocket, importScripts: typeof importScripts, require: typeof g.require,
      process: typeof g.process,
    };
  `);
  assert.equal(outcome.ok, true);
  for (const [name, kind] of Object.entries(
    (outcome as { result: Record<string, string> }).result,
  ))
    assert.equal(kind, "undefined", `${name} must be gone`);
});

test("run_code: an endless loop is stopped at the time limit", async () => {
  const outcome = await run("while (true) {} return 1;", 300);
  assert.equal(outcome.ok, false);
  assert.match((outcome as { error: string }).error, /stopped/);
});

test("run_code: errors come back as text", async () => {
  const outcome = await run(`return col("Nope");`);
  assert.deepEqual(outcome, { ok: false, error: "No column named Nope." });
});

test("run_code: a huge result is cut with a note", async () => {
  const outcome = await run(`return "x".repeat(20000);`);
  assert.equal(outcome.ok, true);
  assert.match(String((outcome as { result: unknown }).result), /\(cut/);
});

test("run_code: too many cells are refused before a worker starts", async () => {
  let started = false;
  const outcome = await runSandboxedCode(
    {
      headers: ["A"],
      rows: Array.from({ length: RUN_CODE_MAX_CELLS + 1 }, () => [1]),
      code: "return 1;",
    },
    {
      createWorker: (source) => {
        started = true;
        return nodeWorker(source);
      },
    },
  );
  assert.equal(outcome.ok, false);
  assert.equal(started, false);
});

test("checkCode and splitHeaders", () => {
  assert.throws(() => checkCode(""), /Give the code/);
  assert.throws(() => checkCode("1 + 1"), /return/);
  assert.equal(checkCode(" return 1; "), "return 1;");
  assert.deepEqual(
    splitHeaders(
      [
        ["Amount", "", "Amount"],
        [1, 2, 3],
      ],
      true,
    ),
    { headers: ["Amount", "B", "Amount 2"], rows: [[1, 2, 3]] },
  );
  assert.deepEqual(splitHeaders([[1, 2]], false).headers, ["A", "B"]);
});
