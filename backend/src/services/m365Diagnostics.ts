import { dbGet } from "../db.js";
import { validateM365Identity, type M365Identity } from "./m365Policy.js";
import { getM365Tenant, requireM365TenantScope } from "./m365TenantRegistry.js";

const M365_SCOPES = ["m365.excel.read", "m365.excel.write"] as const;

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
    const usage = await dbGet<{ used_tokens: number; max_tokens: number }>(
      "SELECT used_tokens, max_tokens FROM monthly_usage WHERE user_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
      [link.user_id, new Date().toISOString().slice(0, 10)],
    );
    // No active row means the first billable request will initialise a fresh cycle.
    const available = !usage || usage.used_tokens < usage.max_tokens;
    stages.push({
      name: "credits",
      ok: available,
      code: available ? undefined : "CREDITS_EXHAUSTED",
      detail: { plan: link.subscription_plan || "free" },
    });
  } else {
    stages.push({ name: "credits", ok: false, code: "skipped_no_identity" });
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
