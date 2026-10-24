import crypto from "node:crypto";
import { dbAll, dbGet, dbRun } from "../db.js";
import { z } from "../middleware/validate.js";
import {
  consumeM365ApprovalToken,
  createM365ApprovalToken,
} from "./m365Policy.js";
import { PiiMap } from "./piiShield.js";
import { logSecurityEvent } from "./securityAudit.js";

/**
 * Managed Python sandbox: job ledger, validation, approval, quota and fail-closed dispatch.
 *
 * This module never runs Python, never starts a process and never touches the filesystem. A job
 * only ever reaches an isolated worker through the SandboxWorker interface below. No worker
 * adapter exists in this repository, so every submission ends in SANDBOX_UNAVAILABLE until an
 * administrator provisions one (docs/PYTHON_SANDBOX_DEPLOYMENT.md). The database holds job
 * metadata and, for a finished job, the bounded masked result until it expires. It never
 * holds the script or the input table.
 *
 * Keep the constants in step with packages/m365-contracts/src/sandbox.ts; a test compares them.
 */
export const M365_SANDBOX_CONTRACT_VERSION =
  "2026-10-24.python-sandbox.v1" as const;

export const SANDBOX_LIMITS = {
  maxRows: 5000,
  maxColumns: 50,
  maxCells: 100000,
  maxCellChars: 500,
  maxHeaderChars: 100,
  maxInputBytes: 1_000_000,
  maxScriptChars: 20000,
  maxPurposeChars: 300,
  defaultTimeoutSeconds: 30,
  maxTimeoutSeconds: 60,
  maxResultTables: 5,
  maxResultRows: 1000,
  maxResultColumns: 50,
  maxResultBytes: 1_000_000,
  maxResultNotes: 20,
  jobTtlSeconds: 900,
  maxActiveJobsPerUser: 1,
  maxActiveJobsPerTenant: 5,
  maxJobsPerUserPerHour: 20,
} as const;

export const SANDBOX_JOB_STATES = [
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "succeeded",
  "failed",
  "expired",
] as const;
export type SandboxJobState = (typeof SANDBOX_JOB_STATES)[number];
export const SANDBOX_ACTIVE_STATES: readonly SandboxJobState[] = [
  "queued",
  "running",
  "cancel_requested",
];

