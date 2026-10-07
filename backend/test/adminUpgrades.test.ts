import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { adminRouter } from "../src/routes/admin.js";

function setupApp() {
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  return app;
}

test("Admin Upgrades Test Suite", async (t) => {
  const app = setupApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "test_super_secret_admin_key_32bytes!!";

  t.after(() => {
    server.close();
  });

  await t.test(
    "GET /admin/admission/status returns real-time snapshot with CF Zero Trust header",
    async () => {
      const res = await fetch(`${baseUrl}/admin/admission/status`, {
        headers: {
          "cf-access-authenticated-user-email": "admin@vynor.lk",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");
      assert.ok(body.snapshot);
      assert.equal(typeof body.snapshot.globalLimit, "number");
      assert.equal(typeof body.snapshot.localGlobalActive, "number");
    },
  );

  await t.test(
    "GET /admin/swarm/briefings returns briefings list",
    async () => {
      const res = await fetch(`${baseUrl}/admin/swarm/briefings`, {
        headers: {
          "x-admin-secret": "test_super_secret_admin_key_32bytes!!",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");
      assert.ok(Array.isArray(body.briefings));
    },
  );

  await t.test("POST /admin/swarm/run triggers background swarm", async () => {
    const res = await fetch(`${baseUrl}/admin/swarm/run`, {
      method: "POST",
      headers: {
        "x-admin-secret": "test_super_secret_admin_key_32bytes!!",
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "active");
  });

  await t.test("POST /admin/email/test validates email address", async () => {
    const res = await fetch(`${baseUrl}/admin/email/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": "test_super_secret_admin_key_32bytes!!",
      },
      body: JSON.stringify({ to: "invalid-email" }),
    });
    assert.equal(res.status, 400);
  });

  await t.test(
    "POST /admin/email/test sends test email successfully",
    async () => {
      const res = await fetch(`${baseUrl}/admin/email/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": "test_super_secret_admin_key_32bytes!!",
        },
        body: JSON.stringify({ to: "admin@vynor.lk" }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.ok(body.messageId || body.simulated);
    },
  );
});
