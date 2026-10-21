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

test("an empty chat scrolls the chat area to the top", () => {
  const calls: unknown[] = [];
  scrollToLatestMessage(
    {
      querySelector: (selector) =>
        selector === "#scroll-area"
          ? { scrollTo: (options: object) => calls.push(["area", options]) }
          : { lastElementChild: null },
    },
    { scrollTo: (options) => calls.push(["window", options]) },
  );
  assert.deepEqual(calls, [["area", { top: 0 }]]);
  scrollToLatestMessage({ querySelector: () => null }, { scrollTo: (o) => calls.push(o) });
  assert.equal(calls.length, 2, "without a chat area the window is the fallback");
});
