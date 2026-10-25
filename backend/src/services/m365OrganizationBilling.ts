import { v4 as uuidv4 } from "uuid";
import { getEffectivePlan } from "./planManager.js";
import { getPlan } from "../config.js";
import { billingGet as dbGet, billingRun as dbRun } from "./billingDb.js";
import { activeM365TenantPlan } from "./m365Entitlements.js";
import { getM365Tenant } from "./m365TenantRegistry.js";
import { planDurationDays } from "./billingPolicy.js";

export type M365OrganizationOrderStatus =
  | "pending"
  | "active"
  | "cancelled"
  | "failed"
  | "chargedback";

export interface M365OrganizationBillingOrder {
  id: string;
  tenantId: string;
  payerUserId: string | null;
  planName: string;
  status: M365OrganizationOrderStatus;
  orderId: string;
  paymentId: string | null;
  amountMinor: number;
  amount: number;
  currency: string;
  validUntil: string;
  createdAt: string;
  updatedAt: string;
}

interface BillingOrderRow {
  id: string;
  tenant_id: string;
  payer_user_id: string | null;
  plan_name: string;
  status: M365OrganizationOrderStatus;
  order_id: string;
  payment_id: string | null;
  amount_minor: number | string;
  amount: number | string;
  currency: string;
  valid_until: string;
  created_at: string;
  updated_at: string;
}

const CLAIMABLE = "('pending', 'failed', 'cancelled')";
const DAY_MS = 24 * 60 * 60 * 1000;
const pendingLocks = new Map<string, Promise<unknown>>();

function toRecord(row: BillingOrderRow): M365OrganizationBillingOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    payerUserId: row.payer_user_id,
    planName: row.plan_name,
    status: row.status,
    orderId: row.order_id,
    paymentId: row.payment_id,
    amountMinor: Number(row.amount_minor),
    amount: Number(row.amount),
    currency: row.currency,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getM365OrganizationBillingOrder(
  orderId: string,
): Promise<M365OrganizationBillingOrder | undefined> {
  const row = await dbGet<BillingOrderRow>(
    `SELECT id, tenant_id, payer_user_id, plan_name, status, order_id, payment_id,
            amount_minor, amount, currency, valid_until, created_at, updated_at
       FROM m365_tenant_billing_orders WHERE order_id = ?`,
    [orderId],
  );
  return row ? toRecord(row) : undefined;
}

/**
 * Creates a tenant-owned pending order. A personal Vynor account is only the payment contact;
 * the order never creates or changes that account's personal subscription.
 */
