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
  created_at: string;
  updated_at: string;
}

export async function getM365Tenant(
  tenantId: string,
): Promise<M365TenantRecord | undefined> {
  const row = await dbGet<M365TenantRow>(
    "SELECT tenant_id, status, display_name, allowed_scopes, consented_at, ai_enabled, created_at, updated_at FROM m365_tenants WHERE tenant_id = ?",
    [tenantId],
  );
  return row ? toRecord(row) : undefined;
}

export async function listM365Tenants(): Promise<M365TenantRecord[]> {
  const rows = await dbAll<M365TenantRow>(
    "SELECT tenant_id, status, display_name, allowed_scopes, consented_at, ai_enabled, created_at, updated_at FROM m365_tenants ORDER BY updated_at DESC",
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
}): Promise<M365TenantRecord> {
  const scopes = normalizeScopes(input.allowedScopes);
  await dbRun(
    `INSERT INTO m365_tenants (tenant_id, status, display_name, allowed_scopes, consented_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET status = excluded.status, display_name = excluded.display_name,
       allowed_scopes = excluded.allowed_scopes, consented_at = excluded.consented_at, updated_at = CURRENT_TIMESTAMP`,
    [
      input.tenantId,
      input.status,
      input.displayName || null,
      JSON.stringify(scopes),
      input.consentedAt || null,
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
