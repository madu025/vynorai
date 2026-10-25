/**
 * Managed Python sandbox job contract (foundation only).
 *
 * A job carries a bounded, masked table copy and a script. It never carries a workbook handle,
 * a Microsoft Graph or Entra token, a network switch other than "off", or a shell command. The
 * result is data only (tables, metrics, notes). The API may hand this contract to a separately
 * provisioned worker over the authenticated HTTPS adapter; without that worker every submission
 * fails closed with SANDBOX_UNAVAILABLE.
 */
export const M365_SANDBOX_CONTRACT_VERSION =
  "2026-10-24.python-sandbox.v1" as const;

/** Hard ceilings; the API rejects a request above any of them before it reads the content. */
export const M365_SANDBOX_LIMITS = {
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

export const M365_SANDBOX_JOB_STATES = [
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "succeeded",
  "failed",
  "expired",
] as const;
export type SandboxJobState = (typeof M365_SANDBOX_JOB_STATES)[number];

/** States in which a job still counts against concurrency and can still change. */
export const M365_SANDBOX_ACTIVE_STATES: readonly SandboxJobState[] = [
  "queued",
  "running",
  "cancel_requested",
];

export const M365_SANDBOX_ERROR_CODES = [
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
export type SandboxErrorCode = (typeof M365_SANDBOX_ERROR_CODES)[number];

export type SandboxCell = string | number | boolean | null;

export interface SandboxJobInput {
  /** Header names, already masked by the pane; the API masks them again. */
  columns: string[];
  rows: SandboxCell[][];
}

export interface SandboxJobRequest {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  purpose: string;
  language: "en" | "si" | "ta";
  script: string;
  input: SandboxJobInput;
  /** The network is off; "true" is rejected, there is no way to switch it on per job. */
  network: false;
  timeoutSeconds?: number;
}

export interface SandboxResultTable {
  name: string;
  columns: string[];
  rows: SandboxCell[][];
}

/** Result-only output: nothing here can address the workbook. */
export interface SandboxJobResult {
  tables: SandboxResultTable[];
  metrics: Record<string, string | number | boolean>;
  notes: string[];
}

/** Authenticated API-to-worker envelope. Tenant/object ids bind the job but no Graph token or
 * workbook handle is included. The rows and script have already been bounded and masked by the API. */
export interface SandboxWorkerDispatch {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  /** Per-dispatch nonce echoed by the worker to prevent replayed result acceptance. */
  requestId: string;
  jobId: string;
  tenantId: string;
  objectId: string;
  timeoutSeconds: number;
  script: string;
  columns: string[];
  rows: SandboxCell[][];
  network: false;
  requestedAt: string;
}

/** The worker cannot address Excel; it returns only a bounded result or a generic run failure. */
export interface SandboxWorkerResponse {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  requestId: string;
  jobId: string;
  status: "completed" | "failed";
  result?: SandboxJobResult;
  errorCode?: "SANDBOX_RUN_FAILED";
}

/** Authenticated cancellation messages contain no script, rows, workbook handle or token. */
export interface SandboxWorkerCancelRequest {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  type: "cancel";
  requestId: string;
  jobId: string;
  requestedAt: string;
}

export interface SandboxWorkerCancelResponse {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  type: "cancel-result";
  requestId: string;
  jobId: string;
  status: "accepted" | "already_finished" | "not_found";
}

export const M365_SANDBOX_WORKER_MAX_CLOCK_SKEW_SECONDS = 90 as const;

/** What a client may read about a job. Never the script, the input or the result owner. */
export interface SandboxJobStatus {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  jobId: string;
  state: SandboxJobState;
  createdAt: string;
  expiresAt: string;
  rows: number;
  columns: number;
  errorCode?: SandboxErrorCode;
  result?: SandboxJobResult;
}

export interface SandboxPreview {
  contractVersion: typeof M365_SANDBOX_CONTRACT_VERSION;
  planId: string;
  inputFingerprint: string;
  rows: number;
  columns: number;
  maskedCells: number;
  timeoutSeconds: number;
  network: false;
  /** Short-lived, single-use; only valid for this exact input and this user. */
  approvalToken: string;
  requiresApproval: true;
}
