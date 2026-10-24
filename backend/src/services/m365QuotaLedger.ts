import { v4 as uuidv4 } from "uuid";
import {
  billingAll as dbAll,
  billingGet as dbGet,
  billingRun as dbRun,
} from "./billingDb.js";
import { getPlan } from "../config.js";
import { isoDate } from "./billingPolicy.js";
import {
  partialHold,
  STALE_RESERVATION_MS,
  type QuotaReservation,
} from "./monthlyQuota.js";

/**
 * Tenant-scoped quota ledger for Microsoft 365 requests.
 *
 * An M365 request is billed against the organisation's plan, never against the person's VS Code
 * subscription. Its credits live in `m365_tenant_usage` (one row per tenant + Entra object id +
 * cycle) and its open holds in `m365_quota_reservations`. These functions never read or write
 * `subscriptions`, `monthly_usage` or `quota_reservations`, so the same person can use VS Code and
 * Microsoft 365 independently and neither can change the other's allowance or usage.
 *
 * The real `users.id` is stored on every row for audit and economics linkage only; the quota key is
 * (tenant_id, object_id). No workbook data is ever stored here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 30;
/** Below this many credits left, a request is refused rather than reserved (same rule as personal). */
const MIN_RESERVATION_CREDITS = 1_000;

export type M365PlanSource = "tenant" | "user" | "free";

/** Who the credits belong to: one organisation seat. `userId` is the linked real user, for audit. */
export interface M365QuotaScope {
  kind: "m365_tenant";
  tenantId: string;
  objectId: string;
  userId: string;
}

export interface M365UsageRow {
  id: string;
  tenant_id: string;
  object_id: string;
  user_id: string;
  plan_name: string;
  plan_source: string;
  max_tokens: number;
  used_tokens: number;
  used_requests: number;
  bonus_tokens: number;
  bonus_requests: number;
  period_start: string;
  period_end: string;
  updated_at: string;
}

/** The plan an M365 request is billed on, from the tenant entitlement (see m365Entitlements.ts). */
export interface M365QuotaPlan {
  planId: string;
  source: M365PlanSource;
}

/** What diagnostics and capabilities may show: no ids of other tenants, no secrets, no workbook data. */
export interface M365QuotaSummary {
  scope: "m365_tenant";
  planId: string;
  planSource: M365PlanSource;
  usedCredits: number;
  maxCredits: number;
  usedRequests: number;
  maxRequests: number;
  periodEnd: string;
  /** True when the first billable request will open a fresh cycle (no row yet). */
  freshCycle: boolean;
}

function requestLimit(planId: string, usage: M365UsageRow): number {
  return getPlan(planId).monthlyRequests + (usage.bonus_requests || 0);
}

export function m365Scope(input: {
  tenantId: string;
  objectId: string;
  userId: string;
}): M365QuotaScope {
  if (!input.tenantId || !input.objectId || !input.userId)
    throw new Error("m365_quota_scope_incomplete");
  return {
    kind: "m365_tenant",
    tenantId: input.tenantId,
    objectId: input.objectId,
    userId: input.userId,
  };
}

/** The active cycle's row, or undefined when the next billable request will start a cycle. */
export async function peekM365Usage(
  scope: Pick<M365QuotaScope, "tenantId" | "objectId">,
): Promise<M365UsageRow | undefined> {
  return dbGet<M365UsageRow>(
    "SELECT * FROM m365_tenant_usage WHERE tenant_id = ? AND object_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
    [scope.tenantId, scope.objectId, isoDate(new Date())],
  );
}

/** Initialise or fetch this seat's cycle. A plan change mid-cycle changes only this M365 row. */
export async function getOrInitM365Usage(
  scope: M365QuotaScope,
  plan: M365QuotaPlan,
): Promise<M365UsageRow> {
  const now = new Date();
  const today = isoDate(now);
  const planDef = getPlan(plan.planId);
  let row = await peekM365Usage(scope);
  if (!row) {
    const periodEnd = isoDate(new Date(now.getTime() + CYCLE_DAYS * DAY_MS));
    await dbRun(
      `INSERT INTO m365_tenant_usage
       (id, tenant_id, object_id, user_id, plan_name, plan_source, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
       ON CONFLICT(tenant_id, object_id, period_start) DO NOTHING`,
      [
        uuidv4(),
        scope.tenantId,
        scope.objectId,
        scope.userId,
        planDef.id,
        plan.source,
        planDef.monthlyTokens,
        today,
        periodEnd,
      ],
    );
    // A concurrent request may have opened the same cycle first: always re-read the canonical row.
    row = await dbGet<M365UsageRow>(
      "SELECT * FROM m365_tenant_usage WHERE tenant_id = ? AND object_id = ? AND period_start = ? LIMIT 1",
      [scope.tenantId, scope.objectId, today],
    );
    if (!row) throw new Error("Failed to initialize M365 quota cycle");
  }
  if (row.plan_name !== planDef.id || row.plan_source !== plan.source) {
    const maxTokens = planDef.monthlyTokens + (row.bonus_tokens || 0);
    await dbRun(
      `UPDATE m365_tenant_usage
       SET plan_name = ?, plan_source = ?, max_tokens = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ? AND object_id = ?`,
      [
        planDef.id,
        plan.source,
        maxTokens,
        row.id,
        scope.tenantId,
        scope.objectId,
      ],
    );
    row.plan_name = planDef.id;
    row.plan_source = plan.source;
    row.max_tokens = maxTokens;
  }
  return row;
}

