import crypto from "node:crypto";
import { Router, Request, Response, NextFunction } from "express";
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";
import { logSecurityEvent } from "../services/securityAudit.js";
import {
  createM365ApprovalToken,
  consumeM365ApprovalToken,
  reportM365ApprovalResult,
  validateEntraAccessToken,
  validateM365Identity,
  type M365Scope,
} from "../services/m365Policy.js";
import {
  assistRequestSchema,
  assistText,
  TEXT_ASSIST_CONTRACT_VERSION,
} from "../services/m365TextAssist.js";
import {
  DOC_DRAFT_CONTRACT_VERSION,
  draftDocument,
  draftRequestSchema,
} from "../services/m365DocDraft.js";
import {
  createServerExcelPreviewPlan,
  InvalidExcelRangeError,
} from "../services/m365ExcelPlan.js";
import {
  getM365Tenant,
  requireM365TenantScope,
} from "../services/m365TenantRegistry.js";
import {
  diagnoseM365Identity,
  findM365IdentityLink,
  getM365Capabilities,
} from "../services/m365Diagnostics.js";
import {
  analyzeSchemaSummary,
  ANALYSIS_CONTRACT_VERSION,
  assertAnalysisRateLimit,
  M365AnalysisError,
} from "../services/m365Analysis.js";
import { z, validateBody } from "../middleware/validate.js";

