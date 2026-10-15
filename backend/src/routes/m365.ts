import { Router, Request, Response, NextFunction } from "express";
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";
import { logSecurityEvent } from "../services/securityAudit.js";
import {
  createM365ApprovalToken,
  consumeM365ApprovalToken,
  reportM365ApprovalResult,
  validateEntraAccessToken,
  validateM365Identity,
} from "../services/m365Policy.js";
import {
  createServerExcelPreviewPlan,
  InvalidExcelRangeError,
} from "../services/m365ExcelPlan.js";
import { requireM365TenantScope } from "../services/m365TenantRegistry.js";
import {
  diagnoseM365Identity,
  findM365IdentityLink,
} from "../services/m365Diagnostics.js";
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

const applyResultSchema = z.object({
  planId: z.string().min(1).max(100),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvalToken: z.string().min(1),
  status: z.enum([
    "applied",
    "partial_failure",
    "client_failure",
    "source_verification_failed",
  ]),
  sourceUnchanged: z.boolean().optional(),
  results: z
    .array(
      z.object({
        kind: z.enum(["table", "chart", "new-sheet", "pivot-table"]),
        status: z.enum(["created", "exists", "failed", "skipped_unsupported"]),
      }),
    )
    .max(4),
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
    return res.status(401).json({
      error: {
        code: "OAUTH_REQUIRED",
        message: "Entra OAuth access token required",
      },
    });
  try {
    const m365Identity = await validateEntraAccessToken(
      authorization.slice("Bearer ".length).trim(),
    );
    try {
      validateM365Identity(m365Identity, "m365.excel.read");
      await requireM365TenantScope(m365Identity.tenantId, "m365.excel.read");
    } catch (error) {
      const code = (error as Error).message || "M365_POLICY_DENIED";
      if (code === "tenant_disabled") {
        await logSecurityEvent({
          eventType: "M365_TENANT_ACCESS_REQUESTED",
          actor: m365Identity.objectId,
          target: m365Identity.tenantId,
          details: JSON.stringify({ requiredScope: "m365.excel.read" }),
          ipAddress: req.ip,
        });
      }
      return res.status(403).json({ error: { code } });
    }
    const link = await findM365IdentityLink(
      m365Identity.tenantId,
      m365Identity.objectId,
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
    return res.status(401).json({
      error: { code: (error as Error).message || "INVALID_OAUTH_TOKEN" },
    });
  }
}

export const m365Router = Router();

/** Per-gate access report for the task pane; needs a valid Entra token, changes no access state. */
m365Router.get("/diagnostics", async (req: Request, res: Response) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer "))
    return res.json({
      stages: [{ name: "token", ok: false, code: "OAUTH_REQUIRED" }],
      ready: { read: false, write: false },
    });
  let m365Identity;
  try {
    m365Identity = await validateEntraAccessToken(
      authorization.slice("Bearer ".length).trim(),
    );
  } catch (error) {
    return res.json({
      stages: [
        {
          name: "token",
          ok: false,
          code: (error as Error).message || "INVALID_OAUTH_TOKEN",
        },
      ],
      ready: { read: false, write: false },
    });
  }
  res.json(await diagnoseM365Identity(m365Identity));
});
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
    let plan;
    try {
      plan = createServerExcelPreviewPlan(
        req.body,
        req.body.actions,
        req.body.chunkRows,
      );
    } catch (error) {
      if (error instanceof InvalidExcelRangeError)
        return res.status(422).json({
          error: { code: error.code, message: error.message },
        });
      throw error;
    }
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
      await consumeM365ApprovalToken(req.body.approvalToken, {
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

m365Router.post(
  "/excel/apply-result",
  requireM365Auth,
  validateBody(applyResultSchema),
  async (req: Request, res: Response) => {
    const tenant = identity(req);
    try {
      validateM365Identity(tenant, "m365.excel.write");
      await requireM365TenantScope(tenant.tenantId, "m365.excel.write");
      const failures = req.body.results.filter(
        (result: { status: string }) => result.status === "failed",
      ).length;
      if (
        req.body.status === "applied" &&
        (req.body.results.length === 0 ||
          failures > 0 ||
          req.body.sourceUnchanged !== true)
      )
        throw new Error("invalid_apply_result");
      if (
        req.body.status === "partial_failure" &&
        (req.body.results.length === 0 || failures === 0)
      )
        throw new Error("invalid_apply_result");
      if (req.body.status === "client_failure" && req.body.results.length !== 0)
        throw new Error("invalid_apply_result");
      await reportM365ApprovalResult(
        req.body.approvalToken,
        {
          planId: req.body.planId,
          tenantId: tenant.tenantId,
          objectId: tenant.objectId,
          sourceFingerprint: req.body.sourceFingerprint,
        },
        {
          status: req.body.status,
          sourceUnchanged: req.body.sourceUnchanged,
          actionCount: req.body.results.length,
          failureCount: failures,
        },
      );
      await logSecurityEvent({
        eventType: "M365_EXCEL_APPLY_RESULT",
        actor: (req as any).user.id,
        target: tenant.tenantId,
        details: JSON.stringify({
          operationId: req.body.planId,
          status: req.body.status,
          sourceUnchanged: req.body.sourceUnchanged,
          actionCount: req.body.results.length,
          failureCount: failures,
          failedKinds: req.body.results
            .filter((result: { status: string }) => result.status === "failed")
            .map((result: { kind: string }) => result.kind),
        }),
      });
    } catch (error) {
      return res
        .status(409)
        .json({ error: { code: (error as Error).message } });
    }
    res.json({ recorded: true, operationId: req.body.planId });
  },
);

function cryptoId(value: string): string {
  return `m365_${value.slice(0, 24)}`;
}
