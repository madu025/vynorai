import { dbGet } from "../db.js";
import { validateM365Identity, type M365Identity } from "./m365Policy.js";
import { getM365Tenant, requireM365TenantScope } from "./m365TenantRegistry.js";
import { resolveM365Entitlement } from "./m365Entitlements.js";
import {
  summarizeM365Quota,
  type M365QuotaSummary,
} from "./m365QuotaLedger.js";
import {
  baseCapabilityContext,
  resolveAllCapabilities,
  type AdvancedCapabilityReport,
} from "./m365Capabilities.js";

const M365_SCOPES = ["m365.excel.read", "m365.excel.write"] as const;

export const M365_EXCEL_ACTION_KINDS = [
  "table",
  "chart",
  "new-sheet",
  "named-range",
  "slicer",
  "pivot-table",
  "clean",
  "add-column",
  "lookup-columns",
  "split-column",
  "unpivot",
  "summary",
  "format",
  "quality",
  "statistics",
  "dashboard",
  "view",
  "export-csv",
  "export-pdf",
] as const;

export interface M365IdentityLink {
  user_id: string;
  email: string;
  subscription_plan?: string;
}

export interface M365DiagnosticStage {
  name: string;
  ok: boolean;
  code?: string;
  detail?: Record<string, unknown>;
}

export interface M365Capabilities {
  contractVersion: 1;
  excel: {
    canInspect: boolean;
    canPreview: boolean;
    canApply: boolean;
    actionKinds: readonly string[];
    writableActionKinds: readonly string[];
  };
  aiAnalysis: boolean;
  subscription: {
    planId: string;
    planDisplayName: string;
    source: "tenant" | "user" | "free";
    active: boolean;
    seatLimit: number | null;
    activeSeats: number;
    seatsRemaining: number | null;
    validUntil: string | null;
    tenantPlanConfigured: boolean;
  };
  /** The tenant-scoped M365 credit ledger. Separate from the user's VS Code allowance. */
  quota: M365QuotaSummary;
  /** Per-feature verdicts from the shared registry (m365Capabilities.ts). */
  advanced: AdvancedCapabilityReport;
}

/** Enabled link from a validated Entra identity to a VynorAI account; email is never the key. */
export function findM365IdentityLink(
  tenantId: string,
  objectId: string,
): Promise<M365IdentityLink | undefined> {
  return dbGet<M365IdentityLink>(
    "SELECT l.user_id, u.email, s.plan_name as subscription_plan FROM m365_identity_links l JOIN users u ON u.id = l.user_id LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' WHERE l.tenant_id = ? AND l.object_id = ? AND l.enabled = 1 ORDER BY s.valid_until DESC LIMIT 1",
    [tenantId, objectId],
  );
}

/**
 * Runs every access gate independently for an already signature-validated identity so the
 * task pane can show which gate fails. It never changes tenant, identity or approval state
 * and it returns no account email, token or workbook data.
 */
