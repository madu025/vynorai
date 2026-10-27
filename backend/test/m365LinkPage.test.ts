import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const page = fs.readFileSync(
  path.join(process.cwd(), "public", "link.html"),
  "utf8",
);

test("M365 link page preserves the secure handoff across sign-in", () => {
  assert.match(page, /meta name="referrer" content="no-referrer"/i);
  assert.match(page, /meta name="robots" content="noindex"/i);
  assert.match(page, /window\.location\.hash/);
  assert.match(page, /vynor_m365_link_code/);
  assert.match(page, /\/login\?next=\/link/);
  assert.match(page, /\/login\?next=\/link&mode=register/);
  assert.match(page, /\/v1\/m365\/link\/preview/);
  assert.match(page, /\/v1\/m365\/link\/confirm/);
  assert.match(page, /confirm: true/);
  assert.match(page, /id="closeBtn"/);
  assert.match(page, /window\.close\(\)/);
  // The one-time code must not be sent in the page's initial URL query string.
  assert.doesNotMatch(page, /location\.search[^;]*code/);
});