export async function createM365OrganizationBillingOrder(input: {
  tenantId: string;
  payerUserId: string | null;
  m365ObjectId?: string;
  planId: string;
  orderId: string;
  amount: number;
  currency: string;
}): Promise<M365OrganizationBillingOrder> {
  const tenant = await getM365Tenant(input.tenantId);
  if (!tenant || tenant.status !== "enabled")
    throw new Error("m365_tenant_disabled");
  if (tenant.billingMode !== "organization")
    throw new Error("m365_organization_billing_not_enabled");
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error("m365_organization_invalid_amount");

  const plan = await getEffectivePlan(input.planId);
  if (!plan || plan.id !== input.planId || plan.id === "free")
    throw new Error("invalid_m365_organization_plan");

  // A checkout may only be started by a Vynor account that has proved membership of this tenant.
  // This prevents a logged-in stranger who guesses a tenant id from charging the organization.
  if (input.payerUserId) {
    const identity = await dbGet<{ object_id: string }>(
      `SELECT object_id FROM m365_identity_links
         WHERE tenant_id = ? AND user_id = ? AND enabled = 1 LIMIT 1`,
      [input.tenantId, input.payerUserId],
    );
    if (!identity) throw new Error("m365_org_billing_requires_linked_identity");
  } else if (!input.m365ObjectId) {
    throw new Error("m365_org_billing_requires_identity");
  }

  const pending = await dbGet<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM m365_tenant_billing_orders WHERE tenant_id = ? AND status = 'pending'",
    [input.tenantId],
  );
  if (Number(pending?.count ?? 0) >= 10)
    throw new Error("m365_org_too_many_pending_orders");

  const order = {
    id: uuidv4(),
    validUntil: new Date(
      Date.now() + planDurationDays(plan.id) * DAY_MS,
    ).toISOString(),
  };
  await dbRun(
    `INSERT INTO m365_tenant_billing_orders
       (id, tenant_id, payer_user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [
      order.id,
      input.tenantId,
      input.payerUserId,
      plan.id,
      input.orderId,
      Math.round(input.amount * 100),
      input.amount,
      input.currency,
      order.validUntil,
    ],
  );
  const created = await getM365OrganizationBillingOrder(input.orderId);
  if (!created) throw new Error("m365_organization_order_persist_failed");
  return created;
}

async function withTenantLock<T>(tenantId: string, work: () => Promise<T>) {
  const previous = pendingLocks.get(tenantId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  pendingLocks.set(tenantId, current);
  try {
    return await current;
  } finally {
    if (pendingLocks.get(tenantId) === current) pendingLocks.delete(tenantId);
  }
}

function tenantPlanForRenewal(
  tenant: Awaited<ReturnType<typeof getM365Tenant>>,
) {
  return activeM365TenantPlan(tenant);
}

/** Apply a verified successful IPN once and extend the tenant's paid period. */
export async function activateM365OrganizationOrder(
  order: M365OrganizationBillingOrder,
  paymentId: string,
): Promise<void> {
  if (!paymentId) throw new Error("m365_organization_payment_id_missing");
  return withTenantLock(order.tenantId, async () => {
    const claimed = await dbRun(
      `UPDATE m365_tenant_billing_orders SET status = 'active', payment_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ? AND status IN ${CLAIMABLE}`,
      [paymentId, order.orderId],
    );
    if (claimed.changes === 0) return;

    try {
      const tenant = await getM365Tenant(order.tenantId);
      if (!tenant || tenant.status !== "enabled")
        throw new Error("m365_tenant_disabled");
      const plan = getPlan(order.planName);
      const currentPlan = tenantPlanForRenewal(tenant);
      const sameTier = currentPlan?.planId === plan.id;
      const currentExpiry = tenant.subscriptionValidUntil
        ? new Date(tenant.subscriptionValidUntil).getTime()
        : 0;
      const base = sameTier ? Math.max(Date.now(), currentExpiry) : Date.now();
      const validUntil = new Date(
        base + planDurationDays(plan.id) * DAY_MS,
      ).toISOString();
      await dbRun(
        `UPDATE m365_tenants SET plan_id = ?, subscription_valid_until = ?,
             billing_status = 'active', updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ? AND billing_mode = 'organization'`,
        [plan.id, validUntil, order.tenantId],
      );
    } catch (error) {
      // Allow a retried IPN to complete after a transient database failure.
      await dbRun(
        "UPDATE m365_tenant_billing_orders SET status = 'pending', payment_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?",
        [order.orderId],
      );
      throw error;
    }
  });
}

export async function markM365OrganizationOrderFailed(
  order: M365OrganizationBillingOrder,
  status: "cancelled" | "failed",
): Promise<void> {
  await dbRun(
    `UPDATE m365_tenant_billing_orders SET status = ?
       WHERE order_id = ? AND status = 'pending'`,
    [status, order.orderId],
  );
  if (status !== "failed") return;
  const tenant = await getM365Tenant(order.tenantId);
  if (tenant && !tenantPlanForRenewal(tenant)) {
    await dbRun(
      "UPDATE m365_tenants SET billing_status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND billing_mode = 'organization' AND billing_status IN ('not_configured', 'expired', 'past_due')",
      [order.tenantId],
    );
  }
}

export async function markM365OrganizationOrderChargeback(
  order: M365OrganizationBillingOrder,
): Promise<void> {
  const reversed = await dbRun(
    `UPDATE m365_tenant_billing_orders SET status = 'chargedback'
       WHERE order_id = ? AND status = 'active'`,
    [order.orderId],
  );
  if (reversed.changes === 0) return;
  // A late chargeback for an older cycle must not turn off a newer paid renewal.
  const newerPaid = await dbGet<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM m365_tenant_billing_orders
       WHERE tenant_id = ? AND status = 'active' AND created_at > ?`,
    [order.tenantId, order.createdAt],
  );
  if (Number(newerPaid?.count ?? 0) > 0) return;
  await dbRun(
    `UPDATE m365_tenants SET billing_status = 'past_due', updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND billing_mode = 'organization'`,
    [order.tenantId],
  );
}
