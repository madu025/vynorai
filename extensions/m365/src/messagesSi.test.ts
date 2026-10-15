import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeMessage } from "./i18n.js";
import { previewSummarySi } from "./messagesSi.js";

test("known messages are rendered in Sinhala and unknown ones stay English", () => {
  assert.match(
    localizeMessage(
      "si",
      "Preview ready. Nothing has changed yet. Review it before applying.",
    ),
    /පෙරදසුන සූදානම්/,
  );
  assert.match(
    localizeMessage("si", "Reading selected rows: 500/2000..."),
    /500\/2000/,
  );
  assert.equal(localizeMessage("si", "Some unknown text"), "Some unknown text");
  assert.equal(localizeMessage("en", "Nothing was sent."), "Nothing was sent.");
});

test("the preview summary is built in Sinhala from structured parts", () => {
  const text = previewSummarySi({
    actions: ["format"],
    sheets: ["Sheet1_Vynor_Format"],
    rows: 5,
    columns: 4,
    warnings: [],
  });
  assert.match(text, /හැඩසවි කිරීම/);
  assert.match(text, /දත්ත පේළි 5ක්/);
});