const excelPlanSchema = z.object({
  workbookId: z.string().min(1).max(200),
  worksheetName: z.string().min(1).max(128),
  address: z.string().min(1).max(128),
  values: z
    .array(
      z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .max(100),
    )
    .min(1)
    .max(100_000),
  hasHeaders: z.boolean().optional(),
  // Set when `values` is a sample of a much larger range (`address` stays the whole range).
  sample: z
    .object({
      totalRows: z.number().int().min(2).max(1_048_576),
      sampledRows: z.number().int().min(2).max(100_000),
    })
    .optional(),
  actions: z
    .array(
      z.enum([
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
      ]),
    )
    .min(1)
    .max(10),
  chunkRows: z.number().int().min(1).max(5000).optional(),
  specs: z
    .object({
      namedRange: z
        .object({ source: z.number().int().min(0).max(99) })
        .strict()
        .optional(),
      slicer: z
        .object({ source: z.number().int().min(0).max(99) })
        .strict()
        .optional(),
      chart: z
        .object({
          category: z.number().int().min(0).max(99),
          value: z.number().int().min(0).max(99),
          chartType: z.enum([
            "column",
            "line",
            "bar",
            "pie",
            "stacked-column",
            "stacked-bar",
            "area",
            "combo",
            "histogram",
            "waterfall",
          ]),
          extraValues: z
            .array(z.number().int().min(0).max(99))
            .max(4)
            .optional(),
          showDataLabels: z.boolean().optional(),
          pivotResult: z.boolean().optional(),
        })
        .strict()
        .optional(),
      pivot: z
        .object({
          rows: z.number().int().min(0).max(99),
          values: z.number().int().min(0).max(99),
          aggregation: z
            .enum(["sum", "count", "average", "min", "max"])
            .optional(),
          columns: z.number().int().min(0).max(99).optional(),
          filter: z.number().int().min(0).max(99).optional(),
          extraValues: z
            .array(z.number().int().min(0).max(99))
            .max(3)
            .optional(),
          showAs: z.enum(["percent-of-total", "percent-of-column"]).optional(),
          topN: z.number().int().min(1).max(100).optional(),
        })
        .strict()
        .optional(),
      clean: z
        .object({
          operations: z
            .array(
              z.enum([
                "trim",
                "text-to-number",
                "text-to-date",
                "fill-blanks",
                "dedupe",
                "fuzzy-dedupe",
              ]),
            )
            .min(1)
            .max(5),
          fillBlanks: z
            .union([z.string().min(1).max(100), z.number().finite()])
            .optional(),
          fillBlanksColumn: z.number().int().min(0).max(99).optional(),
        })
        .strict()
        .optional(),
      quality: z
        .object({ mode: z.enum(["data", "formula", "repair"]) })
        .strict()
        .optional(),
      statistics: z
        .object({
          mode: z.enum(["describe", "correlation", "forecast", "insights"]),
          columns: z.array(z.number().int().min(0).max(99)).max(8).optional(),
          pair: z
            .tuple([
              z.number().int().min(0).max(99),
              z.number().int().min(0).max(99),
            ])
            .optional(),
          value: z.number().int().min(0).max(99).optional(),
          periods: z.number().int().min(1).max(24).optional(),
          category: z.number().int().min(0).max(99).optional(),
          date: z.number().int().min(0).max(99).optional(),
        })
        .strict()
        .optional(),
      dashboard: z
        .object({
          category: z.number().int().min(0).max(99),
          values: z.array(z.number().int().min(0).max(99)).min(1).max(3),
          aggregation: z
            .enum(["sum", "count", "average", "min", "max"])
            .optional(),
        })
        .strict()
        .optional(),
      view: z
        .object({
          sort: z
            .object({
              column: z.number().int().min(0).max(99),
              direction: z.enum(["asc", "desc"]),
            })
            .strict()
            .optional(),
          filter: z
            .object({
              column: z.number().int().min(0).max(99),
              operator: z.enum([">", ">=", "<", "<=", "=", "!=", "contains"]),
              value: z.union([z.string().min(1).max(80), z.number().finite()]),
            })
            .strict()
            .optional(),
          highlight: z
            .object({
              column: z.number().int().min(0).max(99),
              rule: z.enum([
                "top-n",
                "bottom-n",
                "above-average",
                "below-average",
                "duplicates",
              ]),
              n: z.number().int().min(1).max(100).optional(),
            })
            .strict()
            .optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        })
        .strict()
        .optional(),
      format: z
        .object({
          freezeHeader: z.boolean().optional(),
          autofit: z.boolean().optional(),
          numberFormats: z.boolean().optional(),
          totalRow: z.boolean().optional(),
          conditional: z
            .array(
              z
                .object({
                  column: z.number().int().min(0).max(99),
                  rule: z.enum([
                    "data-bars",
                    "color-scale",
                    "negative",
                    "duplicates",
                    "icon-set",
                    "custom-formula",
                    "top-n",
                    "bottom-n",
                    "text-contains",
                    "date-range",
                  ]),
                  operator: z
                    .enum([">", ">=", "<", "<=", "=", "<>"])
                    .optional(),
                  value: z.number().finite().optional(),
                  n: z.number().int().min(1).max(100).optional(),
                  text: z.string().trim().min(1).max(80).optional(),
                  startDate: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .optional(),
                  endDate: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .optional(),
                })
                .strict(),
            )
            .max(6)
            .optional(),
          validation: z
            .array(
              z
                .object({
                  column: z.number().int().min(0).max(99),
                  rule: z.enum([
                    "list",
                    "non-negative",
                    "between",
                    "max-length",
                  ]),
                  min: z.number().finite().optional(),
                  max: z.number().finite().optional(),
                })
                .strict(),
            )
            .max(4)
            .optional(),
          inputMessage: z
            .object({
              column: z.number().int().min(0).max(99),
              title: z.string().min(1).max(32).optional(),
              message: z.string().min(1).max(255).optional(),
            })
            .strict()
            .optional(),
          dependentDropdown: z
            .object({
              child: z.number().int().min(0).max(99),
              parent: z.number().int().min(0).max(99),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      summary: z
        .object({
          group: z.number().int().min(0).max(99),
          values: z
            .array(
              z
                .object({
                  column: z.number().int().min(0).max(99),
                  aggregation: z.enum([
                    "sum",
                    "count",
                    "average",
                    "min",
                    "max",
                  ]),
                })
                .strict(),
            )
            .min(1)
            .max(4),
          total: z.boolean().optional(),
        })
        .strict()
        .optional(),
      addColumn: z
        .object({
          name: z.string().min(1).max(40),
          left: z.number().int().min(0).max(99).optional(),
          operator: z.enum(["+", "-", "*", "/"]).optional(),
          right: z.number().int().min(0).max(99).optional(),
          expression: z.string().min(1).max(240).optional(),
          derived: z
            .enum([
              "running-total",
              "rank",
              "percent-change",
              "moving-average",
              "yoy",
              "date-group",
              "combine",
            ])
            .optional(),
          source: z.number().int().min(0).max(99).optional(),
          source2: z.number().int().min(0).max(99).optional(),
          window: z.number().int().min(2).max(12).optional(),
          lag: z.number().int().min(12).max(12).optional(),
          group: z.enum(["month", "quarter", "year"]).optional(),
          lookup: z
            .object({
              sheet: z.string().min(1).max(31),
              sourceKey: z.number().int().min(0).max(99),
              keyIndex: z.number().int().min(0).max(99),
              keyHeader: z.string().min(1).max(60),
              returnIndex: z.number().int().min(0).max(99),
              returnHeader: z.string().min(1).max(60),
              rows: z.number().int().min(1).max(100000),
              sourceKeys: z
                .array(z.number().int().min(0).max(99))
                .min(1)
                .max(5)
                .optional(),
              keyIndexes: z
                .array(z.number().int().min(0).max(99))
                .min(1)
                .max(5)
                .optional(),
              keyHeaders: z
                .array(z.string().min(1).max(60))
                .min(1)
                .max(5)
                .optional(),
              matchMode: z.enum(["exact", "approximate"]).optional(),
              method: z.enum(["index-match", "xlookup"]).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      lookupColumns: z
        .object({
          names: z.array(z.string().min(1).max(40)).min(2).max(5),
          lookup: z
            .object({
              sheet: z.string().min(1).max(31),
              sourceKey: z.number().int().min(0).max(99),
              keyIndex: z.number().int().min(0).max(99),
              keyHeader: z.string().min(1).max(60),
              returnIndexes: z
                .array(z.number().int().min(0).max(99))
                .min(2)
                .max(5),
              returnHeaders: z.array(z.string().min(1).max(60)).min(2).max(5),
              rows: z.number().int().min(1).max(100000),
              sourceKeys: z
                .array(z.number().int().min(0).max(99))
                .min(1)
                .max(5)
                .optional(),
              keyIndexes: z
                .array(z.number().int().min(0).max(99))
                .min(1)
                .max(5)
                .optional(),
              keyHeaders: z
                .array(z.string().min(1).max(60))
                .min(1)
                .max(5)
                .optional(),
              matchMode: z.enum(["exact", "approximate"]).optional(),
              method: z.enum(["index-match", "xlookup"]).optional(),
            })
            .strict(),
        })
        .strict()
        .optional(),
      split: z
        .object({
          source: z.number().int().min(0).max(99),
          firstName: z.string().min(1).max(40),
          lastName: z.string().min(1).max(40),
        })
        .strict()
        .optional(),
      unpivot: z
        .object({
          values: z.array(z.number().int().min(0).max(99)).min(2).max(20),
          name: z.string().min(1).max(40),
          value: z.string().min(1).max(40),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
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
        kind: z.enum([
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
        ]),
        status: z.enum(["created", "exists", "failed", "skipped_unsupported"]),
      }),
    )
    .max(10),
});

const rollbackSchema = z
  .object({
    planId: z.string().min(1).max(100),
    removedSheets: z.number().int().min(0).max(10),
    convertedTables: z.number().int().min(0).max(1),
    removedNames: z.number().int().min(0).max(10),
  })
  .strict();

function identity(req: Request) {
  return (req as any).m365Identity;
}

function requireM365Scope(requiredScope: M365Scope) {
  return async (req: Request, res: Response, next: NextFunction) => {
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
        validateM365Identity(m365Identity, requiredScope);
        await requireM365TenantScope(m365Identity.tenantId, requiredScope);
      } catch (error) {
        const code = (error as Error).message || "M365_POLICY_DENIED";
        if (code === "tenant_disabled") {
          await logSecurityEvent({
            eventType: "M365_TENANT_ACCESS_REQUESTED",
            actor: m365Identity.objectId,
            target: m365Identity.tenantId,
            details: JSON.stringify({ requiredScope }),
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
  };
}

const requireM365Auth = requireM365Scope("m365.excel.read");
const requireM365TextAuth = requireM365Scope("m365.text.read");

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
m365Router.get(
  "/excel/capabilities",
  requireM365Auth,
  async (req: Request, res: Response) => {
    res.json(await getM365Capabilities(identity(req)));
  },
);
m365Router.post(
  "/excel/plan",
  requireM365Auth,
  validateBody(excelPlanSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const tenant = identity(req);
    const cellCount = req.body.values.reduce(
      (total: number, row: unknown[]) => total + row.length,
      0,
    );
    const textChars = req.body.values.reduce(
      (total: number, row: unknown[]) =>
        total +
        row.reduce(
          (rowTotal: number, cell: unknown) =>
            rowTotal + (typeof cell === "string" ? cell.length : 0),
          0,
        ),
      0,
    );
    if (cellCount > 100_000 || textChars > 2_000_000)
      return res.status(422).json({
        error: {
          code: "EXCEL_SELECTION_TOO_LARGE",
          message:
            "Select at most 100,000 cells and 2,000,000 text characters.",
        },
      });
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
        req.body.specs,
      );
    } catch (error) {
      if (error instanceof InvalidExcelRangeError)
        return res.status(422).json({
          error: { code: error.code, message: error.message },
        });
      throw error;
    }
    // The id covers the exact actions (including column choices), so an approval for one plan
    // can never be replayed for a different set of workbook changes on the same source.
    const planId = cryptoId(
      crypto
        .createHash("sha256")
        .update(plan.sourceFingerprint + JSON.stringify(plan.actions))
        .digest("hex"),
    );
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

/**
 * AI worksheet analysis. Advisory only: it receives a privacy-preserving schema summary (never
 * cell values), needs explicit consent, and returns recommendations that can never mutate a
 * workbook. Applying anything still goes through plan, approval token and source fingerprint.
 */
m365Router.post(
  "/excel/analyze",
  requireM365Auth,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const tenant = identity(req);
    const correlationId = safeCorrelationId(req.headers["x-correlation-id"]);
    res.setHeader("x-correlation-id", correlationId);
    const tenantRecord = await getM365Tenant(tenant.tenantId);
    if (tenantRecord && !tenantRecord.aiEnabled) {
      await logSecurityEvent({
        eventType: "M365_EXCEL_ANALYSIS_DENIED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({
          reason: "ai_disabled_by_admin",
          correlationId,
        }),
      });
      return res.status(403).json({ error: { code: "AI_DISABLED_BY_ADMIN" } });
    }
    if (req.body?.consent !== true) {
      await logSecurityEvent({
        eventType: "M365_EXCEL_ANALYSIS_DENIED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({ reason: "consent_required", correlationId }),
      });
      return res.status(403).json({ error: { code: "AI_CONSENT_REQUIRED" } });
    }
    try {
      const analysis = await analyzeSchemaSummary(
        user,
        req.body.summary,
        req.body.language === "si" || req.body.language === "ta"
          ? req.body.language
          : "en",
        typeof req.body.request === "string" ? req.body.request : "",
      );
      const analysisId = `m365a_${analysis.summaryHash.slice(0, 24)}`;
      await logSecurityEvent({
        eventType: "M365_EXCEL_ANALYSIS_COMPLETED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({
          operationId: analysisId,
          correlationId,
          columnCount: req.body.summary.columnCount,
          rowCount: req.body.summary.rowCount,
          maskedCount: analysis.maskedCount,
          recommendationCount: analysis.result.recommendations.length,
          droppedRecommendations: analysis.droppedRecommendations,
        }),
      });
      return res.json({
        contractVersion: ANALYSIS_CONTRACT_VERSION,
        analysisId,
        advisoryOnly: true,
        result: analysis.result,
      });
    } catch (error) {
      const known = error instanceof M365AnalysisError;
      const code = known ? error.code : "AI_ANALYSIS_FAILED";
      console.error(
        "[m365] excel analysis failed",
        JSON.stringify({
          code,
          detail: known
            ? error.detail
            : (error as Error)?.message?.slice(0, 120),
          correlationId,
        }),
      );
      await logSecurityEvent({
        eventType: "M365_EXCEL_ANALYSIS_FAILED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({ code, correlationId }),
      });
      return res.status(known ? error.status : 500).json({ error: { code } });
    }
  },
);

/** Audit receipt for an undo of items this add-in created; carries counts only. */
m365Router.post(
  "/excel/rollback",
  requireM365Auth,
  validateBody(rollbackSchema),
  async (req: Request, res: Response) => {
    const tenant = identity(req);
    try {
      validateM365Identity(tenant, "m365.excel.write");
      await requireM365TenantScope(tenant.tenantId, "m365.excel.write");
    } catch (error) {
      return res
        .status(403)
        .json({ error: { code: (error as Error).message } });
    }
    await logSecurityEvent({
      eventType: "M365_EXCEL_ROLLBACK",
      actor: (req as any).user.id,
      target: tenant.tenantId,
      details: JSON.stringify({
        operationId: req.body.planId,
        removedSheets: req.body.removedSheets,
        convertedTables: req.body.convertedTables,
        removedNames: req.body.removedNames,
      }),
    });
    res.json({ recorded: true, operationId: req.body.planId });
  },
);

/**
 * Writing assistance for Word, PowerPoint and Outlook text. Advisory only: the add-in shows the
 * result and inserts it only after the person confirms. Nothing is ever sent or saved by this API.
 */
m365Router.post(
  "/text/assist",
  requireM365TextAuth,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const tenant = identity(req);
    const correlationId = safeCorrelationId(req.headers["x-correlation-id"]);
    res.setHeader("x-correlation-id", correlationId);
    const tenantRecord = await getM365Tenant(tenant.tenantId);
    if (tenantRecord && !tenantRecord.aiEnabled) {
      return res.status(403).json({ error: { code: "AI_DISABLED_BY_ADMIN" } });
    }
    if (req.body?.consent !== true)
      return res.status(403).json({ error: { code: "AI_CONSENT_REQUIRED" } });
    const parsed = assistRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(422).json({ error: { code: "TEXT_REQUEST_INVALID" } });
    try {
      assertAnalysisRateLimit(`text:${user.id}`);
      const result = await assistText(user, parsed.data);
      await logSecurityEvent({
        eventType: "M365_TEXT_ASSIST_COMPLETED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({
          host: parsed.data.host,
          task: parsed.data.task,
          inputChars: parsed.data.text.length,
          outputChars: result.text.length,
          correlationId,
        }),
      });
      return res.json({
        contractVersion: TEXT_ASSIST_CONTRACT_VERSION,
        advisoryOnly: true,
        result,
      });
    } catch (error) {
      const known = error instanceof M365AnalysisError;
      const code = known ? error.code : "AI_ASSIST_FAILED";
      await logSecurityEvent({
        eventType: "M365_TEXT_ASSIST_FAILED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({ code, correlationId }),
      });
      return res.status(known ? error.status : 500).json({ error: { code } });
    }
  },
);

/**
 * Structured document drafting for Word. Same boundary as text assist: consent per request, tenant
 * AI switch, strict JSON contract, nothing is stored and the add-in inserts only after confirmation.
 */
m365Router.post(
  "/text/draft",
  requireM365TextAuth,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const tenant = identity(req);
    const correlationId = safeCorrelationId(req.headers["x-correlation-id"]);
    res.setHeader("x-correlation-id", correlationId);
    const tenantRecord = await getM365Tenant(tenant.tenantId);
    if (tenantRecord && !tenantRecord.aiEnabled) {
      return res.status(403).json({ error: { code: "AI_DISABLED_BY_ADMIN" } });
    }
    if (req.body?.consent !== true)
      return res.status(403).json({ error: { code: "AI_CONSENT_REQUIRED" } });
    const parsed = draftRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(422).json({ error: { code: "DRAFT_REQUEST_INVALID" } });
    try {
      assertAnalysisRateLimit(`draft:${user.id}`);
      const draft = await draftDocument(user, parsed.data);
      await logSecurityEvent({
        eventType: "M365_DOC_DRAFT_COMPLETED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({
          kind: parsed.data.kind,
          length: parsed.data.length,
          language: parsed.data.language,
          briefChars: parsed.data.brief.length,
          blocks: draft.blocks.length,
          correlationId,
        }),
      });
      return res.json({
        contractVersion: DOC_DRAFT_CONTRACT_VERSION,
        advisoryOnly: true,
        draft,
      });
    } catch (error) {
      const known = error instanceof M365AnalysisError;
      const code = known ? error.code : "AI_DRAFT_FAILED";
      await logSecurityEvent({
        eventType: "M365_DOC_DRAFT_FAILED",
        actor: user.id,
        target: tenant.tenantId,
        details: JSON.stringify({ code, correlationId }),
      });
      return res.status(known ? error.status : 500).json({ error: { code } });
    }
  },
);

function safeCorrelationId(value: unknown): string {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(text)
    ? text
    : cryptoId(String(Date.now()) + Math.random());
}

function cryptoId(value: string): string {
  return `m365_${value.slice(0, 24)}`;
}