export const SANDBOX_ERROR_CODES = [
  "SANDBOX_UNAVAILABLE",
  "SANDBOX_APPROVAL_REQUIRED",
  "SANDBOX_APPROVAL_INVALID",
  "SANDBOX_INPUT_INVALID",
  "SANDBOX_QUOTA_EXCEEDED",
  "SANDBOX_CONCURRENCY_LIMIT",
  "SANDBOX_JOB_NOT_FOUND",
  "SANDBOX_JOB_EXPIRED",
  "SANDBOX_NOT_CANCELLABLE",
  "SANDBOX_RUN_FAILED",
] as const;
export type SandboxErrorCode = (typeof SANDBOX_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<SandboxErrorCode, number> = {
  SANDBOX_UNAVAILABLE: 503,
  SANDBOX_APPROVAL_REQUIRED: 400,
  SANDBOX_APPROVAL_INVALID: 403,
  SANDBOX_INPUT_INVALID: 400,
  SANDBOX_QUOTA_EXCEEDED: 429,
  SANDBOX_CONCURRENCY_LIMIT: 429,
  SANDBOX_JOB_NOT_FOUND: 404,
  SANDBOX_JOB_EXPIRED: 410,
  SANDBOX_NOT_CANCELLABLE: 409,
  SANDBOX_RUN_FAILED: 500,
};

/** Fixed administrator guidance; it never echoes request content. */
export const SANDBOX_UNAVAILABLE_GUIDANCE =
  "Python analysis needs an isolated sandbox worker, and none is provisioned for this service. " +
  "An administrator must deploy the worker described in docs/PYTHON_SANDBOX_DEPLOYMENT.md " +
  "(a separate host, per-job ephemeral isolation, no network) and register its adapter. " +
  "Nothing was run and no data left the workbook. Use formulas, PivotTables or the built-in " +
  "analysis instead.";

export class M365SandboxError extends Error {
  readonly status: number;
  constructor(
    public readonly code: SandboxErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
    this.status = STATUS_BY_CODE[code];
  }
}

// ─── Worker boundary ──────────────────────────────────────────────────────────

export interface SandboxDispatch {
  jobId: string;
  tenantId: string;
  objectId: string;
  timeoutSeconds: number;
  /** Masked, bounded. The worker must treat it as the only data it may read. */
  script: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

/** The only door to an isolated worker. No Graph token, workbook handle or network flag exists here. */
export interface SandboxWorker {
  dispatch(job: SandboxDispatch): Promise<void>;
  cancel(jobId: string): Promise<void>;
}

let registeredWorker: SandboxWorker | null = null;

/** Registers the adapter for a provisioned isolated worker. Nothing in this repository calls it. */
export function registerSandboxWorker(worker: SandboxWorker | null): void {
  registeredWorker = worker;
}

export function sandboxAvailability(): {
  available: boolean;
  code?: "SANDBOX_UNAVAILABLE";
  guidance?: string;
} {
  if (registeredWorker) return { available: true };
  return {
    available: false,
    code: "SANDBOX_UNAVAILABLE",
    guidance: SANDBOX_UNAVAILABLE_GUIDANCE,
  };
}

function requireWorker(): SandboxWorker {
  if (!registeredWorker)
    throw new M365SandboxError(
      "SANDBOX_UNAVAILABLE",
      SANDBOX_UNAVAILABLE_GUIDANCE,
    );
  return registeredWorker;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const cell = z.union([
  z.string().max(SANDBOX_LIMITS.maxCellChars),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const sandboxRequestSchema = z
  .object({
    contractVersion: z.literal(M365_SANDBOX_CONTRACT_VERSION),
    purpose: z.string().min(1).max(SANDBOX_LIMITS.maxPurposeChars),
    language: z.enum(["en", "si", "ta"]),
    script: z.string().min(1).max(SANDBOX_LIMITS.maxScriptChars),
    input: z
      .object({
        columns: z
          .array(z.string().max(SANDBOX_LIMITS.maxHeaderChars))
          .min(1)
          .max(SANDBOX_LIMITS.maxColumns),
        rows: z
          .array(z.array(cell).max(SANDBOX_LIMITS.maxColumns))
          .max(SANDBOX_LIMITS.maxRows),
      })
      .strict(),
    network: z.literal(false).default(false),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(SANDBOX_LIMITS.maxTimeoutSeconds)
      .default(SANDBOX_LIMITS.defaultTimeoutSeconds),
  })
  .strict();
export type SandboxRequest = z.infer<typeof sandboxRequestSchema>;

export const sandboxSubmitSchema = z
  .object({
    request: z.unknown(),
    approvalToken: z.string().min(20).max(4000).optional(),
  })
  .strict();

const resultTable = z
  .object({
    name: z.string().min(1).max(100),
    columns: z
      .array(z.string().max(SANDBOX_LIMITS.maxHeaderChars))
      .min(1)
      .max(SANDBOX_LIMITS.maxResultColumns),
    rows: z
      .array(z.array(cell).max(SANDBOX_LIMITS.maxResultColumns))
      .max(SANDBOX_LIMITS.maxResultRows),
  })
  .strict();

/** Result-only output: tables, scalar metrics and notes. Anything else is rejected. */
export const sandboxResultSchema = z
  .object({
    tables: z.array(resultTable).max(SANDBOX_LIMITS.maxResultTables),
    metrics: z.record(
      z.string().max(100),
      z.union([
        z.string().max(SANDBOX_LIMITS.maxCellChars),
        z.number().finite(),
        z.boolean(),
      ]),
    ),
    notes: z
      .array(z.string().max(SANDBOX_LIMITS.maxCellChars))
      .max(SANDBOX_LIMITS.maxResultNotes),
  })
  .strict();
export type SandboxResult = z.infer<typeof sandboxResultSchema>;

export interface SandboxCaller {
  tenantId: string;
  objectId: string;
  userId: string;
}

interface PreparedRequest {
  request: SandboxRequest;
  fingerprint: string;
  maskedCount: number;
  cells: number;
}

/** Access tokens and bearer credentials never travel to a worker, whatever field they hide in. */
const TOKEN_LIKE =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*|\bbearer\s+[A-Za-z0-9._~+/-]{20,}|\b(?:client_secret|access_token|refresh_token|api[_-]?key)\b\s*[:=]\s*\S{8,}/i;

/** Validates, bounds and masks a request. Throws SANDBOX_INPUT_INVALID with a generic reason. */
export function prepareSandboxRequest(raw: unknown): PreparedRequest {
  const parsed = sandboxRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the field path only; never echo a value.
    const path = parsed.error.issues[0]?.path.join(".") || "request";
    throw new M365SandboxError(
      "SANDBOX_INPUT_INVALID",
      `Invalid field: ${path}`,
    );
  }
  const request = parsed.data;
  const texts: string[] = [
    request.purpose,
    request.script,
    ...request.input.columns,
    ...request.input.rows.flatMap((row) =>
      row.filter((value): value is string => typeof value === "string"),
    ),
  ];
  if (texts.some((text) => TOKEN_LIKE.test(text)))
    throw new M365SandboxError(
      "SANDBOX_INPUT_INVALID",
      "Invalid field: credentials are not accepted",
    );
  const width = request.input.columns.length;
  let cells = 0;
  for (const row of request.input.rows) {
    if (row.length !== width)
      throw new M365SandboxError(
        "SANDBOX_INPUT_INVALID",
        "Invalid field: input.rows",
      );
    cells += row.length;
  }
  if (cells > SANDBOX_LIMITS.maxCells)
    throw new M365SandboxError(
      "SANDBOX_INPUT_INVALID",
      "Invalid field: input.rows",
    );
  if (
    Buffer.byteLength(JSON.stringify(request.input)) >
    SANDBOX_LIMITS.maxInputBytes
  )
    throw new M365SandboxError("SANDBOX_INPUT_INVALID", "Invalid field: input");
  // One in-memory map per job: the placeholders cannot be reversed after this function returns.
  const pii = new PiiMap();
  const masked: SandboxRequest = {
    ...request,
    purpose: pii.mask(request.purpose),
    script: pii.mask(request.script),
    input: {
      columns: request.input.columns.map((name) => pii.mask(name)),
      rows: request.input.rows.map((row) =>
        row.map((value) =>
          typeof value === "string" ? pii.mask(value) : value,
        ),
      ),
    },
  };
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: M365_SANDBOX_CONTRACT_VERSION,
        script: masked.script,
        input: masked.input,
        timeout: masked.timeoutSeconds,
      }),
    )
    .digest("hex");
  return { request: masked, fingerprint, maskedCount: pii.size, cells };
}

// ─── Redacted audit ───────────────────────────────────────────────────────────

type AuditFields = Partial<{
  code: SandboxErrorCode;
  state: SandboxJobState;
  rows: number;
  columns: number;
  maskedCells: number;
  timeoutSeconds: number;
}>;

/** Only codes, states and counts are written; a script, header or cell value can never appear. */
async function audit(
  eventType: string,
  caller: SandboxCaller,
  jobId: string,
  fields: AuditFields,
  severity: "INFO" | "WARN" = "INFO",
): Promise<void> {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields))
    if (typeof value === "number" || typeof value === "string")
      safe[key] = value;
  await logSecurityEvent({
    eventType,
    severity,
    actor: caller.objectId,
    target: `${caller.tenantId}:${jobId}`,
    details: JSON.stringify(safe),
  });
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

