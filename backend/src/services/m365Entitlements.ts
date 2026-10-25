import { dbGet, dbRun } from "../db.js";
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
  /** Set when the account is suspended or the seat is beyond the tenant plan's seat limit. */
  blockedReason?: "user_suspended" | "seat_limit_exceeded";
}

interface LinkedUserRow {
  user_id: string;
  is_suspended?: number | null;
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
  const organizationMode = tenant?.billingMode === "organization";
  const link = await dbGet<LinkedUserRow>(
    "SELECT l.user_id, u.is_suspended FROM m365_identity_links l JOIN users u ON u.id = l.user_id WHERE l.tenant_id = ? AND l.object_id = ? AND l.enabled = 1",
    [tenantId, objectId],
  );
  // A suspended account never gets a plan, a seat or credits through the add-in.
  const suspended = Boolean(
    link && link.is_suspended !== undefined && link.is_suspended !== null
      ? Number(link.is_suspended) !== 0
      : false,
  );
  const userSubscription =
    !organizationMode && link && !suspended
      ? await getActiveSubscription<{ plan_name: string }>(link.user_id)
      : undefined;
  const tenantPlan = activeM365TenantPlan(tenant);
  const seatExceeded = Boolean(
    link &&
      tenantPlan &&
      (await seatIsBeyondLimit(tenantId, objectId, tenantPlan.seatLimit)),
  );
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
    active: Boolean(
      tenant?.status === "enabled" &&
        (organizationMode ? Boolean(tenantPlan) : Boolean(link)) &&
        !suspended &&
        !seatExceeded,
    ),
    ...(suspended
      ? { blockedReason: "user_suspended" as const }
      : seatExceeded
        ? { blockedReason: "seat_limit_exceeded" as const }
        : {}),
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
  if (alreadyLinked) return;
  const tenantPlan = activeM365TenantPlan(tenant);
  // An enabled tenant without an active tenant subscription uses the linked user's plan. The
  // registry default seat_limit=1 is not a free-plan organisation seat cap.
  if (!tenantPlan) return;
  const count = await dbGet<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1",
    [tenantId],
  );
  if (Number(count?.count ?? 0) >= tenantPlan.seatLimit)
    throw new Error("m365_seat_limit_reached");
}

function validSeatLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * True when this seat is not among the first `seatLimit` enabled seats (oldest link first, object id
 * as the tie-break). Lowering the limit, or two admin calls racing past the check, therefore never
 * leaves more people with access than the plan pays for.
 */
async function seatIsBeyondLimit(
  tenantId: string,
  objectId: string,
  seatLimit: number,
): Promise<boolean> {
  if (!validSeatLimit(seatLimit)) return true;
  const rank = await dbGet<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM m365_identity_links o, m365_identity_links me
     WHERE me.tenant_id = ? AND me.object_id = ? AND o.tenant_id = me.tenant_id AND o.enabled = 1
       AND o.object_id <> me.object_id
       AND (o.created_at < me.created_at OR (o.created_at = me.created_at AND o.object_id < me.object_id))`,
    [tenantId, objectId],
  );
  return Number(rank?.count ?? 0) >= seatLimit;
}

export interface LinkIdentityResult {
  ok: boolean;
  /** Set when the call re-pointed an existing link from another account (for the audit trail). */
  previousUserId?: string;
  code?: "tenant_disabled" | "m365_seat_limit_reached";
}

/**
 * Creates, re-points or disables an identity link. Enabling is ONE statement whose WHERE clause
 * counts the other enabled seats against the tenant's seat limit, so two simultaneous admin calls
 * cannot both take the last seat on SQLite (statements are serialised). PostgreSQL READ COMMITTED
 * can still overshoot in a race; `seatIsBeyondLimit` refuses those extra seats at request time.
 */
export async function linkIdentityWithSeatCheck(input: {
  tenantId: string;
  objectId: string;
  userId: string;
  enabled: boolean;
}): Promise<LinkIdentityResult> {
  const previous = await dbGet<{ user_id: string }>(
    "SELECT user_id FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [input.tenantId, input.objectId],
  );
  const previousUserId =
    previous && previous.user_id !== input.userId
      ? previous.user_id
      : undefined;
  if (!input.enabled) {
    await dbRun(
      `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
       VALUES (?, ?, ?, 0, 'admin')
       ON CONFLICT(tenant_id, object_id) DO UPDATE SET user_id = excluded.user_id, enabled = 0, linked_via = 'admin'`,
      [input.tenantId, input.objectId, input.userId],
    );
    return { ok: true, ...(previousUserId ? { previousUserId } : {}) };
  }
  const tenant = await getM365Tenant(input.tenantId);
  if (!tenant || tenant.status !== "enabled")
    return { ok: false, code: "tenant_disabled" };
  const tenantPlan = activeM365TenantPlan(tenant);
  const result = tenantPlan
    ? await dbRun(
        `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
         SELECT ?, ?, ?, 1, 'admin'
         WHERE (SELECT COUNT(*) FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1 AND object_id <> ?)
           < ?
         ON CONFLICT(tenant_id, object_id) DO UPDATE SET user_id = excluded.user_id, enabled = 1, linked_via = 'admin'`,
        [
          input.tenantId,
          input.objectId,
          input.userId,
          input.tenantId,
          input.objectId,
          tenantPlan.seatLimit,
        ],
      )
    : await dbRun(
        `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
         SELECT ?, ?, ?, 1, 'admin'
         WHERE NOT EXISTS (SELECT 1 FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?)
         ON CONFLICT(tenant_id, object_id) DO UPDATE SET user_id = excluded.user_id, enabled = 1, linked_via = 'admin'`,
        [
          input.tenantId,
          input.objectId,
          input.userId,
          input.tenantId,
          input.objectId,
        ],
      );
  if (result.changes > 0)
    return { ok: true, ...(previousUserId ? { previousUserId } : {}) };
  return {
    ok: false,
    code:
      !tenant || tenant.status !== "enabled"
        ? "tenant_disabled"
        : "m365_seat_limit_reached",
  };
}

export function activeM365TenantPlan(
  tenant: M365TenantRecord | undefined,
):
  | { planId: string; seatLimit: number; validUntil: string | null }
  | undefined {
  if (!tenant?.planId || tenant.status !== "enabled") return undefined;
  if (
    tenant.billingMode === "organization" &&
    tenant.billingStatus !== "active" &&
    tenant.billingStatus !== "trialing"
  )
    return undefined;
  if (tenant.subscriptionValidUntil) {
    // An unreadable date is treated as expired: the tenant falls back instead of keeping the plan.
    const expiresAt = new Date(tenant.subscriptionValidUntil).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      return undefined;
  }
  // A zero, negative or garbage seat limit is never "unlimited": no tenant plan applies.
  if (!validSeatLimit(tenant.seatLimit)) return undefined;
  return {
    planId: getPlan(tenant.planId).id,
    seatLimit: tenant.seatLimit,
    validUntil: tenant.subscriptionValidUntil,
  };
}
