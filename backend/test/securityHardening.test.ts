import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { app, adminApp } from "../src/index.js";
import {
  authRateLimiter,
  resetRateLimitMemoryStore,
} from "../src/middleware/security.js";
import { authRouter, verifyTurnstileToken } from "../src/routes/auth.js";
import { initDb, dbRun, dbGet } from "../src/db.js";

test("Security Hardening Test Suite", async (suite) => {
  // ─── 1. DUAL-PORT ISOLATION TESTS ──────────────────────────────────────────
  await suite.test(
    "Dual-Port Isolation: Customer Port vs Admin Port",
    async (t) => {
      const customerServer = http.createServer(app);
      const adminServer = http.createServer(adminApp);

      await new Promise<void>((resolve) => customerServer.listen(0, resolve));
      await new Promise<void>((resolve) => adminServer.listen(0, resolve));

      const customerPort = (customerServer.address() as AddressInfo).port;
      const adminPort = (adminServer.address() as AddressInfo).port;
      const customerBase = `http://127.0.0.1:${customerPort}`;
      const adminBase = `http://127.0.0.1:${adminPort}`;

      t.after(() => {
        customerServer.close();
        adminServer.close();
      });

      await t.test(
        "Customer port serves public health check but blocks admin endpoints",
        async () => {
          // Customer health check passes
          const healthRes = await fetch(`${customerBase}/health`);
          assert.equal(healthRes.status, 200);
          const healthData = (await healthRes.json()) as any;
          assert.equal(healthData.status, "ok");

          // Customer root /admin redirects to dedicated admin domain
          const adminRootRes = await fetch(`${customerBase}/admin`, {
            redirect: "manual",
          });
          assert.equal(adminRootRes.status, 302);
          assert.equal(
            adminRootRes.headers.get("location"),
            "https://admin.vynor.lk",
          );

          // Sub-routes of /admin on customer port are strictly blocked (isolated)
          const adminSubRes = await fetch(`${customerBase}/admin/health`);
          assert.equal(adminSubRes.status, 404);
          const adminSubData = (await adminSubRes.json()) as any;
          assert.equal(adminSubData.code, "ADMIN_PORT_ISOLATED");

          const adminCircuitRes = await fetch(
            `${customerBase}/admin/circuit/deepseek/reset`,
            { method: "POST" },
          );
          assert.equal(adminCircuitRes.status, 404);
          const adminCircuitData = (await adminCircuitRes.json()) as any;
          assert.equal(adminCircuitData.code, "ADMIN_PORT_ISOLATED");
        },
      );

      await t.test(
        "Admin port serves admin health but blocks customer API endpoints",
        async () => {
          // Admin health check passes
          const adminHealthRes = await fetch(`${adminBase}/health`);
          assert.equal(adminHealthRes.status, 200);
          const adminHealthData = (await adminHealthRes.json()) as any;
          assert.equal(adminHealthData.service, "VynorAI Admin Portal");

          // Customer login paths redirect to customer domain
          const loginRedirectRes = await fetch(`${adminBase}/login`, {
            redirect: "manual",
          });
          assert.equal(loginRedirectRes.status, 302);
          assert.match(
            loginRedirectRes.headers.get("location") || "",
            /^https:\/\/vynor\.lk\/login/,
          );

          // Customer APIs (/api/* and /v1/*) are blocked on admin port
          const customerApiRes = await fetch(`${adminBase}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "test@example.com",
              password: "pwd",
            }),
          });
          assert.equal(customerApiRes.status, 404);
          const customerApiData = (await customerApiRes.json()) as any;
          assert.equal(customerApiData.code, "CUSTOMER_PORT_ISOLATED");

          const customerProxyRes = await fetch(
            `${adminBase}/v1/chat/completions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: [] }),
            },
          );
          assert.equal(customerProxyRes.status, 404);
          const customerProxyData = (await customerProxyRes.json()) as any;
          assert.equal(customerProxyData.code, "CUSTOMER_PORT_ISOLATED");
        },
      );
    },
  );

  // ─── 2. BRUTE-FORCE PROTECTION & RATE LIMITING TESTS ───────────────────────
  await suite.test("Brute-Force Protection on Auth Endpoints", async (t) => {
    resetRateLimitMemoryStore();

    const authApp = express();
    authApp.use(express.json());
    authApp.use("/api/auth", authRouter);

    const authServer = http.createServer(authApp);
    await new Promise<void>((resolve) => authServer.listen(0, resolve));
    const authPort = (authServer.address() as AddressInfo).port;
    const authBase = `http://127.0.0.1:${authPort}`;

    t.after(() => {
      authServer.close();
      resetRateLimitMemoryStore();
    });

    await t.test(
      "Blocks brute-force after max allowed attempts per minute per IP",
      async () => {
        const attackerIp = "198.51.100.42";

        // First 10 attempts should reach the endpoint handler (401 invalid credentials)
        for (let i = 1; i <= 10; i++) {
          const res = await fetch(`${authBase}/api/auth/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": attackerIp,
            },
            body: JSON.stringify({
              email: `user${i}@example.com`,
              password: "WrongPassword123!",
            }),
          });

          assert.equal(res.status, 401);
          assert.equal(res.headers.get("X-RateLimit-Limit"), "10");
          assert.equal(
            res.headers.get("X-RateLimit-Remaining"),
            String(10 - i),
          );
        }

        // 11th attempt must be rejected with 429 Too Many Requests
        const blockedRes = await fetch(`${authBase}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": attackerIp,
          },
          body: JSON.stringify({
            email: "user11@example.com",
            password: "WrongPassword123!",
          }),
        });

        assert.equal(blockedRes.status, 429);
        assert.equal(blockedRes.headers.get("X-RateLimit-Remaining"), "0");
        assert.ok(blockedRes.headers.get("Retry-After"));

        const blockedData = (await blockedRes.json()) as any;
        assert.equal(blockedData.error?.code, "too_many_requests");
        assert.equal(blockedData.error?.type, "rate_limit_exceeded");

        // A different IP is NOT blocked
        const cleanIpRes = await fetch(`${authBase}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "198.51.100.99",
          },
          body: JSON.stringify({
            email: "clean@example.com",
            password: "WrongPassword123!",
          }),
        });
        assert.equal(cleanIpRes.status, 401);
      },
    );
  });

  // ─── 3. CLOUDFLARE TURNSTILE ENFORCEMENT IN PRODUCTION MODE ───────────────
  await suite.test(
    "Cloudflare Turnstile Enforcement in Production Mode",
    async (t) => {
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.TURNSTILE_SECRET_KEY;

      t.after(() => {
        process.env.NODE_ENV = originalEnv;
        if (originalSecret !== undefined) {
          process.env.TURNSTILE_SECRET_KEY = originalSecret;
        } else {
          delete process.env.TURNSTILE_SECRET_KEY;
        }
      });

      await t.test(
        "verifyTurnstileToken: enforces human verification and dummy tokens",
        async () => {
          process.env.NODE_ENV = "production";
          process.env.TURNSTILE_SECRET_KEY =
            "1x0000000000000000000000000000000AA"; // Cloudflare official test secret

          // Missing token rejected in production
          assert.equal(await verifyTurnstileToken(undefined), false);
          assert.equal(await verifyTurnstileToken(""), false);

          // Invalid dummy token rejected
          assert.equal(
            await verifyTurnstileToken("2x00000000000000000000AB"),
            false,
          );

          // Valid dummy token passes
          assert.equal(
            await verifyTurnstileToken("1x00000000000000000000AA"),
            true,
          );

          // Missing secret in production fails closed
          delete process.env.TURNSTILE_SECRET_KEY;
          assert.equal(
            await verifyTurnstileToken("1x00000000000000000000AA"),
            false,
          );
        },
      );

      await t.test(
        "POST /register: blocks bot registrations when turnstile verification fails",
        async () => {
          process.env.NODE_ENV = "production";
          process.env.TURNSTILE_SECRET_KEY =
            "1x0000000000000000000000000000000AA";

          await initDb();

          const regApp = express();
          regApp.use(express.json());
          regApp.use("/api/auth", authRouter);

          const regServer = http.createServer(regApp);
          await new Promise<void>((resolve) => regServer.listen(0, resolve));
          const regPort = (regServer.address() as AddressInfo).port;
          const regBase = `http://127.0.0.1:${regPort}`;

          try {
            // Attempt registration without Turnstile token
            const missingTokenRes = await fetch(
              `${regBase}/api/auth/register`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Forwarded-For": "192.0.2.1",
                },
                body: JSON.stringify({
                  email: "bot_candidate_1@example.com",
                  password: "SecurePassword123!",
                  acceptPrivacy: true,
                }),
              },
            );

            assert.equal(missingTokenRes.status, 400);
            const missingTokenData = (await missingTokenRes.json()) as any;
            assert.match(
              missingTokenData.error,
              /Security check failed\. Please verify you are human\./,
            );

            // Attempt registration with invalid Turnstile token
            const invalidTokenRes = await fetch(
              `${regBase}/api/auth/register`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Forwarded-For": "192.0.2.2",
                },
                body: JSON.stringify({
                  email: "bot_candidate_2@example.com",
                  password: "SecurePassword123!",
                  turnstileToken: "2x00000000000000000000AB",
                  acceptPrivacy: true,
                }),
              },
            );

            assert.equal(invalidTokenRes.status, 400);
            const invalidTokenData = (await invalidTokenRes.json()) as any;
            assert.match(
              invalidTokenData.error,
              /Security check failed\. Please verify you are human\./,
            );
          } finally {
            regServer.close();
          }
        },
      );
    },
  );
});
