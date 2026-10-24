import assert from "node:assert/strict";
import { test } from "node:test";
import { percentMisfit, percentSampleBlocks } from "./formatGuard.js";

test("a huge range is sampled at its start, middle and end within the budget", () => {
  const blocks = percentSampleBlocks(20_000, 10);
  assert.deepEqual(
    blocks.map((b) => b.start),
    [0, 9950, 19900],
  );
  assert.ok(blocks.every((b) => b.count * 10 <= 10_000));
  assert.deepEqual(percentSampleBlocks(200, 2), [{ start: 0, count: 200 }]);
  assert.ok(percentSampleBlocks(100_000, 16_384).every((b) => b.count >= 1));
});

test("a percent misfit in the middle of a huge range is found from the sample", () => {
  const rows = Array.from({ length: 20_000 }, (_, i) => [
    i === 10_000 ? 157400 : 0.2,
  ]);
  const sample = percentSampleBlocks(rows.length, 1).flatMap((b) =>
    rows.slice(b.start, b.start + b.count),
  );
  assert.equal(percentMisfit("0.0%", sample), true);
});

test("a percent format over amounts is a misfit, over shares it is not", () => {
  assert.equal(percentMisfit("0.0%", [[157400], [199310]]), true);
  assert.equal(percentMisfit("0.0%", [[0.31], [0.274], [""]]), false);
  assert.equal(percentMisfit("0.0%", [[1.5], [0.5]]), false);
  assert.equal(percentMisfit("#,##0", [[157400]]), false);
  assert.equal(percentMisfit([["0.0%"]], [[157400]]), true);
  assert.equal(percentMisfit('0.0"%"', [[31.1], [27.4]]), false);
});
