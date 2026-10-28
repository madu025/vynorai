import assert from "node:assert/strict";
import { test } from "node:test";
import {
  base64Bytes,
  editDistance,
  escapeEmailHtml,
  signInDialogMessage,
  splitEmailAddresses,
} from "./taskpanePrimitives.js";

test("task-pane primitives keep transport and text behavior deterministic", () => {
  assert.equal(editDistance("Region", "Regoin"), 2);
  assert.deepEqual(
    splitEmailAddresses("a@example.com; b@example.com c@example.com"),
    ["a@example.com", "b@example.com", "c@example.com"],
  );
  assert.equal(escapeEmailHtml(`<x a='1'>&`), "&lt;x a=&#39;1&#39;&gt;&amp;");
  assert.equal(base64Bytes("YWJj"), 3);
  assert.match(signInDialogMessage(12009), /blocked/i);
});