interface JobRow {
  job_id: string;
  tenant_id: string;
  object_id: string;
  user_id: string;
  state: SandboxJobState;
  input_fingerprint: string;
  row_count: number;
  column_count: number;
  masked_cells: number;
  timeout_seconds: number;
  error_code: SandboxErrorCode | null;
  result_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  expires_at_ms: number;
}

export interface SandboxJobView {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  jobId: string;
  state: SandboxJobState;
  createdAt: string;
  expiresAt: string;
  rows: number;
  columns: number;
  errorCode?: SandboxErrorCode;
  result?: SandboxResult;
}

function toView(row: JobRow, now = Date.now()): SandboxJobView {
  // A result is only readable until the job's expiry, even before the sweep has cleared it.
  const live = Number(row.expires_at_ms) > now;
  return {
    contractVersion: M365_SANDBOX_CONTRACT_VERSION,
    jobId: row.job_id,
    state: row.state,
    createdAt: new Date(Number(row.created_at_ms)).toISOString(),
    expiresAt: new Date(Number(row.expires_at_ms)).toISOString(),
    rows: row.row_count,
    columns: row.column_count,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.state === "succeeded" && row.result_json && live
      ? { result: JSON.parse(row.result_json) as SandboxResult }
      : {}),
  };
}

const ACTIVE_SQL = SANDBOX_ACTIVE_STATES.map(() => "?").join(",");

