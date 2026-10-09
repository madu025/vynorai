import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-idecache-")));

let server: import("node:http").Server;
let baseUrl = "";

before(async () => {
  const { authRouter } = await import("../src/routes/auth.js");
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

// Real HTTP against the real router: a rejected request must not be cached
// either, since the code and state in it are credentials.
for (const route of ["/api/auth/ide-exchange", "/api/auth/ide-code"]) {
  test(`${route} sends Cache-Control: no-store even when the body is invalid`, async () => {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "invalid", state: "invalid" }),
    });
    assert.ok(response.status >= 400 && response.status < 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}