export async function diagnoseM365Identity(identity: M365Identity): Promise<{
  stages: M365DiagnosticStage[];
  ready: Record<"read" | "write", boolean>;
}> {
  const stages: M365DiagnosticStage[] = [
    {
      name: "token",
      ok: true,
      detail: {
        tenantId: identity.tenantId,
        objectId: identity.objectId,
        scopes: identity.scopes,
      },
    },
  ];
  const passed = (name: string) =>
    stages.find((stage) => stage.name === name)?.ok === true;

  for (const scope of M365_SCOPES) {
    try {
      validateM365Identity(identity, scope);
      stages.push({ name: `policy:${scope}`, ok: true });
    } catch (error) {
      stages.push({
        name: `policy:${scope}`,
        ok: false,
        code: (error as Error).message,
      });
    }
  }

  const tenant = await getM365Tenant(identity.tenantId);
  stages.push({
    name: "tenant",
    ok: tenant?.status === "enabled",
    code: tenant ? undefined : "tenant_not_registered",
    detail: tenant
      ? {
          status: tenant.status,
          allowedScopes: tenant.allowedScopes,
          hasConsentEvidence: Boolean(tenant.consentedAt),
        }
      : undefined,
  });
  for (const scope of M365_SCOPES) {
    try {
      await requireM365TenantScope(identity.tenantId, scope);
      stages.push({ name: `tenant:${scope}`, ok: true });
    } catch (error) {
      stages.push({
        name: `tenant:${scope}`,
        ok: false,
        code: (error as Error).message,
      });
    }
  }

  const link = await findM365IdentityLink(identity.tenantId, identity.objectId);
  stages.push({
    name: "identity",
    ok: Boolean(link),
    code: link ? undefined : "M365_IDENTITY_NOT_LINKED",
  });

  if (link) {
    const entitlement = await resolveM365Entitlement(
      identity.tenantId,
      identity.objectId,
    );
    stages.push({
      name: "subscription",
      ok: entitlement.active,
      code: entitlement.active ? undefined : "M365_SUBSCRIPTION_INACTIVE",
      detail: {
        planId: entitlement.planId,
        source: entitlement.source,
        seatLimit: entitlement.seatLimit,
        activeSeats: entitlement.activeSeats,
        seatsRemaining: entitlement.seatsRemaining,
        validUntil: entitlement.validUntil,
      },
    });
    // Credits come from the organisation's M365 ledger, never the user's VS Code monthly_usage.
    const quota = await summarizeM365Quota(identity, {
      planId: entitlement.planId,
      source: entitlement.source,
    });
    // No active row means the first billable request will initialise a fresh cycle.
    const available = quota.freshCycle || quota.usedCredits < quota.maxCredits;
    stages.push({
      name: "credits",
      ok: available,
      code: available ? undefined : "CREDITS_EXHAUSTED",
      detail: {
        scope: quota.scope,
        plan: quota.planId,
        planSource: quota.planSource,
      },
    });
  } else {
    stages.push({ name: "credits", ok: false, code: "skipped_no_identity" });
    stages.push({
      name: "subscription",
      ok: false,
      code: "skipped_no_identity",
    });
  }

  const shared = passed("identity") && passed("credits");
  return {
    stages,
    ready: {
      read:
        shared &&
        passed("policy:m365.excel.read") &&
        passed("tenant:m365.excel.read"),
      write:
        shared &&
        passed("policy:m365.excel.read") &&
        passed("tenant:m365.excel.read") &&
        passed("policy:m365.excel.write") &&
        passed("tenant:m365.excel.write"),
    },
  };
}

/** Effective non-secret capability flags for the linked tenant/user. */
export async function getM365Capabilities(
  identity: M365Identity,
): Promise<M365Capabilities> {
  const diagnostics = await diagnoseM365Identity(identity);
  const tenant = await getM365Tenant(identity.tenantId);
  const subscription = await resolveM365Entitlement(
    identity.tenantId,
    identity.objectId,
  );
  const actionKinds = diagnostics.ready.read ? M365_EXCEL_ACTION_KINDS : [];
  const writableActionKinds = diagnostics.ready.write
    ? M365_EXCEL_ACTION_KINDS
    : [];
  return {
    contractVersion: 1,
    excel: {
      canInspect: diagnostics.ready.read,
      canPreview: diagnostics.ready.read,
      canApply: diagnostics.ready.write,
      actionKinds,
      writableActionKinds,
    },
    aiAnalysis: diagnostics.ready.read && (tenant?.aiEnabled ?? false),
    subscription,
    quota: await summarizeM365Quota(identity, {
      planId: subscription.planId,
      source: subscription.source,
    }),
    advanced: resolveAllCapabilities(
      baseCapabilityContext({
        canRead: diagnostics.ready.read,
        canWrite: diagnostics.ready.write,
        aiEnabled: tenant?.aiEnabled ?? false,
        // Host facts (platform, Excel API sets, companion) are added by the pane; the server only
        // knows the account. Optional layers are reported honestly as not provisioned.
        companion: "not_installed",
        sandbox: "unavailable",
      }),
    ),
  };
}
