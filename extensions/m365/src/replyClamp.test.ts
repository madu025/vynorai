import assert from "node:assert/strict";
import { test } from "node:test";
import { clampReply } from "./replyClamp.js";

const five = ["- a", "- b", "- c", "- d", "- e"].join("\n");

test("the first three bullets show and the rest wait behind Show more", () => {
  const result = clampReply(five);
  assert.equal(result.hiddenCount, 2);
  assert.deepEqual(
    result.lines.map((line) => line.extra),
    [false, false, false, true, true],
  );
});

test("short answers and plain text are untouched", () => {
  assert.equal(clampReply("- a\n- b").hiddenCount, 0);
  assert.equal(clampReply("Just one sentence.").hiddenCount, 0);
});

test("a bullet with a warning word is never hidden", () => {
  const text = "- a\n- b\n- c\n- d is fine\n- 21 rows say Not found\n- f";
  const lines = clampReply(text).lines;
  assert.equal(lines[3].extra, true);
  assert.equal(lines[4].extra, false);
  assert.equal(lines[5].extra, true);
});

test("the closing question is always shown and the text is kept in order", () => {
  const text = `${five}\n- Want a chart?`;
  const result = clampReply(text);
  assert.equal(result.lines[result.lines.length - 1].extra, false);
  assert.equal(result.lines.map((l) => l.text).join("\n"), text);
});
