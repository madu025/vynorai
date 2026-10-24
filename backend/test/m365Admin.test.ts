import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-admin-"));
const originalCwd = process.cwd();
const adminSecret = "vynor-m365-admin-test-secret-2026";
const tenantId = "55555555-5555-4555-8555-555555555555";
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

test("the tenant policy can enable text scopes and switch AI off, behind the admin guard", async () => {
  const denied = await fetch(`${baseUrl}/admin/m365/tenants/${tenantId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "enabled",
      allowedScopes: ["m365.text.read"],
    }),
  });
  assert.equal(denied.status, 401);

  const saved = await fetch(`${baseUrl}/admin/m365/tenants/${tenantId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      status: "enabled",
      allowedScopes: ["m365.excel.read", "m365.text.read", "m365.text.write"],
      consentedAt: "2026-10-15T00:00:00.000Z",
      aiEnabled: false,
      planId: "pro",
      seatLimit: 5,
      subscriptionValidUntil: "2027-10-15T00:00:00.000Z",
    }),
  });
  assert.equal(saved.status, 200);
  const body: any = await saved.json();
  assert.equal(body.tenant.aiEnabled, false);
  assert.deepEqual(body.tenant.allowedScopes, [
    "m365.excel.read",
    "m365.text.read",
    "m365.text.write",
  ]);
  assert.equal(body.tenant.planId, "pro");
  assert.equal(body.tenant.seatLimit, 5);
  assert.equal(body.tenant.subscriptionValidUntil, "2027-10-15T00:00:00.000Z");

  const listed = await fetch(`${baseUrl}/admin/m365/tenants`, { headers });
  assert.equal(listed.status, 200);
  const listedBody: any = await listed.json();
  assert.equal(listedBody.count, 1);
  assert.equal(listedBody.tenants[0].planId, "pro");
  assert.equal(listedBody.tenants[0].seatLimit, 5);
  assert.equal(listedBody.tenants[0].activeSeats, 0);

  const unknownScope = await fetch(
    `${baseUrl}/admin/m365/tenants/${tenantId}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        status: "enabled",
        allowedScopes: ["m365.mail.send"],
      }),
    },
  );
  assert.equal(unknownScope.status, 400);

  // Saving again without aiEnabled keeps the administrator's choice.
  const resaved = await fetch(`${baseUrl}/admin/m365/tenants/${tenantId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      status: "enabled",
      allowedScopes: ["m365.excel.read"],
    }),
  });
  const resavedBody: any = await resaved.json();
  assert.equal(resavedBody.tenant.aiEnabled, false);
  assert.equal(resavedBody.tenant.planId, "pro");
  assert.equal(resavedBody.tenant.seatLimit, 5);
});

test("usage and audit views summarize metadata-only events per tenant", async () => {
  const { logSecurityEvent } = await import("../src/services/securityAudit.js");
  for (let index = 0; index < 3; index += 1)
    await logSecurityEvent({
      eventType: "M365_EXCEL_PLAN_CREATED",
      actor: "user-1",
      target: tenantId,
      details: JSON.stringify({ actionCount: 2 }),
    });
  await logSecurityEvent({
    eventType: "M365_TEXT_ASSIST_COMPLETED",
    actor: "user-1",
    target: tenantId,
    details: JSON.stringify({ task: "summarize" }),
  });
  const usage: any = await (
    await fetch(`${baseUrl}/admin/m365/usage?days=7`, { headers })
  ).json();
  assert.equal(usage.days, 7);
  assert.equal(usage.tenants[tenantId].M365_EXCEL_PLAN_CREATED, 3);
  assert.equal(usage.tenants[tenantId].M365_TEXT_ASSIST_COMPLETED, 1);

  const audit: any = await (
    await fetch(`${baseUrl}/admin/m365/audit?tenantId=${tenantId}&limit=2`, {
      headers,
    })
  ).json();
  assert.equal(audit.count, 2);
  assert.ok(audit.events.every((event: any) => event.target === tenantId));

  const unauthenticated = await fetch(`${baseUrl}/admin/m365/usage`);
  assert.equal(unauthenticated.status, 401);
});
