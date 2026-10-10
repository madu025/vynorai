import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-outcomes-"));

test("task outcomes: stored as counts only, validated, retained 180 days", async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  const dbm = await import("../src/db.js");
  await dbm.initDb();
  const quota = await import("../src/services/monthlyQuota.js");
  const { proxyRouter } = await import("../src/routes/proxy.js");
  const { RETENTION_DAYS } = await import("../src/services/retention.js");

  const userId = "outcome-user";
  const apiKey = `vynor_live_${crypto.randomBytes(24).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'hash', ?, ?)",
    [userId, "o@example.com", apiKey, hash],
  );
  const validUntil = new Date(Date.now() + 30 * 86_400_000);
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, currency, valid_until)
     VALUES (?, ?, 'pro', 'active', 'order-o', 'LKR', ?)`,
    [crypto.randomUUID(), userId, validUntil.toISOString()],
  );
  await quota.startPaidCycle(userId, "pro", validUntil);

  const app = express();
  app.use(express.json());
  app.use("/v1", proxyRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const post = (body: unknown, auth = true) =>
    fetch(`${base}/task-outcomes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

  try {
    const ok = await post({
      outcome: "completed_unverified",
      mode: "agent",
      rounds: 7,
      credits: 1234,
      edited: true,
      verified: false,
      client: "1.2.58",
      // Extra fields must never be stored.
      prompt: "SECRET PROMPT TEXT",
      filepath: "C:/secret/project/file.ts",
    });
    assert.equal(ok.status, 200);

    const rows = await dbm.dbAll<any>(
      "SELECT * FROM task_outcomes WHERE user_id = ?",
      [userId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "completed_unverified");
    assert.equal(rows[0].rounds, 7);
    assert.equal(rows[0].credits, 1234);
    assert.equal(rows[0].edited, 1);
    assert.equal(rows[0].verified, 0);
    const dump = JSON.stringify(rows);
    assert.equal(dump.includes("SECRET PROMPT TEXT"), false);
    assert.equal(dump.includes("secret/project"), false);

    const bad = await post({ outcome: "hacked" });
    assert.equal(bad.status, 400);
    const noAuth = await post({ outcome: "completed" }, false);
    assert.ok(noAuth.status === 401 || noAuth.status === 403);

    assert.equal(RETENTION_DAYS.task_outcomes, 180);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