/** A read-only summary for diagnostics and capabilities. Creates nothing. */
export async function summarizeM365Quota(
  scope: Pick<M365QuotaScope, "tenantId" | "objectId">,
  plan: M365QuotaPlan,
): Promise<M365QuotaSummary> {
  const row = await peekM365Usage(scope);
  const planDef = getPlan(plan.planId);
  if (!row)
    return {
      scope: "m365_tenant",
      planId: planDef.id,
      planSource: plan.source,
      usedCredits: 0,
      maxCredits: planDef.monthlyTokens,
      usedRequests: 0,
      maxRequests: planDef.monthlyRequests,
      periodEnd: "",
      freshCycle: true,
    };
  return {
    scope: "m365_tenant",
    planId: planDef.id,
    planSource: plan.source,
    usedCredits: Number(row.used_tokens),
    maxCredits: planDef.monthlyTokens + Number(row.bonus_tokens || 0),
    usedRequests: Number(row.used_requests),
    maxRequests: requestLimit(planDef.id, row),
    periodEnd: row.period_end,
    freshCycle: false,
  };
}

async function consumeAtomic(
  scope: M365QuotaScope,
  plan: M365QuotaPlan,
  tokens: number,
  requests: number,
): Promise<boolean> {
  const usage = await getOrInitM365Usage(scope, plan);
  const planDef = getPlan(usage.plan_name);
  // The check and the increment are one statement, so concurrent reservations cannot overshoot.
  const result = await dbRun(
    `UPDATE m365_tenant_usage
     SET used_tokens = used_tokens + ?,
         used_requests = used_requests + ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND object_id = ?
       AND period_end >= ?
       AND used_requests + ? <= ? + bonus_requests
       AND used_tokens + ? <= max_tokens`,
    [
      tokens,
      requests,
      scope.tenantId,
      scope.objectId,
      isoDate(new Date()),
      requests,
      planDef.monthlyRequests,
      tokens,
    ],
  );
  return result.changes > 0;
}

async function persistHold(r: QuotaReservation): Promise<void> {
  const scope = r.scope;
  if (!scope || scope.kind !== "m365_tenant") return;
  r.id = uuidv4();
  try {
    await dbRun(
      "INSERT INTO m365_quota_reservations (id, tenant_id, object_id, user_id, tokens, requests, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        r.id,
        scope.tenantId,
        scope.objectId,
        r.userId,
        r.reservedTokens,
        r.reservedRequests,
        new Date().toISOString(),
      ],
    );
  } catch (err) {
    // Billing goes on without the safety net rather than failing the request.
    console.warn("[M365Quota] could not record hold:", (err as Error).message);
    r.id = undefined;
  }
}

/** Reserve the expected cost on the tenant ledger before any provider is called. */
export async function reserveM365Quota(
  scope: M365QuotaScope,
  plan: M365QuotaPlan,
  tokensToReserve: number,
  owner?: { type: "request" | "background_task"; id: string },
): Promise<QuotaReservation | null> {
  const build = (tokens: number): QuotaReservation => ({
    userId: scope.userId,
    reservedTokens: tokens,
    reservedRequests: 1,
    settled: false,
    ownerType: owner?.type,
    ownerId: owner?.id,
    scope: {
      kind: "m365_tenant",
      tenantId: scope.tenantId,
      objectId: scope.objectId,
    },
  });
  const wanted = Math.max(1, Math.floor(tokensToReserve));
  if (await consumeAtomic(scope, plan, wanted, 1)) {
    const reservation = build(wanted);
    await persistHold(reservation);
    return reservation;
  }
  // Same rule as the personal ledger: with credits left, hold what remains instead of refusing.
  const usage = await getOrInitM365Usage(scope, plan);
  const remaining = Math.floor(usage.max_tokens - usage.used_tokens);
  if (remaining < MIN_RESERVATION_CREDITS) return null;
  const hold = partialHold(remaining);
  if (!(await consumeAtomic(scope, plan, hold, 1))) return null;
  const reservation = build(hold);
  await persistHold(reservation);
  return reservation;
}

function holdScope(reservation: QuotaReservation): {
  tenantId: string;
  objectId: string;
} {
  const scope = reservation.scope;
  if (!scope || scope.kind !== "m365_tenant")
    throw new Error("m365_reservation_scope_mismatch");
  return { tenantId: scope.tenantId, objectId: scope.objectId };
}

/**
 * Claims the hold row by deleting it. Returns false when the row is already gone, which means the
 * stale-hold sweeper has already refunded these credits: the caller must then not refund them again.
 * A hold that was never recorded (no id) is treated as claimed, as on the personal ledger.
 */
