import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("M365 workbook approval is single-use in the shared database", async () => {
  const previousDirectory = process.cwd();
  const previousEnv = { ...process.env };
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vynor-m365-approval-"),
  );
  process.chdir(temporaryDirectory);
  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: "m365-approval-test-secret-with-sufficient-length",
  });
  try {
    const { initDb } = await import("../src/db.js");
    const {
      consumeM365ApprovalToken,
      createM365ApprovalToken,
      verifyM365ApprovalToken,
    } = await import("../src/services/m365Policy.js");
    await initDb();
    const expected = {
      planId: "m365_plan_a",
      tenantId: "tenant-a",
      objectId: "object-a",
      sourceFingerprint: "a".repeat(64),
    };
    const token = createM365ApprovalToken(expected);

    assert.match(verifyM365ApprovalToken(token, expected).jti, /^[0-9a-f-]+$/i);
    await consumeM365ApprovalToken(token, expected);
    await assert.rejects(
      consumeM365ApprovalToken(token, expected),
      /approval_replayed/,
    );
  } finally {
    if (process.env.DATABASE_URL)
      await (await import("../src/services/pgDriver.js")).closePostgres();
    process.chdir(previousDirectory);
    process.env = previousEnv;
  }
});
