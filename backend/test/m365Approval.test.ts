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
    const { dbGet, initDb } = await import("../src/db.js");
    const {
      consumeM365ApprovalToken,
      createM365ApprovalToken,
      reportM365ApprovalResult,
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
    await reportM365ApprovalResult(token, expected, {
      status: "partial_failure",
      sourceUnchanged: true,
      actionCount: 2,
      failureCount: 1,
    });
    const receipt = await dbGet<{
      result_status: string;
      source_unchanged: number;
      action_count: number;
      failure_count: number;
    }>(
      "SELECT result_status, source_unchanged, action_count, failure_count FROM m365_approval_uses WHERE plan_id = ?",
      [expected.planId],
    );
    assert.deepEqual(receipt, {
      result_status: "partial_failure",
      source_unchanged: 1,
      action_count: 2,
      failure_count: 1,
    });
    await assert.rejects(
      reportM365ApprovalResult(token, expected, {
        status: "applied",
        sourceUnchanged: true,
        actionCount: 2,
        failureCount: 0,
      }),
      /approval_result_unavailable/,
    );
  } finally {
    if (process.env.DATABASE_URL)
      await (await import("../src/services/pgDriver.js")).closePostgres();
    process.chdir(previousDirectory);
    process.env = previousEnv;
  }
});
