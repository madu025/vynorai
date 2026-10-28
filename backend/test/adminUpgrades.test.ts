import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import { adminRouter } from "../src/routes/admin.js";
import {
  GRAPH_SEND_MAIL_URL,
  setGraphFetcherForTests,
} from "../src/services/m365GraphMail.js";

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
          "cf-access-authenticated-user-email": "admin@vynor.lk",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "ok");
      assert.ok(Array.isArray(body.briefings));
    },
  );

  await t.test(
    "POST /admin/swarm/run never claims to dispatch an unavailable worker",
    async () => {
      const res = await fetch(`${baseUrl}/admin/swarm/run`, {
        method: "POST",
        headers: {
          "cf-access-authenticated-user-email": "admin@vynor.lk",
        },
      });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.status, "unavailable");
      assert.match(body.error, /No job was started/);
    },
  );

  await t.test("POST /admin/email/test validates email address", async () => {
    const res = await fetch(`${baseUrl}/admin/email/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-access-authenticated-user-email": "admin@vynor.lk",
      },
      body: JSON.stringify({ to: "invalid-email" }),
    });
    assert.equal(res.status, 400);
  });

  const ADMIN = {
    "Content-Type": "application/json",
    "cf-access-authenticated-user-email": "admin@vynor.lk",
  };
  const jwt = (claims: Record<string, unknown>) =>
    `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signaturesignaturesig`;
  const goodClaims = () => ({
    aud: "https://graph.microsoft.com",
    scp: "Mail.Send User.Read",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sendTest = (
    headers: Record<string, string> = {},
    to = "prasad@slts.lk",
  ) =>
    fetch(`${baseUrl}/admin/email/test`, {
      method: "POST",
      headers: { ...ADMIN, ...headers },
      body: JSON.stringify({ to }),
    });
  const graphCalls: { url: string; init?: RequestInit }[] = [];
  const stubGraph = (status: number, headers: Record<string, string> = {}) => {
    graphCalls.length = 0;
    setGraphFetcherForTests(async (url, init) => {
      graphCalls.push({ url, init });
      return new Response(null, { status, headers });
    });
  };
  t.after(() => setGraphFetcherForTests());

  await t.test(
    "email test: Graph 202 sends to prasad@slts.lk, with no simulated flag",
    async () => {
      stubGraph(202, { "request-id": "req-123" });
      const token = jwt(goodClaims());
      const res = await sendTest({ "x-m365-graph-token": `Bearer ${token}` });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.graphStatus, 202);
      assert.equal(body.requestId, "req-123");
      assert.equal("simulated" in body, false);
      assert.equal(graphCalls.length, 1);
      assert.equal(graphCalls[0].url, GRAPH_SEND_MAIL_URL);
      assert.equal(
        (graphCalls[0].init!.headers as Record<string, string>).authorization,
        `Bearer ${token}`,
      );
      const sent = JSON.parse(String(graphCalls[0].init!.body));
      assert.deepEqual(sent.message.toRecipients, [
        { emailAddress: { address: "prasad@slts.lk" } },
      ]);
    },
  );

  await t.test(
    "email test: a missing Graph token is M365_GRAPH_AUTH_REQUIRED and nothing is sent",
    async () => {
      stubGraph(202);
      const res = await sendTest();
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "M365_GRAPH_AUTH_REQUIRED");
      assert.equal(graphCalls.length, 0);
    },
  );

  await t.test(
    "email test: expired, wrong-audience and missing Mail.Send tokens never reach Graph",
    async () => {
      stubGraph(202);
      const expired = await sendTest({
        "x-m365-graph-token": jwt({
          ...goodClaims(),
          exp: Math.floor(Date.now() / 1000) - 10,
        }),
      });
      assert.equal(expired.status, 401);
      assert.equal(
        (await expired.json()).error.code,
        "M365_GRAPH_TOKEN_EXPIRED",
      );
      const audience = await sendTest({
        "x-m365-graph-token": jwt({ ...goodClaims(), aud: "api://other" }),
      });
      assert.equal(audience.status, 401);
      assert.equal(
        (await audience.json()).error.code,
        "M365_GRAPH_AUTH_REQUIRED",
      );
      const scope = await sendTest({
        "x-m365-graph-token": jwt({ ...goodClaims(), scp: "User.Read" }),
      });
      assert.equal(scope.status, 403);
      assert.equal(
        (await scope.json()).error.code,
        "M365_GRAPH_PERMISSION_MISSING",
      );
      assert.equal(graphCalls.length, 0);
    },
  );

  for (const [status, code, extra] of [
    [401, "M365_GRAPH_AUTH_REQUIRED", {}],
    [403, "M365_GRAPH_PERMISSION_DENIED", {}],
    [413, "M365_GRAPH_PAYLOAD_TOO_LARGE", {}],
    [429, "M365_GRAPH_THROTTLED", { "retry-after": "30" }],
  ] as const) {
    await t.test(`email test: Graph ${status} maps to ${code}`, async () => {
      stubGraph(status, { ...extra });
      const res = await sendTest({ "x-m365-graph-token": jwt(goodClaims()) });
      assert.equal(res.status, status);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, code);
      assert.equal(body.error.graphStatus, status);
      if (status === 429) assert.equal(res.headers.get("retry-after"), "30");
    });
  }

  await t.test(
    "email test: graph-config exposes public client settings only, behind admin auth",
    async () => {
      process.env.M365_ENTRA_TENANT_ID = "tenant-1";
      process.env.M365_ENTRA_CLIENT_ID = "client-1";
      process.env.M365_ENTRA_CLIENT_SECRET = "must-never-be-returned";
      const denied = await fetch(`${baseUrl}/admin/email/graph-config`);
      assert.notEqual(denied.status, 200);
      const ok = await fetch(`${baseUrl}/admin/email/graph-config`, {
        headers: ADMIN,
      });
      assert.equal(ok.status, 200);
      const text = await ok.text();
      assert.equal(text.includes("must-never-be-returned"), false);
      const body = JSON.parse(text);
      assert.equal(body.configured, true);
      assert.equal(body.clientId, "client-1");
      assert.equal(body.authority, "organizations");
      assert.equal(body.loginHint, "prasad@slts.lk");
      assert.equal(body.scope, "https://graph.microsoft.com/Mail.Send");
      delete process.env.M365_ENTRA_CLIENT_SECRET;
    },
  );

  await t.test(
    "email test: other recipients are HTTP 400 and never reach Graph",
    async () => {
      stubGraph(202);
      const res = await sendTest(
        { "x-m365-graph-token": jwt(goodClaims()) },
        "someone@example.com",
      );
      assert.equal(res.status, 400);
      assert.equal(graphCalls.length, 0);
    },
  );

  await t.test(
    "email test: no SMTP, Resend or simulated fallback and no secret in logs",
    async () => {
      const route = fs.readFileSync(
        new URL("../src/routes/admin.ts", import.meta.url),
        "utf8",
      );
      const start = route.indexOf('"/email/test"');
      const handler = route
        .slice(start, route.indexOf("/email/broadcast", start))
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(handler, /sendEmail|nodemailer|resend|simulated/i);
      assert.doesNotMatch(handler, /console\./);
      const mail = fs
        .readFileSync(
          new URL("../src/services/m365GraphMail.ts", import.meta.url),
          "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(mail, /console\.|nodemailer|resend/i);
      const logged: string[] = [];
      const original = [console.log, console.error, console.warn, console.info];
      for (const name of ["log", "error", "warn", "info"] as const)
        (console as any)[name] = (...args: unknown[]) =>
          logged.push(args.map(String).join(" "));
      const token = jwt(goodClaims());
      try {
        stubGraph(403);
        await sendTest({ "x-m365-graph-token": token });
      } finally {
        [console.log, console.error, console.warn, console.info] =
          original as any;
      }
      const output = logged.join(" | ");
      assert.equal(output.includes(token), false);
      assert.equal(output.includes("prasad@slts.lk"), false);
      assert.equal(output.includes("Test email dispatched"), false);
    },
  );

  await t.test(
    "POST /admin/email/test rejects every recipient except the test inbox",
    async () => {
      const res = await fetch(`${baseUrl}/admin/email/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-access-authenticated-user-email": "admin@vynor.lk",
        },
        body: JSON.stringify({ to: "admin@vynor.lk" }),
      });
      assert.equal(res.status, 400);
    },
  );
});
