import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractWebMentions,
  isPrivateAddress,
} from "../src/services/webSearch.js";

test("only explicit @url / @web links are fetched", () => {
  assert.deepEqual(
    extractWebMentions("stack: at http://localhost:3000/app.js:12 failed").urls,
    [],
  );
  assert.deepEqual(
    extractWebMentions("@url https://nodejs.org/api/test.html please").urls,
    ["https://nodejs.org/api/test.html"],
  );
  assert.deepEqual(extractWebMentions("@web node test runner\n").queries, [
    "node test runner",
  ]);
});

test("private and metadata addresses are refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.5",
    "172.20.0.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "104.21.3.4", "2606:4700::1"])
    assert.equal(isPrivateAddress(ip), false, ip);
});
