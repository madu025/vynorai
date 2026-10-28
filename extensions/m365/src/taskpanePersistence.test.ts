import assert from "node:assert/strict";
import {
  parseResultGallery,
  serializeResultGallery,
} from "./taskpanePersistence.js";

const raw = serializeResultGallery(
  "plan-1",
  [
    {
      kind: "chart",
      name: "Sales chart",
      targetSheet: "Results",
      status: "created",
      request: "make a chart",
      sourceRange: "A1:B3",
      previewPlanId: "preview-1",
      createdSheet: true,
      createdNames: Array.from({ length: 25 }, (_, index) => `Name${index}`),
      warnings: ["not persisted"],
    },
  ],
  40,
);
const restored = parseResultGallery(raw, new Set(["Results"]), 40);
assert.equal(restored?.planId, "plan-1");
assert.equal(restored?.results.length, 1);
assert.equal(restored?.results[0].targetSheet, "Results");
assert.equal(restored?.results[0].createdNames?.length, 20);
assert.equal(restored?.results[0].warnings, undefined);
assert.equal(
  parseResultGallery(raw, new Set(["Other"]), 40)?.results.length,
  0,
);
assert.equal(
  parseResultGallery("not-json", new Set(["Results"]), 40),
  undefined,
);
assert.equal(parseResultGallery(null, new Set(["Results"]), 40), undefined);
console.log("taskpanePersistence tests passed");
