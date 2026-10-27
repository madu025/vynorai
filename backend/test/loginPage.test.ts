import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const page = fs.readFileSync(
  path.join(process.cwd(), "public", "login.html"),
  "utf8",
);

test("login page compacts for narrow Office dialog windows", () => {
  assert.match(page, /body\.compact-login \.page-wrapper/);
  assert.match(page, /body\.compact-login \.left-panel\{display:none\}/);
  assert.match(page, /window\.outerWidth/);
  assert.match(page, /classList\.toggle\('compact-login'/);
});
