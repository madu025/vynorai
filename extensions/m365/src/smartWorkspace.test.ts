import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseRunPath } from "./smartWorkspace.js";

test("every request goes to the agent when the account has AI", () => {
  assert.equal(chooseRunPath(true), "agent");
});

test("the built-in reader is only the fallback for an account without AI", () => {
  assert.equal(chooseRunPath(false), "local");
});
