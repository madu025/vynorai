const test = require("node:test");
const assert = require("node:assert");
test("module loads", () => {
  assert.ok(require("node:sqlite").DatabaseSync);
});
