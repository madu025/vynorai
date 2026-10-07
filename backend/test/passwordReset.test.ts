import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-password-reset-"));
const originalCwd = process.cwd();
const ADMIN_PASSWORD = "OldPassword!123";
const RESET_PASSWORD = "NewPassword!456";

let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "password-reset-test-secret-at-least-32-chars";
  dbm = await import("../src/db.js");
  await dbm.initDb();
  await dbm.dbRun(
    `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "reset-user",
      "reset@example.com",
      await bcrypt.hash(ADMIN_PASSWORD, 4),
      "key-reset-user",
      crypto.createHash("sha256").update("key-reset-user").digest("hex"),
      "Reset User",
    ],
  );

  const express = (await import("express")).default;
  const { authRouter } = await import("../src/routes/auth.js");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});

async function post(pathname: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/auth${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as any };
}

test("forgot-password does not reveal whether an account exists", async () => {
  const known = await post("/forgot-password", { email: "reset@example.com" });
  const unknown = await post("/forgot-password", {
    email: "missing@example.com",
  });
  assert.equal(known.response.status, 200);
  assert.equal(unknown.response.status, 200);
  assert.deepEqual(known.body, unknown.body);
  const rows = await dbm.dbAll<any>(
    "SELECT token_hash FROM password_reset_tokens WHERE user_id = ?",
    ["reset-user"],
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);
});

test("reset token changes the password once and rejects replay", async () => {
  const token = "a".repeat(64);
  await dbm.dbRun("DELETE FROM password_reset_tokens WHERE user_id = ?", [
    "reset-user",
  ]);
  await dbm.dbRun(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [
      "reset-token",
      "reset-user",
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 60_000).toISOString(),
    ],
  );

  const weak = await post("/reset-password", {
    token,
    newPassword: "short",
  });
  assert.equal(weak.response.status, 400);

  const changed = await post("/reset-password", {
    token,
    newPassword: RESET_PASSWORD,
  });
  assert.equal(changed.response.status, 200);
  const user = await dbm.dbGet<any>(
    "SELECT password_hash FROM users WHERE id = ?",
    ["reset-user"],
  );
  assert.equal(await bcrypt.compare(RESET_PASSWORD, user.password_hash), true);
  assert.equal(await bcrypt.compare(ADMIN_PASSWORD, user.password_hash), false);

  const replay = await post("/reset-password", {
    token,
    newPassword: "AnotherPassword!789",
  });
  assert.equal(replay.response.status, 400);
});

test("two concurrent reset attempts can consume a token only once", async () => {
  const token = "b".repeat(64);
  await dbm.dbRun("DELETE FROM password_reset_tokens WHERE user_id = ?", [
    "reset-user",
  ]);
  await dbm.dbRun(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [
      "concurrent-reset-token",
      "reset-user",
      crypto.createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 60_000).toISOString(),
    ],
  );
  const attempts = await Promise.all([
    post("/reset-password", { token, newPassword: "ConcurrentPassword!1" }),
    post("/reset-password", { token, newPassword: "ConcurrentPassword!2" }),
  ]);
  assert.deepEqual(
    attempts.map(({ response }) => response.status).sort(),
    [200, 400],
  );
});
