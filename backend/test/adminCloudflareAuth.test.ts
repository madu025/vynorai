import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-admin-auth-"));
const originalCwd = process.cwd();
const adminHtml = fs.readFileSync(
  new URL("../public/admin.html", import.meta.url),
  "utf8",
);
let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
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

test("Admin secret headers are never accepted; Cloudflare Access is the only admin gate", async () => {
  const res = await fetch(`${baseUrl}/admin/session`, {
    headers: {
      "x-admin-secret": "vynorai_super_admin_secret_key_2026_secure",
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

test("Admin UI has no origin secret or browser-secret session gate", () => {
  assert.match(adminHtml, /id="adminAccessGate"/);
  assert.doesNotMatch(
    adminHtml,
    /adminSecretInput|handleAdminLogin|adminLoginGate/,
  );
  assert.doesNotMatch(adminHtml, /x-admin-secret/);
  assert.doesNotMatch(
    adminHtml,
    /sessionStorage\.setItem\(['"]vynor_admin_secret/,
  );
  assert.match(adminHtml, /cdn-cgi\/access\/logout/);
});
