import { Router, Request, Response, RequestHandler } from "express";
import {
  cancelSandboxJob,
  getSandboxJob,
  M365SandboxError,
  previewSandboxJob,
  sandboxAvailability,
  SANDBOX_LIMITS,
  submitSandboxJob,
  type SandboxCaller,
} from "../services/m365Sandbox.js";

const JOB_ID = /^sbx_[0-9a-f-]{36}$/;
/** Headroom over maxInputBytes for the script and JSON framing; the service checks the content itself. */
const MAX_BODY_BYTES = SANDBOX_LIMITS.maxInputBytes + 200_000;

function caller(req: Request): SandboxCaller {
  const identity = (req as any).m365Identity;
  const user = (req as any).user;
  return {
    tenantId: identity.tenantId,
    objectId: identity.objectId,
    userId: String(user.id),
  };
}

function jobId(req: Request): string {
  const value = String(req.params.id ?? "");
  if (!JOB_ID.test(value)) throw new M365SandboxError("SANDBOX_JOB_NOT_FOUND");
  return value;
}

function fail(res: Response, error: unknown) {
  if (error instanceof M365SandboxError)
    return res.status(error.status).json({
      error: {
        code: error.code,
        ...(error.detail ? { message: error.detail } : {}),
      },
    });
  // Anything else is a bug: do not leak its message.
  return res.status(500).json({ error: { code: "SANDBOX_RUN_FAILED" } });
}

const bodyGuard: RequestHandler = (req, res, next) => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES)
    return res.status(413).json({
      error: { code: "SANDBOX_INPUT_INVALID", message: "Request is too large" },
    });
  next();
};

/** Python sandbox routes; `auth` is the existing M365 bearer/tenant/identity-link gate. */
export function createSandboxRouter(auth: RequestHandler): Router {
  const router = Router();
  router.get("/availability", auth, (_req: Request, res: Response) => {
    res.json(sandboxAvailability());
  });
  router.post(
    "/preview",
    auth,
    bodyGuard,
    async (req: Request, res: Response) => {
      try {
        res.json(await previewSandboxJob(caller(req), req.body?.request));
      } catch (error) {
        fail(res, error);
      }
    },
  );
  router.post("/jobs", auth, bodyGuard, async (req: Request, res: Response) => {
    try {
      res.status(202).json(await submitSandboxJob(caller(req), req.body));
    } catch (error) {
      fail(res, error);
    }
  });
  router.get("/jobs/:id", auth, async (req: Request, res: Response) => {
    try {
      res.json(await getSandboxJob(caller(req), jobId(req)));
    } catch (error) {
      fail(res, error);
    }
  });
  router.post("/jobs/:id/cancel", auth, async (req: Request, res: Response) => {
    try {
      res.json(await cancelSandboxJob(caller(req), jobId(req)));
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
