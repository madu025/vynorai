import assert from "node:assert/strict";
import { test } from "node:test";
import { SINHALA_MESSAGE_KEYS, localizeMessageSi } from "./messagesSi.js";
import {
  TAMIL_MESSAGE_KEYS,
  localizeMessageTa,
  previewSummaryTa,
} from "./messagesTa.js";

const TAMIL = /[஀-௿]/;
const SINHALA = /[඀-෿]/;

test("every Sinhala message key has a Tamil translation, in the same order", () => {
  assert.deepEqual(TAMIL_MESSAGE_KEYS, SINHALA_MESSAGE_KEYS);
});

test("Tamil values are in Tamil script except where Sinhala also keeps English", () => {
  for (const key of TAMIL_MESSAGE_KEYS) {
    const ta = localizeMessageTa(key);
    const si = localizeMessageSi(key);
    if (SINHALA.test(si)) {
      assert.match(ta, TAMIL, `no Tamil script for: ${key}`);
    } else {
      assert.equal(ta, si, `product name should match Sinhala for: ${key}`);
    }
  }
});

test("known messages are rendered in Tamil and unknown ones stay English", () => {
  assert.match(
    localizeMessageTa(
      "Preview ready. Nothing has changed yet. Review it before applying.",
    ),
    /முன்னோட்டம் தயார்/,
  );
  assert.equal(
    localizeMessageTa("Writing result rows: 3/10..."),
    "முடிவு வரிசைகளை எழுதுகிறது: 3/10...",
  );
  assert.match(
    localizeMessageTa("Reading selected rows: 500/2000..."),
    /500\/2000/,
  );
  assert.match(
    localizeMessageTa(
      "3 formula cell(s), 0 error cell(s), 0 possible direct circular reference(s), 1 inconsistent formula(s), 1 hard-coded numeric cell(s).",
    ),
    /பொருந்தாத formulas 1/,
  );
  assert.match(
    localizeMessageTa("VynorAI request failed (503). See Diagnostics."),
    /\(503\)/,
  );
  assert.equal(localizeMessageTa("Some unknown text"), "Some unknown text");
});

test("the source-unchanged flag maps yes and NO to Tamil", () => {
  assert.match(
    localizeMessageTa("Applied: chart. Source data unchanged: yes."),
    /: ஆம்\.$/,
  );
  assert.match(
    localizeMessageTa("Applied: chart. Source data unchanged: NO. Extra note."),
    /இல்லை — சரிபார்க்கவும்\. Extra note\.$/,
  );
});

test("the preview summary is built in Tamil from structured parts", () => {
  const text = previewSummaryTa({
    actions: ["format", "pivot-table"],
    sheets: ["Sheet1_Vynor_Format"],
    rows: 5,
    columns: 4,
    warnings: ["Check dates."],
  });
  assert.equal(
    text,
    "வடிவமைப்பு, PivotTable — Sheet1_Vynor_Format தாளில். 5 தரவு வரிசைகள், 4 நெடுவரிசைகள். உங்கள் மூலத் தரவு மாறாது. Check dates.",
  );
});

test("the reading-progress line is fully Tamil (the general Reading rule must not take it)", () => {
  const line = localizeMessageTa("Reading selected rows: 41/41...");
  assert.match(line, TAMIL);
  assert.doesNotMatch(line, /[A-Za-z]{3,}/);
  assert.match(line, /41\/41/);
});

test("the suggestion outputs, the before/after table headers and the ideas texts are translated (ta)", () => {
  for (const line of ["Chart result", "Dashboard sheet", "Quality report", "Formula audit", "Forecast report", "Clean result sheet", "Cell", "Now", "After approval", "Ideas for the selected columns", "Agree", "Cancel", "Add", "Replace", "Confirm", "(empty)", "The AI is still working on the last request. Try again when it finishes.", "The selection changed, so those ideas were dropped. Tap More ideas again."])
    assert.notEqual(localizeMessageTa(line), line, line);
});

test("the apply progress line is localized with its change description (ta)", () => {
  const line = localizeMessageTa("Applying 2 of 5: Add a new sheet \"Summary\"");
  assert.match(line, /2\/5/);
  assert.notEqual(line, "Applying 2 of 5: Add a new sheet \"Summary\"");
  assert.doesNotMatch(line, /Applying/);
});
