/**
 * Self-service Microsoft 365 identity linking endpoints, mounted at /v1/m365/link.
 *
 * Two different callers, two different credentials:
 *  - the Excel add-in proves the MICROSOFT account with its Entra access token (`start`, `status`);
 *  - the VynorAI web page proves the VYNORAI account with a normal signed-in session (`preview`,
 *    `confirm`, `mine`, `unlink`). API keys (`vynor_live_...`) are not accepted here.
 * The flow and its threat model are described in services/m365Linking.ts.
 */
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { createRateLimiter } from "../middleware/security.js";
import {
  validateEntraAccessToken,
  validateM365Identity,
} from "../services/m365Policy.js";
import {
  ensureIndividualM365TenantForLinking,
  requireM365TenantScope,
} from "../services/m365TenantRegistry.js";
import {
  LinkErrorCode,
  confirmLinkCode,
  linkStatus,
  listOwnLinks,
  previewLinkCode,
  startLinkCode,
  unlinkOwnIdentity,
} from "../services/m365Linking.js";
import { logSecurityEvent } from "../services/securityAudit.js";
import { requireAuth } from "./auth.js";

const LINK_ERROR_STATUS: Record<LinkErrorCode, number> = {
  invalid_or_expired_code: 404,
  too_many_attempts: 429,
  email_not_verified: 403,
  tenant_disabled: 403,
  m365_already_linked: 409,
  m365_link_disabled: 403,
  m365_linked_to_another_account: 409,
  m365_seat_limit_reached: 409,
  m365_user_link_limit: 409,
  confirmation_required: 400,
};

function clientIp(req: Request): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string") return cfIp.slice(0, 64);
  return String(req.ip || req.socket.remoteAddress || "unknown").slice(0, 64);
}

function fail(res: Response, code: LinkErrorCode) {
  return res.status(LINK_ERROR_STATUS[code] ?? 400).json({ error: { code } });
}

function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Entra (RS256) access token only: a VynorAI session token never proves a Microsoft account. */
async function requireEntraIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer "))
    return res.status(401).json({ error: { code: "OAUTH_REQUIRED" } });
  const token = authorization.slice("Bearer ".length).trim();
  const decoded = jwt.decode(token, { complete: true });
  const algorithm =
    decoded && typeof decoded === "object" && "header" in decoded
      ? (decoded.header as { alg?: string }).alg
      : undefined;
  if (algorithm !== "RS256")
    return res.status(401).json({ error: { code: "entra_token_required" } });
  try {
    const identity = await validateEntraAccessToken(token);
    try {
      validateM365Identity(identity, "m365.excel.read");
      // Individual onboarding must be able to show the VynorAI connection step
      // for a first-time tenant. This row carries no plan and grants no Excel
      // access; protected routes still require the explicit identity link.
      await ensureIndividualM365TenantForLinking(identity.tenantId);
      await requireM365TenantScope(identity.tenantId, "m365.excel.read");
    } catch (error) {
      const code = (error as Error).message || "M365_POLICY_DENIED";
      if (code === "tenant_disabled")
        await logSecurityEvent({
          eventType: "M365_TENANT_ACCESS_REQUESTED",
          actor: identity.objectId,
          target: identity.tenantId,
          details: JSON.stringify({ requiredScope: "m365.excel.read" }),
          ipAddress: clientIp(req),
        });
      // The "ask an administrator" hint and the claim that a request was recorded are true only for
      // a disabled tenant; any other refusal (for example a missing scope) recorded nothing.
      return res.status(403).json({
        error:
          code === "tenant_disabled"
            ? { code, action: "admin_enable_tenant", requestRecorded: true }
            : { code },
      });
    }
    (req as any).m365LinkIdentity = identity;
    next();
  } catch (error) {
    return res.status(401).json({
      error: { code: (error as Error).message || "INVALID_OAUTH_TOKEN" },
    });
  }
}

/** A signed-in VynorAI web session; an API key is refused. */
function requireWebSession(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization || "";
  if (/^Bearer\s+vynor_live_/i.test(authorization))
    return res.status(401).json({ error: { code: "session_required" } });
  return requireAuth(req, res, next);
}

const codeBody = z
  .object({ code: z.string().min(1).max(32), confirm: z.boolean().optional() })
  .strict();
const unlinkBody = z
  .object({
    tenantId: z.string().min(1).max(128),
    objectId: z.string().min(1).max(128),
  })
  .strict();

