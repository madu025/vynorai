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
