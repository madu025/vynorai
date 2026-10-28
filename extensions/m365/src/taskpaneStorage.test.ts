import assert from "node:assert/strict";
import { createTaskpaneStorageKeys } from "./taskpaneStorage.js";

function token(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

const accessToken = token({ tid: "tenant-1", oid: "object-1" });
const keys = createTaskpaneStorageKeys({
  getAccessToken: () => accessToken,
  getWorkbookUrl: () => "https://example.test/book.xlsx",
});

assert.match(
  keys.conversation() ?? "",
  /^vynorai\.m365\.excel\.conversation\.v1\./,
);
assert.match(
  keys.results() ?? "",
  /^vynorai\.m365\.excel\.results\.v1\.tenant-1\.object-1\./,
);
assert.match(
  keys.scheduledRefresh() ?? "",
  /^vynorai\.m365\.excel\.schedule\.v1\.tenant-1\.object-1\./,
);
assert.equal(keys.workbook(), keys.results()?.split(".").at(-1));

const noIdentity = createTaskpaneStorageKeys({
  getAccessToken: () => undefined,
  getWorkbookUrl: () => "https://example.test/book.xlsx",
});
assert.equal(noIdentity.conversation(), undefined);
assert.equal(noIdentity.results(), undefined);
assert.equal(noIdentity.scheduledRefresh(), undefined);

const noWorkbook = createTaskpaneStorageKeys({
  getAccessToken: () => accessToken,
  getWorkbookUrl: () => undefined,
});
assert.equal(noWorkbook.results(), undefined);
assert.equal(noWorkbook.scheduledRefresh(), undefined);

console.log("taskpaneStorage tests passed");
