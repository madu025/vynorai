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

test("admin relinking marks a self-service identity as admin-managed and exposes access requests", async () => {
  const objectId = "admin-relink-object-1";
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    ["m365-admin-user-a", "m365-admin-a@example.com", "key-a", "hash-a"],
  );
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    ["m365-admin-user-b", "m365-admin-b@example.com", "key-b", "hash-b"],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via) VALUES (?, ?, ?, 1, 'self')",
    [tenantId, objectId, "m365-admin-user-a"],
  );

  const relinked = await fetch(
    `${baseUrl}/admin/m365/identities/${tenantId}/${objectId}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ userId: "m365-admin-user-b", enabled: true }),
    },
  );
  assert.equal(relinked.status, 200);

  const identities: any = await (
    await fetch(`${baseUrl}/admin/m365/identities?tenantId=${tenantId}`, {
      headers,
    })
  ).json();
  const identity = identities.identities.find(
    (item: any) => item.objectId === objectId,
  );
  assert.deepEqual(
    {
      userId: identity.userId,
      linkedVia: identity.linkedVia,
      enabled: identity.enabled,
    },
    { userId: "m365-admin-user-b", linkedVia: "admin", enabled: true },
  );

  const { logSecurityEvent } = await import("../src/services/securityAudit.js");
  await logSecurityEvent({
    eventType: "M365_TENANT_ACCESS_REQUESTED",
    actor: objectId,
    target: "tenant-awaiting-admin",
    details: JSON.stringify({ requiredScope: "m365.excel.read" }),
  });
  const requests: any = await (
    await fetch(
      `${baseUrl}/admin/m365/access-requests?tenantId=tenant-awaiting-admin`,
      {
        headers,
      },
    )
  ).json();
  assert.equal(requests.count, 1);
  assert.equal(requests.requests[0].target, "tenant-awaiting-admin");
  assert.equal(requests.requests[0].actor, objectId);
});
