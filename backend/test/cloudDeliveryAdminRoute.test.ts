import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-cloud-admin-"));
const originalCwd = process.cwd();
const adminSecret = "vynor-cloud-admin-test-secret-2026";
let dbm: typeof import("../src/db.js");
let server: import("node:http").Server;
let baseUrl = "";

before(async () => {
  process.chdir(tempDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = adminSecret;
  process.env.DB_DRIVER = "sqlite";
  delete process.env.DATABASE_URL;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  const express = (await import("express")).default;
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
});

const headers = {
  "content-type": "application/json",
  "x-admin-secret": adminSecret,
};
const receipt = "a".repeat(64);

test("admin cloud delivery API keeps approval and transition gates server-side", async () => {
  const created = await fetch(`${baseUrl}/admin/cloud-delivery/manifests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runId: "22222222-2222-4222-8222-222222222222",
      taskId: "task-route",
      owner: "vynor",
      repo: "VynorAI",
      baseBranch: "main",
      headBranch: "cloud/task-route",
      baseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      mode: "pr_only",
      verificationDigest: receipt,
    }),
  });
  assert.equal(created.status, 201);
  const manifest = (await created.json()).manifest;

  for (const state of ["sandboxed", "verified", "awaiting_approval"]) {
    const response = await fetch(
      `${baseUrl}/admin/cloud-delivery/manifests/${manifest.runId}/transition`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ state }),
      },
    );
    assert.equal(response.status, 200);
  }

  const bypass = await fetch(
    `${baseUrl}/admin/cloud-delivery/manifests/${manifest.runId}/transition`,
    { method: "POST", headers, body: JSON.stringify({ state: "approved" }) },
  );
  assert.equal(bypass.status, 400);

  const approved = await fetch(
    `${baseUrl}/admin/cloud-delivery/manifests/${manifest.runId}/approve`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        actor: "admin@vynor.lk",
        scope: "cloud-pr",
        approvedAt: new Date().toISOString(),
        receiptDigest: receipt,
      }),
    },
  );
  assert.equal(approved.status, 200);
  const body = (await approved.json()).manifest;
  assert.equal(body.state, "approved");
  assert.equal(body.approval.receiptDigest, receipt);
});
