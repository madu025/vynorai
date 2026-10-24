import { dbGet } from "../db.js";
import { getPlan } from "../config.js";
import { getActiveSubscription } from "./monthlyQuota.js";
import { getM365Tenant, type M365TenantRecord } from "./m365TenantRegistry.js";

export type M365PlanSource = "tenant" | "user" | "free";

export interface M365Entitlement {
  planId: string;
  planDisplayName: string;
  source: M365PlanSource;
  active: boolean;
  seatLimit: number | null;
  activeSeats: number;
  seatsRemaining: number | null;
  validUntil: string | null;
  tenantPlanConfigured: boolean;
}

interface LinkedUserRow {
  user_id: string;
}

/**
 * Resolves the commercial plan for an M365 identity without trusting email.
 * An explicitly configured, unexpired tenant plan wins; existing user-level
 * subscriptions remain the fallback for tenants that have not adopted tenant
 * billing yet.
 */
export async function resolveM365Entitlement(
  tenantId: string,
  objectId: string,
): Promise<M365Entitlement> {
  try {
    return await resolveM365EntitlementUnsafe(tenantId, objectId);
  } catch (error) {
    if ((error as Error).message === "m365_entitlement_lookup_failed")
      throw error;
    throw new Error("m365_entitlement_lookup_failed");
  }
}

async function resolveM365EntitlementUnsafe(
  tenantId: string,
  objectId: string,
): Promise<M365Entitlement> {
  const tenant = await getM365Tenant(tenantId);
  const link = await dbGet<LinkedUserRow>(
    "SELECT user_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ? AND enabled = 1",
    [tenantId, objectId],
  );
  const userSubscription = link
    ? await getActiveSubscription<{ plan_name: string }>(link.user_id)
    : undefined;
  const tenantPlan = activeTenantPlan(tenant);
  const selectedPlan = tenantPlan
    ? {
        planId: tenantPlan.planId,
        source: "tenant" as const,
        validUntil: tenantPlan.validUntil,
      }
    : userSubscription
      ? {
          planId: userSubscription.plan_name,
          source: "user" as const,
          validUntil: null,
        }
      : { planId: "free", source: "free" as const, validUntil: null };
  const plan = getPlan(selectedPlan.planId);
  const activeSeats = tenant
    ? Number(
        (
          await dbGet<{ count: number | string }>(
            "SELECT COUNT(*) AS count FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
            [tenantId],
          )
        )?.count ?? 0,
      )
    : 0;
  const seatLimit = tenantPlan?.seatLimit ?? null;
  return {
    planId: plan.id,
    planDisplayName: plan.displayName,
    source: selectedPlan.source,
    active: Boolean(tenant?.status === "enabled" && link),
    seatLimit,
    activeSeats,
    seatsRemaining:
      seatLimit === null ? null : Math.max(0, seatLimit - activeSeats),
    validUntil: selectedPlan.validUntil,
    tenantPlanConfigured: Boolean(tenant?.planId),
  };
}

/** Used by admin identity linking to prevent a paid tenant from exceeding seats. */
export async function assertM365SeatAvailable(
  tenantId: string,
  objectId: string,
): Promise<void> {
  const tenant = await getM365Tenant(tenantId);
  if (!tenant || tenant.status !== "enabled")
    throw new Error("tenant_disabled");
  const alreadyLinked = await dbGet<{ object_id: string }>(
    "SELECT object_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ? AND enabled = 1",
    [tenantId, objectId],
  );
  if (alreadyLinked || !tenant.seatLimit) return;
  const count = await dbGet<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
    [tenantId],
  );
  if (Number(count?.count ?? 0) >= tenant.seatLimit)
    throw new Error("m365_seat_limit_reached");
}

function activeTenantPlan(
  tenant: M365TenantRecord | undefined,
):
  | { planId: string; seatLimit: number; validUntil: string | null }
  | undefined {
  if (!tenant?.planId || tenant.status !== "enabled") return undefined;
  if (
    tenant.subscriptionValidUntil &&
    new Date(tenant.subscriptionValidUntil).getTime() <= Date.now()
  )
    return undefined;
  return {
    planId: getPlan(tenant.planId).id,
    seatLimit: tenant.seatLimit,
    validUntil: tenant.subscriptionValidUntil,
  };
}
