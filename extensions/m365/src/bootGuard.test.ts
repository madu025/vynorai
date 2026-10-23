import assert from "node:assert/strict";
import { test } from "node:test";

test("a second copy of the bundle stops before it starts the pane", async () => {
  const scope = globalThis as unknown as { window?: object };
  scope.window = {};
  await import("./bootGuard.js?first");
  assert.equal(
    (scope.window as { __VYNOR_BOOTED__?: boolean }).__VYNOR_BOOTED__,
    true,
  );
  await assert.rejects(
    () => import("./bootGuard.js?second"),
    /VYNOR_DUPLICATE_BOOT/,
  );
  delete scope.window;
});
