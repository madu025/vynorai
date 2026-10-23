import assert from "node:assert/strict";
import { test } from "node:test";
import { canCancelPreview } from "./previewCancel.js";

test("Cancel works on an unapplied preview only", () => {
  assert.equal(
    canCancelPreview({ hasPreview: true, applying: false, applied: false }),
    true,
  );
  assert.equal(
    canCancelPreview({ hasPreview: false, applying: false, applied: false }),
    false,
  );
  assert.equal(
    canCancelPreview({ hasPreview: true, applying: true, applied: false }),
    false,
  );
  assert.equal(
    canCancelPreview({ hasPreview: true, applying: false, applied: true }),
    false,
  );
});