export function createM365LinkRouter(): Router {
  const router = Router();
  router.use(noStore);

  const perAddress = createRateLimiter({
    windowMs: 10 * 60_000,
    max: 60,
    message: "Too many link requests. Please try again later.",
  });
  const perIdentity = createRateLimiter({
    windowMs: 10 * 60_000,
    max: 6,
    message: "Too many link codes requested. Please wait a few minutes.",
    keyGenerator: (req) => {
      const identity = (req as any).m365LinkIdentity;
      return `m365link:start:${identity?.tenantId}:${identity?.objectId}`;
    },
  });
  // The pane polls status every two seconds while the user completes the browser link flow.
  // Keep this bounded by identity and address, but do not apply the normal 60-request link-action
  // limit: that limit would reject a legitimate four-minute sign-in with HTTP 429.
  const perStatusAddress = createRateLimiter({
    windowMs: 10 * 60_000,
    max: 420,
    message: "Too many link status checks. Please wait and try again.",
    keyGenerator: (req) => `m365link:status:address:${clientIp(req)}`,
  });
  const perStatusIdentity = createRateLimiter({
    windowMs: 10 * 60_000,
    max: 240,
    message: "Too many link status checks. Please wait and try again.",
    keyGenerator: (req) => {
      const identity = (req as any).m365LinkIdentity;
      return `m365link:status:${identity?.tenantId}:${identity?.objectId}`;
    },
  });
  const perAccount = createRateLimiter({
    windowMs: 15 * 60_000,
    max: 40,
    message: "Too many link attempts. Please try again later.",
    keyGenerator: (req) => `m365link:user:${(req as any).user?.id}`,
  });
  // --- Microsoft side (Excel add-in) -----------------------------------------------------------
  router.post(
    "/start",
    requireEntraIdentity,
    perIdentity,
    perAddress,
    async (req: Request, res: Response) => {
      const identity = (req as any).m365LinkIdentity;
      try {
        const result = await startLinkCode(identity);
        if (!result.ok) return fail(res, result.code!);
        return res.json({
          code: result.linkCode,
          expiresAt: result.expiresAt,
        });
      } catch {
        return res.status(500).json({ error: { code: "link_failed" } });
      }
    },
  );

  router.get(
    "/status",
    requireEntraIdentity,
    perStatusAddress,
    perStatusIdentity,
    async (req: Request, res: Response) => {
      const identity = (req as any).m365LinkIdentity;
      try {
        return res.json(await linkStatus(identity.tenantId, identity.objectId));
      } catch {
        return res.status(500).json({ error: { code: "link_failed" } });
      }
    },
  );

  // --- VynorAI side (web page) -----------------------------------------------------------------
  router.post(
    "/preview",
    requireWebSession,
    perAddress,
    perAccount,
    async (req: Request, res: Response) => {
      const body = codeBody.safeParse(req.body);
      if (!body.success) return fail(res, "invalid_or_expired_code");
      try {
        const result = await previewLinkCode({
          userId: String((req as any).user.id),
          ip: clientIp(req),
          rawCode: body.data.code,
        });
        if (!result.ok) return fail(res, result.code!);
        return res.json({
          label: result.label,
          tenantName: result.tenantName,
          expiresAt: result.expiresAt,
        });
      } catch {
        return res.status(500).json({ error: { code: "link_failed" } });
      }
    },
  );

  router.post(
    "/confirm",
    requireWebSession,
    perAddress,
    perAccount,
    async (req: Request, res: Response) => {
      const body = codeBody.safeParse(req.body);
      if (!body.success) return fail(res, "invalid_or_expired_code");
      try {
        const result = await confirmLinkCode({
          userId: String((req as any).user.id),
          emailVerified: Number((req as any).user.email_verified) === 1,
          ip: clientIp(req),
          rawCode: body.data.code,
          confirm: body.data.confirm,
        });
        if (!result.ok) return fail(res, result.code!);
        return res.json({ linked: true });
      } catch {
        return res.status(500).json({ error: { code: "link_failed" } });
      }
    },
  );

  router.get(
    "/mine",
    requireWebSession,
    perAddress,
    async (req: Request, res: Response) => {
      try {
        const links = await listOwnLinks(String((req as any).user.id));
        return res.json({
          links: links.map((link) => ({
            tenantId: link.tenantId,
            objectId: link.objectId,
            tenantName: link.tenantName,
            enabled: link.enabled,
            linkedVia: link.linkedVia,
            createdAt: link.createdAt,
          })),
        });
      } catch {
        return res.status(500).json({ error: { code: "link_failed" } });
      }
    },
  );

  const unlink = async (req: Request, res: Response) => {
    const body = unlinkBody.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: { code: "invalid_request" } });
    try {
      const removed = await unlinkOwnIdentity({
        userId: String((req as any).user.id),
        tenantId: body.data.tenantId,
        objectId: body.data.objectId,
        ip: clientIp(req),
      });
      // 404 for a link that is not yours, not enabled, or does not exist: no way to tell which.
      if (!removed)
        return res.status(404).json({ error: { code: "link_not_found" } });
      return res.json({ unlinked: true });
    } catch {
      return res.status(500).json({ error: { code: "link_failed" } });
    }
  };
  router.delete("/", requireWebSession, perAddress, perAccount, unlink);
  router.post("/unlink", requireWebSession, perAddress, perAccount, unlink);

  return router;
}
