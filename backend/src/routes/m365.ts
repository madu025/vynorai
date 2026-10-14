import { Router, Request, Response, NextFunction } from "express";
import { dbGet } from "../db.js";
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";
import { logSecurityEvent } from "../services/securityAudit.js";
import {
  createM365ApprovalToken,
  validateEntraAccessToken,
  validateM365Identity,
  verifyM365ApprovalToken,
} from "../services/m365Policy.js";
import { createServerExcelPreviewPlan } from "../services/m365ExcelPlan.js";
import { requireM365TenantScope } from "../services/m365TenantRegistry.js";
import { z, validateBody } from "../middleware/validate.js";

const excelPlanSchema = z.object({
  workbookId: z.string().min(1).max(200),
  worksheetName: z.string().min(1).max(128),
  address: z.string().min(1).max(128),
  values: z
    .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .min(1)
    .max(100_000),
  hasHeaders: z.boolean().optional(),
  actions: z
    .array(z.enum(["table", "chart", "new-sheet", "pivot-table"]))
    .min(1)
    .max(4),
  chunkRows: z.number().int().min(1).max(5000).optional(),
});

const applySchema = z.object({
  planId: z.string().min(1).max(100),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvalToken: z.string().min(1),
  confirmed: z.literal(true),
});

function identity(req: Request) {
  return (req as any).m365Identity;
}

async function requireM365Auth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer "))
    return res
      .status(401)
      .json({
        error: {
          code: "OAUTH_REQUIRED",
          message: "Entra OAuth access token required",
        },
      });
  try {
    const m365Identity = await validateEntraAccessToken(
      authorization.slice("Bearer ".length).trim(),
    );
    validateM365Identity(m365Identity, "m365.excel.read");
    await requireM365TenantScope(m365Identity.tenantId, "m365.excel.read");
    const link = await dbGet<{
      user_id: string;
      email: string;
      subscription_plan?: string;
    }>(
      "SELECT l.user_id, u.email, s.plan_name as subscription_plan FROM m365_identity_links l JOIN users u ON u.id = l.user_id LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' WHERE l.tenant_id = ? AND l.object_id = ? AND l.enabled = 1 ORDER BY s.valid_until DESC LIMIT 1",
      [m365Identity.tenantId, m365Identity.objectId],
    );
    if (!link)
      return res
        .status(403)
        .json({ error: { code: "M365_IDENTITY_NOT_LINKED" } });
    (req as any).m365Identity = m365Identity;
    (req as any).user = {
      id: link.user_id,
      email: link.email,
      subscriptionPlan: link.subscription_plan || "free",
    };
    next();
  } catch (error) {
    return res
      .status(401)
      .json({
        error: { code: (error as Error).message || "INVALID_OAUTH_TOKEN" },
      });
  }
}

export const m365Router = Router();
m365Router.post(
  "/excel/plan",
  requireM365Auth,
  validateBody(excelPlanSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const tenant = identity(req);
    const usage = await getOrInitMonthlyUsage(
      user.id,
      user.subscriptionPlan || "free",
    );
    if (usage.used_tokens >= usage.max_tokens)
      return res.status(403).json({ error: { code: "CREDITS_EXHAUSTED" } });
    const plan = createServerExcelPreviewPlan(
      req.body,
      req.body.actions,
      req.body.chunkRows,
    );
    const planId = cryptoId(plan.sourceFingerprint);
    const approvalToken = createM365ApprovalToken({
      planId,
      tenantId: tenant.tenantId,
      objectId: tenant.objectId,
      sourceFingerprint: plan.sourceFingerprint,
    });
    await logSecurityEvent({
      eventType: "M365_EXCEL_PLAN_CREATED",
      actor: user.id,
      target: tenant.tenantId,
      details: JSON.stringify({
        operationId: planId,
        actionCount: plan.actions.length,
        rowCount: plan.profile.rowCount,
      }),
    });
    res.json({
      ...plan,
      planId,
      approvalToken,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  },
);

m365Router.post(
  "/excel/apply",
  requireM365Auth,
  validateBody(applySchema),
  async (req: Request, res: Response) => {
    const tenant = identity(req);
    try {
      validateM365Identity(tenant, "m365.excel.write");
      await requireM365TenantScope(tenant.tenantId, "m365.excel.write");
      verifyM365ApprovalToken(req.body.approvalToken, {
        planId: req.body.planId,
        tenantId: tenant.tenantId,
        objectId: tenant.objectId,
        sourceFingerprint: req.body.sourceFingerprint,
      });
    } catch (error) {
      return res
        .status(403)
        .json({ error: { code: (error as Error).message } });
    }
    await logSecurityEvent({
      eventType: "M365_EXCEL_APPLY_APPROVED",
      actor: (req as any).user.id,
      target: tenant.tenantId,
      details: JSON.stringify({ operationId: req.body.planId }),
    });
    res.json({
      approved: true,
      operationId: req.body.planId,
      message:
        "Approval granted; the Office client may apply the unchanged-source plan.",
    });
  },
);

function cryptoId(value: string): string {
  return `m365_${value.slice(0, 24)}`;
}
