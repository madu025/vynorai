import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../pane.css", import.meta.url), "utf8");

test("account-link state keeps the connection card reachable in a short Excel task pane", () => {
  const start = css.indexOf('body[data-auth="link-required"] main {');
  assert.notEqual(start, -1, "link-required layout rule is missing");
  const block = css.slice(start, css.indexOf("}", start) + 1);
  assert.match(block, /overflow-x:\s*hidden/);
  assert.match(block, /overflow-y:\s*auto/);
  assert.doesNotMatch(block, /overflow:\s*hidden/);
});

test("the preview-open layout needs a visible card, and a blocking run reason is never hidden", () => {
  // Live run 2026-11-02: the idle result card is hidden, but its Apply/Cancel buttons are not, so
  // every "preview open" rule matched at idle. It shrank the request box, added a second scroll area
  // and hid "Your VynorAI Excel trial credits are exhausted" under a disabled Run button.
  const previewRules =
    css.match(/[^{}]*\.apply-dock button:not\(\[hidden\]\)[^{}]*\{/g) ?? [];
  assert.ok(previewRules.length >= 5, "preview-open rules are missing");
  for (const rule of previewRules)
    assert.match(rule, /\.card:not\(\[hidden\]\) \.apply-dock/, rule.trim());
  const gate =
    /\.apply-dock button:not\(\[hidden\]\)\)\s*>\s*\.composer\s*\.run-gate([^{]*)\{/.exec(
      css,
    );
  assert.ok(gate, "run-gate rule for an open preview is missing");
  assert.match(gate?.[1] ?? "", /data-reason="request_required"/);
  assert.match(css, /\.run-gate\[data-reason="credits_exhausted"\]/);
});

test("a preview table never splits a word or a number across lines in a narrow pane", () => {
  // Live run 2026-11-02: "Region" showed as "Regio n" and 14400 as "1440" over "0".
  const at = css.lastIndexOf('body[data-auth="in"] .outcome th,');
  assert.notEqual(at, -1);
  const cells = css.slice(at, css.indexOf("}", at) + 1);
  assert.match(cells, /white-space:\s*nowrap/);
  const table = css.slice(
    css.lastIndexOf('body[data-auth="in"] .outcome table {'),
  );
  assert.match(table.slice(0, table.indexOf("}")), /overflow-x:\s*auto/);
});
