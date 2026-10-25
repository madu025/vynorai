import assert from "node:assert/strict";
import test from "node:test";
import { openExternalPage } from "./openExternalPage.js";

test("opens in a new tab without a noopener feature string and cuts the opener link", () => {
  const calls: Array<[string, string | undefined]> = [];
  const handle = { opener: "pane" as unknown };
  const ok = openExternalPage(
    {
      open(url, target) {
        calls.push([url, target]);
        return handle;
      },
    },
    "https://vynor.lk/link#code=ABCD",
  );
  assert.equal(ok, true);
  assert.deepEqual(calls, [["https://vynor.lk/link#code=ABCD", "_blank"]]);
  assert.equal(handle.opener, null);
});

test("reports a blocked tab", () => {
  assert.equal(
    openExternalPage({ open: () => null }, "https://vynor.lk/link"),
    false,
  );
});

test("a handle that refuses the opener write still counts as opened", () => {
  const handle = {
    set opener(_value: unknown) {
      throw new Error("blocked");
    },
    get opener() {
      return "pane";
    },
  };
  assert.equal(
    openExternalPage({ open: () => handle }, "https://vynor.lk/link"),
    true,
  );
});