async function loadOwned(
  caller: SandboxCaller,
  jobId: string,
): Promise<JobRow> {
  // Tenant AND object are in the WHERE clause: another tenant's job is indistinguishable from none.
  const row = await dbGet<JobRow>(
    "SELECT * FROM m365_sandbox_jobs WHERE job_id = ? AND tenant_id = ? AND object_id = ?",
    [jobId, caller.tenantId, caller.objectId],
  );
  if (!row) throw new M365SandboxError("SANDBOX_JOB_NOT_FOUND");
  return row;
}

async function setState(
  row: JobRow,
  from: readonly SandboxJobState[],
  state: SandboxJobState,
  errorCode: SandboxErrorCode | null = null,
  resultJson: string | null = null,
  now = Date.now(),
): Promise<boolean> {
  const marks = from.map(() => "?").join(",");
  const done = await dbRun(
    `UPDATE m365_sandbox_jobs
       SET state = ?, error_code = ?, result_json = COALESCE(?, result_json), updated_at_ms = ?
     WHERE job_id = ? AND state IN (${marks})`,
    [state, errorCode, resultJson, now, row.job_id, ...from],
  );
  return done.changes === 1;
}

async function countActive(
  column: "user_id" | "tenant_id",
  value: string,
  now: number,
): Promise<number> {
  const row = await dbGet<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM m365_sandbox_jobs
      WHERE ${column} = ? AND state IN (${ACTIVE_SQL}) AND expires_at_ms > ?`,
    [value, ...SANDBOX_ACTIVE_STATES, now],
  );
  return Number(row?.n ?? 0);
}

async function assertQuota(caller: SandboxCaller, now: number): Promise<void> {
  const recent = await dbGet<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM m365_sandbox_jobs WHERE user_id = ? AND created_at_ms > ?",
    [caller.userId, now - 3_600_000],
  );
  if (Number(recent?.n ?? 0) >= SANDBOX_LIMITS.maxJobsPerUserPerHour)
    throw new M365SandboxError("SANDBOX_QUOTA_EXCEEDED");
}

// ─── Public operations ────────────────────────────────────────────────────────

export interface SandboxPreviewView {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  planId: string;
  inputFingerprint: string;
  rows: number;
  columns: number;
  maskedCells: number;
  timeoutSeconds: number;
  network: false;
  approvalToken: string;
  requiresApproval: true;
}

function planIdFor(fingerprint: string): string {
  return `sandbox_${fingerprint.slice(0, 32)}`;
}

/** Shows exactly what would be sent and issues a single-use approval. Fails closed first. */
export async function previewSandboxJob(
  caller: SandboxCaller,
  rawRequest: unknown,
  now = Date.now(),
): Promise<SandboxPreviewView> {
  requireWorker();
  const prepared = prepareSandboxRequest(rawRequest);
  await assertQuota(caller, now);
  const approvalToken = createM365ApprovalToken({
    planId: planIdFor(prepared.fingerprint),
    tenantId: caller.tenantId,
    objectId: caller.objectId,
    sourceFingerprint: prepared.fingerprint,
  });
  await audit("M365_SANDBOX_PREVIEW", caller, planIdFor(prepared.fingerprint), {
    rows: prepared.request.input.rows.length,
    columns: prepared.request.input.columns.length,
    maskedCells: prepared.maskedCount,
  });
  return {
    contractVersion: M365_SANDBOX_CONTRACT_VERSION,
    planId: planIdFor(prepared.fingerprint),
    inputFingerprint: prepared.fingerprint,
    rows: prepared.request.input.rows.length,
    columns: prepared.request.input.columns.length,
    maskedCells: prepared.maskedCount,
    timeoutSeconds: prepared.request.timeoutSeconds,
    network: false,
    approvalToken,
    requiresApproval: true,
  };
}

/** Consumes the approval, records the job and hands it to the worker. No approval, no dispatch. */
export async function submitSandboxJob(
  caller: SandboxCaller,
  rawBody: unknown,
  now = Date.now(),
): Promise<SandboxJobView> {
  const body = sandboxSubmitSchema.safeParse(rawBody);
  if (!body.success)
    throw new M365SandboxError("SANDBOX_INPUT_INVALID", "Invalid field: body");
  if (!body.data.approvalToken)
    throw new M365SandboxError("SANDBOX_APPROVAL_REQUIRED");
  const worker = requireWorker();
  const prepared = prepareSandboxRequest(body.data.request);
  const rows = prepared.request.input.rows.length;
  const columns = prepared.request.input.columns.length;
  await assertQuota(caller, now);
  // Quick pre-check so an obviously full queue does not burn the approval.
  if (
    (await countActive("user_id", caller.userId, now)) >=
      SANDBOX_LIMITS.maxActiveJobsPerUser ||
    (await countActive("tenant_id", caller.tenantId, now)) >=
      SANDBOX_LIMITS.maxActiveJobsPerTenant
  ) {
    await audit(
      "M365_SANDBOX_REJECTED",
      caller,
      "none",
      { code: "SANDBOX_CONCURRENCY_LIMIT" },
      "WARN",
    );
    throw new M365SandboxError("SANDBOX_CONCURRENCY_LIMIT");
  }
  try {
    await consumeM365ApprovalToken(body.data.approvalToken, {
      planId: planIdFor(prepared.fingerprint),
      tenantId: caller.tenantId,
      objectId: caller.objectId,
      sourceFingerprint: prepared.fingerprint,
    });
  } catch {
    await audit(
      "M365_SANDBOX_REJECTED",
      caller,
      "none",
      { code: "SANDBOX_APPROVAL_INVALID" },
      "WARN",
    );
    throw new M365SandboxError("SANDBOX_APPROVAL_INVALID");
  }
  const jobId = `sbx_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO m365_sandbox_jobs
       (job_id, tenant_id, object_id, user_id, state, input_fingerprint, row_count,
        column_count, masked_cells, timeout_seconds, created_at_ms, updated_at_ms, expires_at_ms)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobId,
      caller.tenantId,
      caller.objectId,
      caller.userId,
      prepared.fingerprint,
      rows,
      columns,
      prepared.maskedCount,
      prepared.request.timeoutSeconds,
      now,
      now,
      now + SANDBOX_LIMITS.jobTtlSeconds * 1000,
    ],
  );
  const inserted = (await loadOwned(caller, jobId)) as JobRow;
  // Re-count after the insert: two simultaneous submissions cannot both stay under the limit.
  const over =
    (await countActive("user_id", caller.userId, now)) >
      SANDBOX_LIMITS.maxActiveJobsPerUser ||
    (await countActive("tenant_id", caller.tenantId, now)) >
      SANDBOX_LIMITS.maxActiveJobsPerTenant;
  if (over) {
    await setState(
      inserted,
      ["queued"],
      "failed",
      "SANDBOX_CONCURRENCY_LIMIT",
      null,
      now,
    );
    await audit(
      "M365_SANDBOX_REJECTED",
      caller,
      jobId,
      { code: "SANDBOX_CONCURRENCY_LIMIT" },
      "WARN",
    );
    throw new M365SandboxError("SANDBOX_CONCURRENCY_LIMIT");
  }
  try {
    await worker.dispatch({
      jobId,
      tenantId: caller.tenantId,
      objectId: caller.objectId,
      timeoutSeconds: prepared.request.timeoutSeconds,
      script: prepared.request.script,
      columns: prepared.request.input.columns,
      rows: prepared.request.input.rows,
    });
  } catch {
    // The worker failed to accept the job: fail closed, nothing keeps running.
    await setState(
      inserted,
      ["queued"],
      "failed",
      "SANDBOX_UNAVAILABLE",
      null,
      now,
    );
    await audit(
      "M365_SANDBOX_DISPATCH_FAILED",
      caller,
      jobId,
      { code: "SANDBOX_UNAVAILABLE" },
      "WARN",
    );
    throw new M365SandboxError(
      "SANDBOX_UNAVAILABLE",
      SANDBOX_UNAVAILABLE_GUIDANCE,
    );
  }
  await audit("M365_SANDBOX_SUBMITTED", caller, jobId, {
    state: "queued",
    rows,
    columns,
    maskedCells: prepared.maskedCount,
    timeoutSeconds: prepared.request.timeoutSeconds,
  });
  return toView(await loadOwned(caller, jobId));
}

