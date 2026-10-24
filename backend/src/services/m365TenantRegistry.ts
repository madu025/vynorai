import {
  billingAll as dbAll,
  billingGet as dbGet,
  billingRun as dbRun,
} from "./billingDb.js";

export const M365_TENANT_SCOPES = [
  "m365.excel.read",
  "m365.excel.write",
  "m365.text.read",
  "m365.text.write",
] as const;
export type M365TenantScope = (typeof M365_TENANT_SCOPES)[number];
export type M365TenantStatus = "enabled" | "disabled";

export interface M365TenantRecord {
  tenantId: string;
  status: M365TenantStatus;
  displayName: string | null;
  allowedScopes: M365TenantScope[];
  consentedAt: string | null;
  aiEnabled: boolean;
  planId: string | null;
  seatLimit: number;
  activeSeats: number;
  subscriptionValidUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface M365TenantRow {
  tenant_id: string;
  status: M365TenantStatus;
  display_name: string | null;
  allowed_scopes: string;
  consented_at: string | null;
  ai_enabled: number | null;
  plan_id: string | null;
  seat_limit: number | null;
  active_seats: number | string | null;
  subscription_valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export async function getM365Tenant(
  tenantId: string,
): Promise<M365TenantRecord | undefined> {
  const row = await dbGet<M365TenantRow>(
    "SELECT tenant_id, status, display_name, allowed_scopes, consented_at, ai_enabled, plan_id, seat_limit, subscription_valid_until, created_at, updated_at, (SELECT COUNT(*) FROM m365_identity_links WHERE tenant_id = m365_tenants.tenant_id AND enabled = 1) AS active_seats FROM m365_tenants WHERE tenant_id = ?",
    [tenantId],
  );
  return row ? toRecord(row) : undefined;
}

export async function listM365Tenants(): Promise<M365TenantRecord[]> {
  const rows = await dbAll<M365TenantRow>(
    "SELECT tenant_id, status, display_name, allowed_scopes, consented_at, ai_enabled, plan_id, seat_limit, subscription_valid_until, created_at, updated_at, (SELECT COUNT(*) FROM m365_identity_links WHERE tenant_id = m365_tenants.tenant_id AND enabled = 1) AS active_seats FROM m365_tenants ORDER BY updated_at DESC",
  );
  return rows.map(toRecord);
}

export async function upsertM365Tenant(input: {
  tenantId: string;
  status: M365TenantStatus;
  displayName?: string | null;
  allowedScopes: M365TenantScope[];
  consentedAt?: string | null;
  aiEnabled?: boolean;
  planId?: string | null;
  seatLimit?: number;
  subscriptionValidUntil?: string | null;
}): Promise<M365TenantRecord> {
  const scopes = normalizeScopes(input.allowedScopes);
  const existing = await getM365Tenant(input.tenantId);
  const planId =
    input.planId === undefined ? (existing?.planId ?? null) : input.planId;
  if (planId !== null) {
    const { getPlan } = await import("../config.js");
    if (getPlan(planId).id !== planId) throw new Error("invalid_m365_plan");
  }
  const seatLimit = input.seatLimit ?? existing?.seatLimit ?? 1;
  if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > 10000)
    throw new Error("invalid_m365_seat_limit");
  const subscriptionValidUntil =
    input.subscriptionValidUntil === undefined
      ? (existing?.subscriptionValidUntil ?? null)
      : input.subscriptionValidUntil;
  await dbRun(
    `INSERT INTO m365_tenants (tenant_id, status, display_name, allowed_scopes, consented_at, plan_id, seat_limit, subscription_valid_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET status = excluded.status, display_name = excluded.display_name,
       allowed_scopes = excluded.allowed_scopes, consented_at = excluded.consented_at,
       plan_id = excluded.plan_id, seat_limit = excluded.seat_limit,
       subscription_valid_until = excluded.subscription_valid_until, updated_at = CURRENT_TIMESTAMP`,
    [
      input.tenantId,
      input.status,
      input.displayName || null,
      JSON.stringify(scopes),
      input.consentedAt || null,
      planId,
      seatLimit,
      subscriptionValidUntil,
    ],
  );
  if (input.aiEnabled !== undefined)
    await dbRun("UPDATE m365_tenants SET ai_enabled = ? WHERE tenant_id = ?", [
      input.aiEnabled ? 1 : 0,
      input.tenantId,
    ]);
  const tenant = await getM365Tenant(input.tenantId);
  if (!tenant) throw new Error("m365_tenant_persist_failed");
  return tenant;
}

export async function requireM365TenantScope(
  tenantId: string,
  requiredScope: M365TenantScope,
): Promise<M365TenantRecord> {
  const tenant = await getM365Tenant(tenantId);
  if (!tenant || tenant.status !== "enabled")
    throw new Error("tenant_disabled");
  if (!tenant.allowedScopes.includes(requiredScope))
    throw new Error("tenant_scope_disabled");
  return tenant;
}

function toRecord(row: M365TenantRow): M365TenantRecord {
  return {
    tenantId: row.tenant_id,
    status: row.status,
    displayName: row.display_name,
    allowedScopes: normalizeScopes(parseScopes(row.allowed_scopes)),
    consentedAt: row.consented_at,
    aiEnabled: row.ai_enabled === null || Number(row.ai_enabled) !== 0,
    planId: row.plan_id || null,
    seatLimit: Number(row.seat_limit || 1),
    activeSeats: Number(row.active_seats || 0),
    subscriptionValidUntil: row.subscription_valid_until || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeScopes(scopes: readonly string[]): M365TenantScope[] {
  return [
    ...new Set(
      scopes.filter((scope): scope is M365TenantScope =>
        (M365_TENANT_SCOPES as readonly string[]).includes(scope),
      ),
    ),
  ];
}