async function closeHold(reservation: QuotaReservation): Promise<boolean> {
  if (!reservation.id) return true;
  try {
    const result = await dbRun(
      "DELETE FROM m365_quota_reservations WHERE id = ?",
      [reservation.id],
    );
    return result.changes > 0;
  } catch (err) {
    console.error(
      `[M365Quota] could not close hold ${reservation.id}:`,
      (err as Error).message,
    );
    return true;
  }
}

/** Grow a tenant-scoped hold. Returns false, changing nothing, when the cycle cannot cover it. */
export async function topUpM365Reservation(
  reservation: QuotaReservation,
  extra: number,
): Promise<boolean> {
  const { tenantId, objectId } = holdScope(reservation);
  // A hold the sweeper already refunded cannot be grown: its credits are no longer reserved.
  if (reservation.id) {
    const grown = await dbRun(
      "UPDATE m365_quota_reservations SET tokens = tokens + ? WHERE id = ?",
      [extra, reservation.id],
    ).catch(() => undefined);
    if (grown && grown.changes === 0) return false;
  }
  const result = await dbRun(
    `UPDATE m365_tenant_usage
     SET used_tokens = used_tokens + ?, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND object_id = ? AND period_end >= ? AND used_tokens + ? <= max_tokens`,
    [extra, tenantId, objectId, isoDate(new Date()), extra],
  );
  if (result.changes === 0) {
    if (reservation.id)
      await dbRun(
        "UPDATE m365_quota_reservations SET tokens = MAX(0, tokens - ?) WHERE id = ?",
        [extra, reservation.id],
      ).catch(() => {});
    return false;
  }
  reservation.reservedTokens += extra;
  return true;
}

/** Replace the hold with the actual cost, on the tenant ledger only. */
export async function settleM365Reservation(
  reservation: QuotaReservation,
  actualCredits: number,
): Promise<void> {
  const { tenantId, objectId } = holdScope(reservation);
  const claimed = await closeHold(reservation);
  const credits = Math.max(0, Math.floor(actualCredits));
  if (!claimed) {
    // The sweeper already gave the whole hold back, so the actual cost is charged in full once.
    if (credits === 0) return;
    await dbRun(
      `UPDATE m365_tenant_usage
       SET used_tokens = used_tokens + ?,
           used_requests = used_requests + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND object_id = ? AND period_end >= ?`,
      [
        credits,
        reservation.reservedRequests,
        tenantId,
        objectId,
        isoDate(new Date()),
      ],
    );
    return;
  }
  const delta = credits - reservation.reservedTokens;
  const requestRefund = credits === 0 ? reservation.reservedRequests : 0;
  if (delta === 0 && requestRefund === 0) return;
  await dbRun(
    `UPDATE m365_tenant_usage
     SET used_tokens = MAX(0, used_tokens + ?),
         used_requests = MAX(0, used_requests - ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND object_id = ? AND period_end >= ?`,
    [delta, requestRefund, tenantId, objectId, isoDate(new Date())],
  );
}

/** Give a failed request's hold back to the tenant ledger only. */
export async function releaseM365Reservation(
  reservation: QuotaReservation,
): Promise<void> {
  const { tenantId, objectId } = holdScope(reservation);
  // Already refunded by the stale-hold sweeper: nothing is left to give back.
  if (!(await closeHold(reservation))) return;
  await dbRun(
    `UPDATE m365_tenant_usage
     SET used_tokens = MAX(0, used_tokens - ?),
         used_requests = MAX(0, used_requests - ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND object_id = ? AND period_end >= ?`,
    [
      reservation.reservedTokens,
      reservation.reservedRequests,
      tenantId,
      objectId,
      isoDate(new Date()),
    ],
  );
}

/**
 * Return tenant holds that outlived any request. Each row is claimed by deleting it first, so two
 * backend instances never refund the same hold, and only the M365 ledger is touched.
 */
export async function reconcileStaleM365Reservations(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RESERVATION_MS).toISOString();
  const stale = await dbAll<{
    id: string;
    tenant_id: string;
    object_id: string;
    tokens: number;
    requests: number;
  }>(
    "SELECT id, tenant_id, object_id, tokens, requests FROM m365_quota_reservations WHERE created_at < ?",
    [cutoff],
  );
  let released = 0;
  for (const row of stale) {
    const claimed = await dbRun(
      "DELETE FROM m365_quota_reservations WHERE id = ?",
      [row.id],
    );
    if (claimed.changes === 0) continue;
    await dbRun(
      `UPDATE m365_tenant_usage
       SET used_tokens = MAX(0, used_tokens - ?),
           used_requests = MAX(0, used_requests - ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND object_id = ? AND period_end >= ?`,
      [
        Number(row.tokens),
        Number(row.requests),
        row.tenant_id,
        row.object_id,
        isoDate(now),
      ],
    );
    released++;
  }
  return released;
}
