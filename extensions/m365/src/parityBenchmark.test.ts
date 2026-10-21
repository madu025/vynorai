import assert from "node:assert/strict";
import { test } from "node:test";
import { runBenchmark } from "../test/batch/benchmark.js";

// The Copilot-parity benchmark (test/batch/benchmark.ts) as a regression guard: every business
// request over the five benchmark workbooks must still pass every check, on desktop and on the web.
test("the Copilot-parity benchmark passes every check", async () => {
  const results = await runBenchmark();
  assert.equal(results.length, 74);
  const failed = results.flatMap((result) =>
    result.checks
      .filter((item) => !item.pass)
      .map(
        (item) =>
          `${result.id}/${result.dataset}/${result.host}: ${item.name} (${item.detail ?? ""})`,
      ),
  );
  assert.deepEqual(failed, []);
});