/** Reads one job. Expiry is applied on read, so an overdue job never reports as active. */
export async function getSandboxJob(
  caller: SandboxCaller,
  jobId: string,
  now = Date.now(),
): Promise<SandboxJobView> {
  let row = await loadOwned(caller, jobId);
  if (
    SANDBOX_ACTIVE_STATES.includes(row.state) &&
    Number(row.expires_at_ms) <= now
  ) {
    if (
      await setState(
        row,
        SANDBOX_ACTIVE_STATES,
        "expired",
        "SANDBOX_JOB_EXPIRED",
        null,
        now,
      )
    ) {
      await bestEffortCancel(jobId);
      await audit("M365_SANDBOX_EXPIRED", caller, jobId, { state: "expired" });
    }
    row = await loadOwned(caller, jobId);
  }
  return toView(row, now);
}

async function bestEffortCancel(jobId: string): Promise<void> {
  try {
    await registeredWorker?.cancel(jobId);
  } catch {
    // The row is already terminal or cancel_requested; the worker's own time limit still applies.
  }
}

export async function cancelSandboxJob(
  caller: SandboxCaller,
  jobId: string,
  now = Date.now(),
): Promise<SandboxJobView> {
  const row = await loadOwned(caller, jobId);
  if (row.state === "queued") {
    if (await setState(row, ["queued"], "cancelled", null, null, now)) {
      await bestEffortCancel(jobId);
      await audit("M365_SANDBOX_CANCELLED", caller, jobId, {
        state: "cancelled",
      });
    }
  } else if (row.state === "running") {
    if (await setState(row, ["running"], "cancel_requested", null, null, now)) {
      await bestEffortCancel(jobId);
      await audit("M365_SANDBOX_CANCELLED", caller, jobId, {
        state: "cancel_requested",
      });
    }
  } else if (row.state !== "cancel_requested") {
    throw new M365SandboxError("SANDBOX_NOT_CANCELLABLE");
  }
  return toView(await loadOwned(caller, jobId));
}

