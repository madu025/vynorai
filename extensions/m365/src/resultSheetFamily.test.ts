import assert from "node:assert/strict";
import { test } from "node:test";
import { isOlderVersionOf, resultSheetFamily } from "./resultSheetFamily.js";

test("numbered copies belong to one family, other results do not", () => {
  assert.equal(resultSheetFamily("Dashboard Sales (3)"), "dashboard sales");
  assert.equal(
    isOlderVersionOf("Dashboard Sales", "Dashboard Sales (2)"),
    true,
  );
  assert.equal(
    isOlderVersionOf("Dashboard Sales (2)", "Dashboard Sales (3)"),
    true,
  );
  assert.equal(
    isOlderVersionOf("Region Summary", "Dashboard Sales (2)"),
    false,
  );
  assert.equal(
    isOlderVersionOf("Dashboard Sales (2)", "Dashboard Sales (2)"),
    false,
  );
});
