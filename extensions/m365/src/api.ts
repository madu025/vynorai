import type {
  AdvancedCapabilityReport,
  AiTextFeature,
} from "./capabilityRegistry.js";

export interface M365AccessDiagnostics {
  stages: Array<{
    name: string;
    ok: boolean;
    code?: string;
    detail?: Record<string, unknown>;
  }>;
  ready: { read: boolean; write: boolean };
}

export interface M365Capabilities {
  contractVersion: 1;
  excel: {
    canInspect: boolean;
    canPreview: boolean;
    canApply: boolean;
    actionKinds: string[];
    writableActionKinds: string[];
  };
  aiAnalysis: boolean;
  subscription?: {
    planId: string;
    planDisplayName: string;
    source: "tenant" | "user" | "free";
    active: boolean;
    validUntil: string | null;
  };
  commercial?: {
    mode: "individual" | "organization";
    billingStatus: string;
    quotaMode: "per_seat" | "pooled";
    directProvisioning: boolean;
    organizationName: string | null;
  };
  advanced?: AdvancedCapabilityReport;
}

export interface M365ApiClient {
  planExcel(input: unknown, signal?: AbortSignal): Promise<any>;
  approveExcel(input: {
    planId: string;
    sourceFingerprint: string;
    approvalToken: string;
  }): Promise<any>;
  reportExcelResult(input: {
    planId: string;
    sourceFingerprint: string;
    approvalToken: string;
    status:
      | "applied"
      | "partial_failure"
      | "client_failure"
      | "source_verification_failed";
    sourceUnchanged?: boolean;
    results: Array<{
      kind:
        | "table"
        | "chart"
        | "new-sheet"
        | "named-range"
        | "slicer"
        | "pivot-table"
        | "clean"
        | "add-column"
        | "lookup-columns"
        | "split-column"
        | "unpivot"
        | "summary"
        | "format"
        | "quality"
        | "statistics"
        | "dashboard"
        | "view"
        | "export-csv"
        | "export-pdf";
      status: "created" | "exists" | "failed" | "skipped_unsupported";
    }>;
  }): Promise<any>;
  diagnose(): Promise<M365AccessDiagnostics>;
  capabilities(): Promise<M365Capabilities>;
  /** Exchange the current token for a 30 day VynorAI session (also renews one). */
  createSession(): Promise<{ sessionToken: string; expiresInSeconds: number }>;
  /** Start the secure browser handoff that connects this Microsoft identity to VynorAI. */
  startM365Link(): Promise<{ code: string; expiresAt: string }>;
  /** Check whether the browser handoff has completed. */
  m365LinkStatus(): Promise<{
    linked: boolean;
    state: "pending" | "linked" | "expired" | "none";
    expiresAt?: string;
  }>;
  assistText(input: {
    host: "word" | "powerpoint" | "outlook" | "excel";
    task: string;
    tone?: string;
    text: string;
    consent: true;
  }): Promise<any>;
  draftDocument(input: unknown): Promise<any>;
  reportRollback(input: {
    planId: string;
    removedSheets: number;
    convertedTables: number;
    removedNames: number;
  }): Promise<any>;
  analyzeExcel(input: {
    summary: unknown;
    language?: "en" | "si" | "ta";
    request?: string;
    consent: true;
  }): Promise<any>;
  analyzeTextBatch(
    input: {
      contractVersion?: string;
      feature: AiTextFeature;
      language?: "en" | "si" | "ta";
      texts: string[];
      categories?: string[];
      consent: true;
    },
    signal?: AbortSignal,
  ): Promise<any>;
  scriptExcel(input: {
    summary: unknown;
    language?: "en" | "si" | "ta";
    request: string;
    consent: true;
  }): Promise<any>;
  agentExcel(input: {
    language: "en" | "si" | "ta";
    messages: unknown[];
    consent: true;
  }): Promise<any>;
}

export interface M365RequestTrace {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  correlationId: string;
  code?: string;
}

export class M365ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly correlationId?: string,
  ) {
    super(code);
    this.name = "M365ApiError";
  }
}

export function createM365ApiClient(
  baseUrl: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
  onTrace: (trace: M365RequestTrace) => void = () => {},
): M365ApiClient {
  if (!accessToken) throw new Error("M365 OAuth access token is required");
  const request = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    const correlationId = crypto.randomUUID();
    const started = Date.now();
    let response: Response;
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "x-correlation-id": correlationId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const aborted =
        signal?.aborted || (error as Error)?.name === "AbortError";
      onTrace({
        method,
        path,
        status: 0,
        durationMs: Date.now() - started,
        correlationId,
        code: aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR",
      });
      throw new M365ApiError(
        aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR",
        0,
        correlationId,
      );
    }
    // A proxy or gateway error page is HTML, not the JSON error contract.
    const payload = await response.json().catch(() => undefined);
    const code = response.ok
      ? undefined
      : payload?.error?.code ||
        (typeof payload?.error === "string" ? payload.error : undefined) ||
        `HTTP_${response.status}`;
    onTrace({
      method,
      path,
      status: response.status,
      durationMs: Date.now() - started,
      correlationId,
      code,
    });
    if (!response.ok)
      throw new M365ApiError(code!, response.status, correlationId);
    if (payload === undefined)
      throw new M365ApiError(
        "INVALID_JSON_RESPONSE",
        response.status,
        correlationId,
      );
    return payload;
  };
  return {
    planExcel: (input, signal) =>
      request("POST", "/v1/m365/excel/plan", input, signal),
    approveExcel: (input) =>
      request("POST", "/v1/m365/excel/apply", { ...input, confirmed: true }),
    reportExcelResult: (input) =>
      request("POST", "/v1/m365/excel/apply-result", input),
    diagnose: () => request("GET", "/v1/m365/diagnostics"),
    capabilities: () => request("GET", "/v1/m365/excel/capabilities"),
    createSession: () => request("POST", "/v1/m365/session", {}),
    startM365Link: () => request("POST", "/v1/m365/link/start", {}),
    m365LinkStatus: () => request("GET", "/v1/m365/link/status"),
    assistText: (input) => request("POST", "/v1/m365/text/assist", input),
    draftDocument: (input) => request("POST", "/v1/m365/text/draft", input),
    reportRollback: (input) =>
      request("POST", "/v1/m365/excel/rollback", input),
    analyzeExcel: (input) => request("POST", "/v1/m365/excel/analyze", input),
    analyzeTextBatch: (input, signal) =>
      request("POST", "/v1/m365/excel/text-analysis", input, signal),
    scriptExcel: (input) => request("POST", "/v1/m365/excel/script", input),
    agentExcel: (input) => request("POST", "/v1/m365/excel/agent", input),
  };
}