// ─── Worker callbacks (in-process API for a registered adapter; no public route) ─────────

export async function markSandboxJobRunning(
  jobId: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await dbGet<JobRow>(
    "SELECT * FROM m365_sandbox_jobs WHERE job_id = ?",
    [jobId],
  );
  return row ? setState(row, ["queued"], "running", null, null, now) : false;
}

/** Accepts a worker result only in the strict result-only shape and only for an active job. */
export async function completeSandboxJob(
  jobId: string,
  outcome: { result: unknown } | { errorCode: SandboxErrorCode },
  now = Date.now(),
): Promise<SandboxJobState> {
  const row = await dbGet<JobRow>(
    "SELECT * FROM m365_sandbox_jobs WHERE job_id = ?",
    [jobId],
  );
  if (!row) throw new M365SandboxError("SANDBOX_JOB_NOT_FOUND");
  const caller = {
    tenantId: row.tenant_id,
    objectId: row.object_id,
    userId: row.user_id,
  };
  // A job past its expiry never turns into a result, whatever the worker reports.
  if (
    SANDBOX_ACTIVE_STATES.includes(row.state) &&
    Number(row.expires_at_ms) <= now
  ) {
    await setState(
      row,
      SANDBOX_ACTIVE_STATES,
      "expired",
      "SANDBOX_JOB_EXPIRED",
      null,
      now,
    );
    await bestEffortCancel(jobId);
    await audit("M365_SANDBOX_EXPIRED", caller, jobId, { state: "expired" });
    return "expired";
  }
  // A cancelled-while-running job stays cancelled whatever the worker reports.
  if (row.state === "cancel_requested") {
    await setState(row, ["cancel_requested"], "cancelled", null, null, now);
    await audit("M365_SANDBOX_CANCELLED", caller, jobId, {
      state: "cancelled",
    });
    return "cancelled";
  }
  if ("errorCode" in outcome) {
    const code = SANDBOX_ERROR_CODES.includes(outcome.errorCode)
      ? outcome.errorCode
      : "SANDBOX_RUN_FAILED";
    await setState(row, ["queued", "running"], "failed", code, null, now);
    await audit(
      "M365_SANDBOX_FAILED",
      caller,
      jobId,
      { code, state: "failed" },
      "WARN",
    );
    return "failed";
  }
  const parsed = sandboxResultSchema.safeParse(outcome.result);
  const json = parsed.success ? JSON.stringify(parsed.data) : "";
  if (
    !parsed.success ||
    Buffer.byteLength(json) > SANDBOX_LIMITS.maxResultBytes
  ) {
    await setState(
      row,
      ["queued", "running"],
      "failed",
      "SANDBOX_RUN_FAILED",
      null,
      now,
    );
    await audit(
      "M365_SANDBOX_FAILED",
      caller,
      jobId,
      { code: "SANDBOX_RUN_FAILED", state: "failed" },
      "WARN",
    );
    return "failed";
  }
  await setState(row, ["queued", "running"], "succeeded", null, json, now);
  await audit("M365_SANDBOX_SUCCEEDED", caller, jobId, { state: "succeeded" });
  return "succeeded";
}

