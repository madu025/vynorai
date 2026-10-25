import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const merchantId = "1200000";
const merchantSecret = "organization-billing-test-secret";
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "vynor-m365-org-billing-"),
);
const originalCwd = process.cwd();

let dbm: typeof import("../src/db.js");
let server: import("node:http").Server;
let baseUrl = "";

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const md5 = (value: string) =>
  crypto.createHash("md5").update(value).digest("hex").toUpperCase();

before(async () => {
  process.chdir(tempDir);
  process.env.DB_DRIVER = "sqlite";
  delete process.env.DATABASE_URL;
  process.env.PAYHERE_MERCHANT_ID = merchantId;
  process.env.PAYHERE_MERCHANT_SECRET = merchantSecret;

  dbm = await import("../src/db.js");
  await dbm.initDb();
  const express = (await import("express")).default;
  const { paymentRouter } = await import("../src/routes/payment.js");
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api/payment", paymentRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  dbm?.db?.close();
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows may keep the SQLite WAL briefly after close.
  }
});

let sequence = 0;
async function createLinkedOrganization() {
  const id = `org-billing-user-${++sequence}`;
  const tenantId = `org-billing-tenant-${sequence}`;
  const apiKey = `vynor_live_org_billing_${sequence}`;
  await dbm.dbRun(
    `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name)
     VALUES (?, ?, 'test', ?, ?, 'Organization Admin')`,
    [id, `${id}@example.com`, apiKey, sha256(apiKey)],
  );
  await dbm.dbRun(
    `INSERT INTO m365_tenants
       (tenant_id, status, display_name, allowed_scopes, consented_at, billing_mode, billing_status, quota_mode, auto_provision_members)
     VALUES (?, 'enabled', 'Test Organization', ?, ?, 'organization', 'not_configured', 'pooled', 1)`,
    [
      tenantId,
      JSON.stringify(["m365.excel.read", "m365.excel.write"]),
      new Date().toISOString(),
    ],
  );
  await dbm.dbRun(
    `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
     VALUES (?, ?, ?, 1, 'admin')`,
    [tenantId, `object-${sequence}`, id],
  );
  return { id, tenantId, apiKey };
}

async function notify(
  orderId: string,
  amount: string,
  statusCode = "2",
): Promise<Response> {
  const signature = md5(
    `${merchantId}${orderId}${amount}LKR${statusCode}${md5(merchantSecret)}`,
  );
  return fetch(`${baseUrl}/api/payment/notify`, {
    method: "POST",
    body: new URLSearchParams({
      merchant_id: merchantId,
      order_id: orderId,
      payment_id: `org-payment-${orderId}`,
      payhere_amount: amount,
      payhere_currency: "LKR",
      status_code: statusCode,
      md5sig: signature,
    }),
  });
}

test("organization checkout and IPN activate only the tenant ledger", async () => {
  const account = await createLinkedOrganization();
  const checkout = await fetch(
    `${baseUrl}/api/payment/m365/organization/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tenantId: account.tenantId, plan: "starter" }),
    },
  );
  assert.equal(checkout.status, 200);
  const checkoutBody = (await checkout.json()) as any;
  assert.equal(checkoutBody.billingScope, "organization");
  assert.match(checkoutBody.params.order_id, /^m365org_/);
  assert.equal(
    (
      await dbm.dbGet<{ count: number }>(
        "SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ?",
        [account.id],
      )
    )?.count,
    0,
  );

  const orderId = checkoutBody.params.order_id as string;
  const paid = await notify(orderId, "1850.00");
  assert.equal(paid.status, 200);
  const tenant = await dbm.dbGet<any>(
    "SELECT billing_mode, billing_status, plan_id, subscription_valid_until FROM m365_tenants WHERE tenant_id = ?",
    [account.tenantId],
  );
  assert.equal(tenant.billing_mode, "organization");
  assert.equal(tenant.billing_status, "active");
  assert.equal(tenant.plan_id, "starter");
  assert.ok(new Date(tenant.subscription_valid_until).getTime() > Date.now());
  assert.equal(
    (
      await dbm.dbGet<{ status: string }>(
        "SELECT status FROM m365_tenant_billing_orders WHERE order_id = ?",
        [orderId],
      )
    )?.status,
    "active",
  );

  const beforeReplay = tenant.subscription_valid_until;
  assert.equal((await notify(orderId, "1850.00")).status, 200);
  const afterReplay = await dbm.dbGet<{ subscription_valid_until: string }>(
    "SELECT subscription_valid_until FROM m365_tenants WHERE tenant_id = ?",
    [account.tenantId],
  );
  assert.equal(afterReplay?.subscription_valid_until, beforeReplay);
});

test("organization IPN rejects a signed amount mismatch without granting access", async () => {
  const account = await createLinkedOrganization();
  const checkout = await fetch(
    `${baseUrl}/api/payment/m365/organization/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tenantId: account.tenantId, plan: "starter" }),
    },
  );
  const orderId = ((await checkout.json()) as any).params.order_id as string;
  const rejected = await notify(orderId, "1.00");
  assert.equal(rejected.status, 400);
  assert.equal(
    (
      await dbm.dbGet<{ status: string }>(
        "SELECT status FROM m365_tenant_billing_orders WHERE order_id = ?",
        [orderId],
      )
    )?.status,
    "pending",
  );
  assert.equal(
    (
      await dbm.dbGet<{ billing_status: string }>(
        "SELECT billing_status FROM m365_tenants WHERE tenant_id = ?",
        [account.tenantId],
      )
    )?.billing_status,
    "not_configured",
  );
});
