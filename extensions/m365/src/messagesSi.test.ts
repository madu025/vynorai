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
  assert.match(
    localizeMessage("si", "Writing result rows: 500/1201..."),
    /500\/1201/,
  );
  assert.match(
    localizeMessage(
      "si",
      "Preview cancelled. Nothing has changed in your workbook.",
    ),
    /පෙරදසුන අවලංගු/,
  );
  assert.match(
    localizeMessage(
      "si",
      "3 formula cell(s), 0 error cell(s), 0 possible direct circular reference(s), 1 inconsistent formula(s), 1 hard-coded numeric cell(s).",
    ),
    /අසමාන formulas 1ක්/,
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

test("the team, usage and privacy lines are Sinhala, with the inner label too", () => {
  const si = (text: string) => localizeMessage("si", text);
  assert.match(si("Team: Looking at the workbook"), /කණ්ඩායම: වැඩපොත බලමින්/);
  assert.match(
    si("Used about 12,345 tokens (80% of the input from cache)."),
    /tokens ආසන්න වශයෙන් 12,345ක්/,
  );
  assert.match(
    si(
      "Planner (3 steps), builder and 2 reviewer(s) checked the plan: no problems found.",
    ),
    /සැලසුම්කරු \(පියවර 3\).*ගැටලු නැත/,
  );
  assert.match(si("3 agents worked on this."), /agents 3 දෙනා මේ සඳහා වැඩ කළා/);
  assert.match(
    si(
      "Sent to the AI: 1,200 characters; 2 personal value(s) replaced with tokens, and put back only here.",
    ),
    /අක්ෂර 1,200ක්; පෞද්ගලික අගයන් 2ක්/,
  );
  assert.match(
    si("Sent to the AI: 90 characters; no personal values found to replace."),
    /අක්ෂර 90ක්.*නොමැත/,
  );
});

test("staged step lines and the before/after heading are Sinhala", () => {
  const si = (text: string) => localizeMessage("si", text);
  assert.match(
    si("Fill 'Orders'!L2:L301 with: =G2*H2 (header \"Total\")"),
    /'Orders'!L2:L301 පුරවන්න: =G2\*H2/,
  );
  assert.match(si("Write in 'S'!A1: =SUM(B:B)"), /'S'!A1 හි ලියන්න/);
  assert.match(si('Add a new sheet "Summary"'), /අලුත් පත්‍රිකාවක්/);
  assert.match(si("Before and after (36 of 300 cells)"), /සෛල 300න් 36ක්/);
  assert.match(si("Excel computed =SUM(A:A)"), /Excel ගණනය කළා/);
});

test("the workbook map words are Sinhala", () => {
  const si = (text: string) => localizeMessage("si", text);
  assert.equal(si("many-to-many"), "බොහෝ-බොහෝ");
  assert.match(si("40 duplicate keys"), /යතුරු 40ක්/);
  assert.match(si("0 unmatched rows"), /පේළි 0ක්/);
  assert.equal(si("Keys are consistent"), "යතුරු ගැලපේ");
});

test("the reading-progress line is fully Sinhala (the general Reading rule must not take it)", () => {
  assert.equal(
    localizeMessage("si", "Reading selected rows: 41/41..."),
    "තෝරාගත් පේළි කියවමින්: 41/41...",
  );
  assert.doesNotMatch(
    localizeMessage("si", "Reading selected rows: 500/2000..."),
    /[A-Za-z]{3,}/,
  );
});

test("the suggestion outputs, the before/after table headers and the ideas texts are translated (si)", () => {
  for (const line of [
    "Chart result",
    "Dashboard sheet",
    "Quality report",
    "Formula audit",
    "Forecast report",
    "Clean result sheet",
    "Cell",
    "Now",
    "After approval",
    "Ideas for the selected columns",
    "Agree",
    "Cancel",
    "Add",
    "Replace",
    "Confirm",
    "(empty)",
    "The AI is still working on the last request. Try again when it finishes.",
    "The selection changed, so those ideas were dropped. Tap More ideas again.",
  ])
    assert.notEqual(localizeMessage("si", line), line, line);
});

test("the apply progress line is localized with its change description (si)", () => {
  const line = localizeMessage(
    "si",
    'Applying 2 of 5: Add a new sheet "Summary"',
  );
  assert.match(line, /2\/5/);
  assert.notEqual(line, 'Applying 2 of 5: Add a new sheet "Summary"');
  assert.doesNotMatch(line, /Applying/);
});