/** Expires overdue jobs, drops stored results of expired jobs and deletes old rows. */
export async function sweepSandboxJobs(now = Date.now()): Promise<{
  expired: number;
  cleared: number;
  deleted: number;
}> {
  const overdue = await dbAll<JobRow>(
    `SELECT * FROM m365_sandbox_jobs WHERE state IN (${ACTIVE_SQL}) AND expires_at_ms <= ?`,
    [...SANDBOX_ACTIVE_STATES, now],
  );
  let expired = 0;
  for (const row of overdue)
    if (
      await setState(
        row,
        SANDBOX_ACTIVE_STATES,
        "expired",
        "SANDBOX_JOB_EXPIRED",
        null,
        now,
      )
    ) {
      expired += 1;
      await bestEffortCancel(row.job_id);
    }
  const cleared = (
    await dbRun(
      "UPDATE m365_sandbox_jobs SET result_json = NULL WHERE result_json IS NOT NULL AND expires_at_ms <= ?",
      [now],
    )
  ).changes;
  const deleted = (
    await dbRun("DELETE FROM m365_sandbox_jobs WHERE expires_at_ms <= ?", [
      now - 7 * 24 * 3_600_000,
    ])
  ).changes;
  return { expired, cleared, deleted };
}

/** Periodic expiry/cleanup. Failures are swallowed so a bad sweep never takes the API down. */
export function scheduleSandboxSweep(): void {
  const run = () => void sweepSandboxJobs().catch(() => {});
  setTimeout(run, 60_000).unref();
  setInterval(run, 5 * 60_000).unref();
}
