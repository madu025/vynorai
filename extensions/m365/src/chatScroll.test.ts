import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollToLatestMessage } from "./chatScroll.js";

test("a chat with messages opens at its newest message", () => {
  const calls: unknown[] = [];
  const last = { scrollIntoView: (options: object) => calls.push(options) };
  scrollToLatestMessage(
    { querySelector: () => ({ lastElementChild: last }) },
    { scrollTo: () => calls.push("top") },
  );
  assert.deepEqual(calls, [{ block: "end" }]);
});

test("an empty chat goes to the top", () => {
  const calls: unknown[] = [];
  scrollToLatestMessage(
    { querySelector: () => ({ lastElementChild: null }) },
    { scrollTo: (options) => calls.push(options) },
  );
  assert.deepEqual(calls, [{ top: 0 }]);
  scrollToLatestMessage({ querySelector: () => null }, { scrollTo: (o) => calls.push(o) });
  assert.equal(calls.length, 2);
});
