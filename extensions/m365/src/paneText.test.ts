import assert from "node:assert/strict";
import { test } from "node:test";
import { doneSentence } from "./paneText.js";

const created = [{ kind: "chart", targetSheet: "Sales", status: "created" }];

test("an apply says Applied and tells how to undo it", () => {
  const text = doneSentence(created, true, "en");
  assert.match(text, /^Applied\./);
  assert.match(text, /Undo puts everything back\.$/);
});

test("nothing created gives no undo hint", () => {
  assert.doesNotMatch(doneSentence([], true, "en"), /Undo/);
});

test("the Sinhala apply sentence starts with the applied word", () => {
  assert.match(doneSentence(created, true, "si"), /^යොදන ලදී\./);
});
