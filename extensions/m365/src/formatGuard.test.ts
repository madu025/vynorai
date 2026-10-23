import assert from "node:assert/strict";
import { test } from "node:test";
import { percentMisfit } from "./formatGuard.js";

test("a percent format over amounts is a misfit, over shares it is not", () => {
  assert.equal(percentMisfit("0.0%", [[157400], [199310]]), true);
  assert.equal(percentMisfit("0.0%", [[0.31], [0.274], [""]]), false);
  assert.equal(percentMisfit("0.0%", [[1.5], [0.5]]), false);
  assert.equal(percentMisfit("#,##0", [[157400]]), false);
  assert.equal(percentMisfit([["0.0%"]], [[157400]]), true);
});
