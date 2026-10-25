import crypto from "node:crypto";
import {
  completeSandboxJob,
  markSandboxJobRunning,
  registerSandboxWorker,
  type SandboxDispatch,
  type SandboxWorker,
  SANDBOX_LIMITS,
} from "./m365Sandbox.js";

const WORKER_CONTRACT = "2026-10-24.python-sandbox.v1" as const;
const MAX_RESPONSE_BYTES = SANDBOX_LIMITS.maxResultBytes + 16_384;
const MAX_CLOCK_SKEW_SECONDS = 90;

export interface M365SandboxWorkerConfig {
  url: string;
  secret: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
}

interface WorkerDispatchEnvelope extends SandboxDispatch {
  contractVersion: typeof WORKER_CONTRACT;
  requestId: string;
  network: false;
  requestedAt: string;
}

interface WorkerDispatchResponse {
  contractVersion: typeof WORKER_CONTRACT;
  requestId: string;
  jobId: string;
  status: "completed" | "failed";
  result?: unknown;
  errorCode?: "SANDBOX_RUN_FAILED";
}

interface WorkerCancelEnvelope {
  contractVersion: typeof WORKER_CONTRACT;
  type: "cancel";
  requestId: string;
  jobId: string;
  requestedAt: string;
}

interface WorkerCancelResponse {
  contractVersion: typeof WORKER_CONTRACT;
  type: "cancel-result";
  requestId: string;
  jobId: string;
  status: "accepted" | "already_finished" | "not_found";
}

function workerUrl(raw: string, allowInsecureHttp: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("M365_SANDBOX_WORKER_URL is not a valid URL");
  }
  if (
    (parsed.protocol !== "https:" &&
      !(allowInsecureHttp && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "M365_SANDBOX_WORKER_URL must be a credential-free HTTPS endpoint",
    );
  return parsed;
}

function signRequest(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

function safeSignatureEquals(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected))
    return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex"),
  );
}

export function sandboxWorkerSignature(
  secret: string,
  timestamp: string,
  body: string,
): string {
  if (!secret || secret.length < 32)
    throw new Error("sandbox worker secret is too short");
  return signRequest(secret, timestamp, body);
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
      throw new Error("sandbox worker response is too large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("sandbox worker response is too large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseWorkerResponse(
  raw: string,
  expectedJobId: string,
  expectedRequestId: string,
): WorkerDispatchResponse {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("sandbox worker returned invalid JSON");
  }
  if (!value || typeof value !== "object")
    throw new Error("sandbox worker returned invalid data");
  const response = value as Partial<WorkerDispatchResponse>;
  if (
    response.contractVersion !== WORKER_CONTRACT ||
    response.requestId !== expectedRequestId ||
    response.jobId !== expectedJobId ||
    (response.status !== "completed" && response.status !== "failed") ||
    (response.status === "failed" &&
      response.errorCode !== "SANDBOX_RUN_FAILED")
  )
    throw new Error("sandbox worker response failed protocol validation");
  return response as WorkerDispatchResponse;
}

function parseWorkerCancelResponse(
  raw: string,
  expectedJobId: string,
  expectedRequestId: string,
): WorkerCancelResponse {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("sandbox worker returned invalid cancellation JSON");
  }
  if (!value || typeof value !== "object")
    throw new Error("sandbox worker returned invalid cancellation data");
  const response = value as Partial<WorkerCancelResponse>;
  if (
    response.contractVersion !== WORKER_CONTRACT ||
    response.type !== "cancel-result" ||
    response.requestId !== expectedRequestId ||
    response.jobId !== expectedJobId ||
    !["accepted", "already_finished", "not_found"].includes(
      response.status ?? "",
    )
  )
    throw new Error("sandbox worker cancellation failed protocol validation");
  return response as WorkerCancelResponse;
}

