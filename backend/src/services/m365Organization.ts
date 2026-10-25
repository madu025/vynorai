import crypto from "node:crypto";
import { dbGet, dbRun } from "../db.js";
import type { M365Identity } from "./m365Policy.js";
import {
  assertM365SeatAvailable,
  type M365Entitlement,
} from "./m365Entitlements.js";
import type { M365TenantRecord } from "./m365TenantRegistry.js";

/**
 * A technical principal is not a Vynor login and has no usable password or API key. It exists only
 * because the legacy economics/audit tables intentionally require a real users FK. The Entra
 * tenant/object pair remains the authentication and billing identity; this row can never log in.
 */
export const M365_ORGANIZATION_PRINCIPAL_KIND = "m365_org_principal" as const;

export interface M365OrganizationPrincipal {
  userId: string;
  email: string;
  mode: "organization";
  linkedVia: "organization";
}

function principalHash(
  identity: Pick<M365Identity, "tenantId" | "objectId">,
): string {
  return crypto
    .createHash("sha256")
    .update(`${identity.tenantId}\u0000${identity.objectId}`)
    .digest("hex");
}

function principalIds(identity: Pick<M365Identity, "tenantId" | "objectId">) {
  const hash = principalHash(identity);
  return {
    userId: `m365-org-${hash.slice(0, 48)}`,
    email: `m365-org-${hash.slice(0, 32)}@invalid.vynorai.internal`,
    apiKey: `m365_internal_disabled_${hash}`,
  };
}

/** Returns an existing organisation principal, or provisions one for an active org tenant. */
export async function ensureM365OrganizationPrincipal(
  identity: Pick<M365Identity, "tenantId" | "objectId">,
  tenant: M365TenantRecord,
  entitlement: M365Entitlement,
): Promise<M365OrganizationPrincipal> {
  if (tenant.billingMode !== "organization")
    throw new Error("m365_organization_mode_required");
  if (!tenant.autoProvisionMembers)
    throw new Error("m365_organization_provisioning_disabled");
  if (!entitlement.active || entitlement.source !== "tenant")
    throw new Error("M365_ORG_BILLING_INACTIVE");

  const existing = await dbGet<{
    user_id: string;
    email: string;
    account_kind: string | null;
    linked_via: string | null;
  }>(
    `SELECT l.user_id, u.email, u.account_kind, l.linked_via
     FROM m365_identity_links l JOIN users u ON u.id = l.user_id
     WHERE l.tenant_id = ? AND l.object_id = ? AND l.enabled = 1`,
    [identity.tenantId, identity.objectId],
  );
  if (existing) {
    if (
      existing.account_kind !== M365_ORGANIZATION_PRINCIPAL_KIND ||
      existing.linked_via !== "organization"
    )
      throw new Error("M365_ORG_IDENTITY_REQUIRES_ADMIN_MIGRATION");
    return {
      userId: existing.user_id,
      email: existing.email,
      mode: "organization",
      linkedVia: "organization",
    };
  }

  await assertM365SeatAvailable(identity.tenantId, identity.objectId);
  const ids = principalIds(identity);
  await dbRun(
    `INSERT INTO users
       (id, email, password_hash, api_key, api_key_hash, api_key_masked, name, email_verified, account_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      ids.userId,
      ids.email,
      "!m365-organization-principal-disabled",
      ids.apiKey,
      crypto.createHash("sha256").update(ids.apiKey).digest("hex"),
      "m365_internal_disabled",
      tenant.displayName || "M365 organization member",
      M365_ORGANIZATION_PRINCIPAL_KIND,
    ],
  );
  const linked = await dbRun(
    `INSERT INTO m365_identity_links
       (tenant_id, object_id, user_id, enabled, linked_via)
     VALUES (?, ?, ?, 1, 'organization')
     ON CONFLICT(tenant_id, object_id) DO NOTHING`,
    [identity.tenantId, identity.objectId, ids.userId],
  );
  const final = await dbGet<{
    user_id: string;
    email: string;
    account_kind: string | null;
    linked_via: string | null;
  }>(
    `SELECT l.user_id, u.email, u.account_kind, l.linked_via
     FROM m365_identity_links l JOIN users u ON u.id = l.user_id
     WHERE l.tenant_id = ? AND l.object_id = ? AND l.enabled = 1`,
    [identity.tenantId, identity.objectId],
  );
  if (!final) {
    if (linked.changes === 0)
      await dbRun(
        "DELETE FROM users WHERE id = ? AND account_kind = ? AND NOT EXISTS (SELECT 1 FROM m365_identity_links WHERE user_id = ?)",
        [ids.userId, M365_ORGANIZATION_PRINCIPAL_KIND, ids.userId],
      ).catch(() => undefined);
    throw new Error("M365_ORG_PRINCIPAL_PROVISION_FAILED");
  }
  if (
    final.account_kind !== M365_ORGANIZATION_PRINCIPAL_KIND ||
    final.linked_via !== "organization"
  )
    throw new Error("M365_ORG_IDENTITY_REQUIRES_ADMIN_MIGRATION");
  return {
    userId: final.user_id,
    email: final.email,
    mode: "organization",
    linkedVia: "organization",
  };
}
