import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-admin-auth-"));
const originalCwd = process.cwd();
const masterSecret = "vynorai_super_admin_secret_key_2026_secure";
const devSecret = "vynorai_admin_2026_change_me"; // 28 chars

let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = masterSecret;
  dbm = await import("../src/db.js");
  await dbm.initDb();

  const express = (await import("express")).default;
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  if (dbm.db) {
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  }
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});

test("Cloudflare Zero Trust Access: auto-unlocks session with zero secret key required", async () => {
  const res = await fetch(`${baseUrl}/admin/session`, {
    headers: {
      "cf-access-authenticated-user-email": "admin@vynor.lk",
      "cf-access-jwt-assertion":
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummy_cf_access_token",
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.authenticated, true);
  assert.equal(data.authMethod, "cloudflare_zero_trust");
  assert.equal(data.email, "admin@vynor.lk");
});

test("Cloudflare Zero Trust Access: allows access to protected /admin/health", async () => {
  const res = await fetch(`${baseUrl}/admin/health`, {
    headers: {
      "cf-access-authenticated-user-email": "admin@vynor.lk",
      "cf-access-jwt-assertion": "dummy_assertion",
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, "ok");
  assert.equal(data.version, "2.0.0");
});

test("Master Secret Key: authenticates successfully via x-admin-secret", async () => {
  const res = await fetch(`${baseUrl}/admin/session`, {
    headers: {
      "x-admin-secret": masterSecret,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.authenticated, true);
  assert.equal(data.authMethod, "secret_key");
});

test("Master Secret Key: unlocks protected routes like /admin/health", async () => {
  const res = await fetch(`${baseUrl}/admin/health`, {
    headers: {
      "x-admin-secret": masterSecret,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.status, "ok");
});

test("Dev Secret Key (28 chars): accepted in test/dev environment", async () => {
  // Temporarily switch ADMIN_SECRET to devSecret to verify non-prod length flexibility
  process.env.ADMIN_SECRET = devSecret;

  const res = await fetch(`${baseUrl}/admin/session`, {
    headers: {
      "x-admin-secret": devSecret,
    },
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.equal(data.authenticated, true);
  assert.equal(data.authMethod, "secret_key");

  // Restore masterSecret
  process.env.ADMIN_SECRET = masterSecret;
});

test("Invalid Secret Key: rejected with 401 Unauthorized", async () => {
  const res = await fetch(`${baseUrl}/admin/session`, {
    headers: {
      "x-admin-secret": "wrong_secret_key_12345678901234567890",
    },
  });

  assert.equal(res.status, 401);
  const data = (await res.json()) as any;
  assert.equal(data.authenticated, false);
});

test("No credentials: /admin/session returns 401", async () => {
  const res = await fetch(`${baseUrl}/admin/session`);
  assert.equal(res.status, 401);
  const data = (await res.json()) as any;
  assert.equal(data.authenticated, false);
});

test("No credentials: protected /admin/health returns 401", async () => {
  const res = await fetch(`${baseUrl}/admin/health`);
  assert.equal(res.status, 401);
});