export function createHttpSandboxWorker(
  config: M365SandboxWorkerConfig,
): SandboxWorker {
  const url = workerUrl(config.url, config.allowInsecureHttp === true);
  if (!config.secret || config.secret.length < 32)
    throw new Error(
      "M365_SANDBOX_WORKER_SECRET must contain at least 32 characters",
    );
  const timeoutMs = Math.min(
    Math.max(
      config.timeoutMs ?? (SANDBOX_LIMITS.maxTimeoutSeconds + 5) * 1000,
      5_000,
    ),
    (SANDBOX_LIMITS.maxTimeoutSeconds + 10) * 1000,
  );
  const controllers = new Map<string, AbortController>();

  return {
    async dispatch(job) {
      if (!(await markSandboxJobRunning(job.jobId))) return;
      const controller = new AbortController();
      controllers.set(job.jobId, controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref();
      const requestedAt = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const envelope: WorkerDispatchEnvelope = {
        contractVersion: WORKER_CONTRACT,
        ...job,
        requestId,
        network: false,
        requestedAt,
      };
      const body = JSON.stringify(envelope);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signRequest(config.secret, timestamp, body);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vynorai-worker-contract": WORKER_CONTRACT,
            "x-vynorai-worker-timestamp": timestamp,
            "x-vynorai-worker-signature": signature,
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`sandbox worker HTTP ${response.status}`);
        const responseBody = await boundedBody(response);
        const responseTimestamp = String(
          response.headers.get("x-vynorai-worker-timestamp") ?? "",
        );
        const responseSignature = String(
          response.headers.get("x-vynorai-worker-signature") ?? "",
        );
        if (
          !isFreshWorkerTimestamp(responseTimestamp) ||
          !safeSignatureEquals(
            signRequest(config.secret, responseTimestamp, responseBody),
            responseSignature,
          )
        )
          throw new Error("sandbox worker response authentication failed");
        const result = parseWorkerResponse(responseBody, job.jobId, requestId);
        if (result.status === "failed")
          await completeSandboxJob(job.jobId, {
            errorCode: "SANDBOX_RUN_FAILED",
          });
        else await completeSandboxJob(job.jobId, { result: result.result });
      } catch (error) {
        // A cancelled request is resolved by completeSandboxJob as cancelled. All other transport,
        // timeout and protocol errors become a generic failed job; no remote error is persisted.
        await completeSandboxJob(job.jobId, {
          errorCode: controller.signal.aborted
            ? "SANDBOX_RUN_FAILED"
            : "SANDBOX_RUN_FAILED",
        }).catch(() => undefined);
        if (error instanceof Error && error.message.includes("worker HTTP"))
          return;
      } finally {
        clearTimeout(timeout);
        controllers.delete(job.jobId);
      }
    },
    async cancel(jobId) {
      controllers.get(jobId)?.abort();
      if (!/^sbx_[0-9a-f-]{36}$/.test(jobId)) return;
      const controller = new AbortController();
      const cancelTimeout = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, 5_000),
      );
      cancelTimeout.unref();
      const requestedAt = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const envelope: WorkerCancelEnvelope = {
        contractVersion: WORKER_CONTRACT,
        type: "cancel",
        requestId,
        jobId,
        requestedAt,
      };
      const body = JSON.stringify(envelope);
      const timestamp = String(Math.floor(Date.now() / 1000));
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vynorai-worker-contract": WORKER_CONTRACT,
            "x-vynorai-worker-timestamp": timestamp,
            "x-vynorai-worker-signature": signRequest(
              config.secret,
              timestamp,
              body,
            ),
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            `sandbox worker cancellation HTTP ${response.status}`,
          );
        const responseBody = await boundedBody(response);
        const responseTimestamp = String(
          response.headers.get("x-vynorai-worker-timestamp") ?? "",
        );
        const responseSignature = String(
          response.headers.get("x-vynorai-worker-signature") ?? "",
        );
        if (
          !isFreshWorkerTimestamp(responseTimestamp) ||
          !safeSignatureEquals(
            signRequest(config.secret, responseTimestamp, responseBody),
            responseSignature,
          )
        )
          throw new Error("sandbox worker cancellation authentication failed");
        parseWorkerCancelResponse(responseBody, jobId, requestId);
      } catch {
        // Local cancellation remains authoritative. A provisioned worker must enforce its own
        // execution timeout even when this best-effort remote cancellation cannot be delivered.
      } finally {
        clearTimeout(cancelTimeout);
      }
    },
  };
}

/** Register only a completely configured endpoint. Missing configuration preserves fail-closed mode. */
export function registerConfiguredSandboxWorker(env = process.env): boolean {
  const rawUrl = env.M365_SANDBOX_WORKER_URL?.trim() || "";
  const secret = env.M365_SANDBOX_WORKER_SECRET?.trim() || "";
  if (!rawUrl && !secret) {
    registerSandboxWorker(null);
    return false;
  }
  if (!rawUrl || !secret) {
    registerSandboxWorker(null);
    return false;
  }
  try {
    registerSandboxWorker(
      createHttpSandboxWorker({
        url: rawUrl,
        secret,
        allowInsecureHttp:
          env.NODE_ENV !== "production" &&
          env.M365_SANDBOX_WORKER_ALLOW_HTTP === "true",
      }),
    );
    return true;
  } catch {
    registerSandboxWorker(null);
    return false;
  }
}

export function isFreshWorkerTimestamp(
  timestamp: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const value = Number(timestamp);
  return (
    Number.isInteger(value) &&
    Math.abs(nowSeconds - value) <= MAX_CLOCK_SKEW_SECONDS
  );
}
