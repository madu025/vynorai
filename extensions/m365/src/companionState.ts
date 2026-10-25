/**
 * Pure routing for the optional signed Windows companion (design only, see
 * docs/WINDOWS_COMPANION_DESIGN.md). Nothing here talks to a network, a socket or the file system;
 * the add-in build does not consume packages/, so the vocabulary mirrors
 * packages/m365-contracts/src/companion.ts (a test keeps the two in step).
 */
export type CompanionState =
  | "not_installed"
  | "not_signed"
  | "unsupported_host"
  | "version_mismatch"
  | "tenant_not_allowed"
  | "ready";

export type CompanionFeature =
  | "vba-com"
  | "solver"
  | "scenario-manager"
  | "power-pivot-authoring"
  | "data-model-authoring"
  | "olap-pivot-authoring"
  | "sparklines-authoring";

export const COMPANION_FEATURES: readonly CompanionFeature[] = [
  "vba-com",
  "solver",
  "scenario-manager",
  "power-pivot-authoring",
  "data-model-authoring",
  "olap-pivot-authoring",
  "sparklines-authoring",
];

export type CompanionHostPlatform = "web" | "windows" | "mac" | "unknown";
export type CompanionExcelSurface = "web" | "desktop" | "unknown";

export interface CompanionHost {
  platform: CompanionHostPlatform;
  surface: CompanionExcelSurface;
}

export interface CompanionHelloRequest {
  contractVersion: string;
  type: "hello";
  nonce: string;
  tenantId: string;
  minCompanionVersion: string;
}

export interface CompanionHelloResponse {
  contractVersion: string;
  type: "hello-ack";
  nonce: string;
  companionVersion: string;
  signerThumbprint: string;
  signature: string;
  tenantAllowed: boolean;
  features: string[];
  rawWorkbookExport: boolean;
}

export type CompanionHandshakeResult =
  | { kind: "no_response" }
  | {
      kind: "response";
      response: CompanionHelloResponse;
      signatureVerified: boolean;
    };

export interface CompanionPolicy {
  /** Publisher certificate thumbprints (lower-case hex) the pane trusts. Empty = nobody is trusted. */
  trustedSignerThumbprints: readonly string[];
  minCompanionVersion: string;
  /** Nonce the pane sent; the reply must echo it. */
  nonce: string;
}

export interface CompanionStatus {
  state: CompanionState;
  reason: string;
  features: CompanionFeature[];
}

export type CompanionOperation =
  | "run-reviewed-vba"
  | "run-solver"
  | "run-scenario-manager"
  | "create-power-pivot-model"
  | "create-data-model"
  | "create-olap-pivot"
  | "create-sparklines";

export interface CompanionDispatchRequest {
  contractVersion: string;
  type: "execute";
  requestId: string;
  tenantId: string;
  objectId: string;
  feature: CompanionFeature;
  operation: CompanionOperation;
  workbook: {
    sessionId: string;
    workbookFingerprint: string;
    sourceFingerprint: string;
    origin: "excel-desktop-addin";
  };
  approval: { approved: true; grantId: string; expiresAt: string };
  parameters: Record<string, string | number | boolean | string[]>;
  requestedAt: string;
}

export interface CompanionDispatchResponse {
  contractVersion: string;
  type: "execute-result";
  requestId: string;
  status: "completed" | "unsupported" | "failed";
  feature: CompanionFeature;
  operation: CompanionOperation;
  workbook: CompanionDispatchRequest["workbook"];
  verification: {
    status: "verified" | "failed";
    changedCells: number;
    evidence: string[];
  };
  errorCode?:
    | "UNSUPPORTED_NATIVE_FEATURE"
    | "APPROVAL_INVALID"
    | "WORKBOOK_BINDING_INVALID"
    | "NATIVE_EXECUTION_FAILED";
}

const COMPANION_FEATURE_FOR_OPERATION: Readonly<
  Record<CompanionOperation, CompanionFeature>
> = {
  "run-reviewed-vba": "vba-com",
  "run-solver": "solver",
  "run-scenario-manager": "scenario-manager",
  "create-power-pivot-model": "power-pivot-authoring",
  "create-data-model": "data-model-authoring",
  "create-olap-pivot": "olap-pivot-authoring",
  "create-sparklines": "sparklines-authoring",
};

/**
 * Runtime copy of the contract boundary for the add-in bundle. The package contract is the
 * source of truth for the server/future companion; this guard keeps untrusted pane data from
 * reaching a transport when the package is not bundled into the Office add-in.
 */
export function isValidCompanionDispatchRequest(
  value: unknown,
): value is CompanionDispatchRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<CompanionDispatchRequest>;
  if (
    request.contractVersion !== "2026-10-24.windows-companion.v1" ||
    request.type !== "execute" ||
    typeof request.requestId !== "string" ||
    request.requestId.length < 16 ||
    request.requestId.length > 128 ||
    typeof request.tenantId !== "string" ||
    request.tenantId.length < 1 ||
    request.tenantId.length > 128 ||
    typeof request.objectId !== "string" ||
    request.objectId.length < 1 ||
    request.objectId.length > 128 ||
    typeof request.feature !== "string" ||
    !COMPANION_FEATURES.includes(request.feature as CompanionFeature) ||
    typeof request.operation !== "string" ||
    !(request.operation in COMPANION_FEATURE_FOR_OPERATION) ||
    COMPANION_FEATURE_FOR_OPERATION[request.operation as CompanionOperation] !==
      request.feature ||
    typeof request.requestedAt !== "string"
  )
    return false;
  const workbook = request.workbook;
  if (
    !workbook ||
    workbook.origin !== "excel-desktop-addin" ||
    ![
      workbook.sessionId,
      workbook.workbookFingerprint,
      workbook.sourceFingerprint,
    ].every(
      (part) =>
        typeof part === "string" && part.length >= 16 && part.length <= 256,
    )
  )
    return false;
  const approval = request.approval;
  if (
    !approval ||
    approval.approved !== true ||
    typeof approval.grantId !== "string" ||
    approval.grantId.length < 16 ||
    approval.grantId.length > 256 ||
    typeof approval.expiresAt !== "string"
  )
    return false;
  const parameters = request.parameters;
  if (!parameters || typeof parameters !== "object") return false;
  const entries = Object.entries(parameters);
  if (entries.length > 32) return false;
  try {
    if (JSON.stringify(parameters).length > 16_384) return false;
  } catch {
    return false;
  }
  return entries.every(([key, parameter]) => {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) return false;
    if (/^(?:workbook|cell|row|column|value|token|script|command)/i.test(key))
      return false;
    if (typeof parameter === "string") return parameter.length <= 512;
    if (typeof parameter === "number") return Number.isFinite(parameter);
    if (typeof parameter === "boolean") return true;
    return (
      Array.isArray(parameter) &&
      parameter.length <= 128 &&
      parameter.every((item) => typeof item === "string" && item.length <= 128)
    );
  });
}

/** The transport is an interface only. This repository ships no companion, so it reports none. */
export interface CompanionTransport {
  handshake(request: CompanionHelloRequest): Promise<CompanionHandshakeResult>;
}

/** A native operation is a separate capability from discovery. A transport must be supplied by a
 * reviewed signed companion; the add-in never falls back to shell, VBA text or arbitrary COM. */
export interface CompanionExecutionTransport extends CompanionTransport {
  execute(
    request: CompanionDispatchRequest,
  ): Promise<CompanionDispatchResponse>;
}

export const noCompanionTransport: CompanionTransport = {
  async handshake() {
    return { kind: "no_response" };
  },
};

export const noCompanionExecutionTransport: CompanionExecutionTransport = {
  ...noCompanionTransport,
  async execute(request) {
    return {
      contractVersion: request.contractVersion,
      type: "execute-result",
      requestId: request.requestId,
      status: "unsupported",
      feature: request.feature,
      operation: request.operation,
      workbook: request.workbook,
      verification: { status: "failed", changedCells: 0, evidence: [] },
      errorCode: "UNSUPPORTED_NATIVE_FEATURE",
    };
  },
};

/** Maps Office.context.diagnostics.platform ("PC", "Mac", "OfficeOnline", ...) to a host. */
export function classifyHost(
  officePlatform: string | undefined,
): CompanionHost {
  const platform = String(officePlatform ?? "")
    .trim()
    .toLowerCase();
  switch (platform) {
    case "pc":
    case "universal":
    case "windows":
      return { platform: "windows", surface: "desktop" };
    case "mac":
      return { platform: "mac", surface: "desktop" };
    case "officeonline":
    case "online":
    case "web":
      return { platform: "web", surface: "web" };
    default:
      return { platform: "unknown", surface: "unknown" };
  }
}

export function isSupportedCompanionHost(host: CompanionHost): boolean {
  return host.platform === "windows" && host.surface === "desktop";
}

/** Numeric dotted-version compare; any non-numeric part makes the version invalid (-> mismatch). */
export function compareVersions(a: string, b: string): number | undefined {
  const parse = (value: string) =>
    /^\d+(\.\d+){0,3}$/.test(value) ? value.split(".").map(Number) : undefined;
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return undefined;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  return 0;
}

const KNOWN = new Set<string>(COMPANION_FEATURES);

export function deriveCompanionState(
  host: CompanionHost,
  handshake: CompanionHandshakeResult,
  policy: CompanionPolicy,
): CompanionStatus {
  if (!isSupportedCompanionHost(host))
    return {
      state: "unsupported_host",
      reason:
        "The companion exists only for Excel desktop on Windows; this host uses the Office.js features.",
      features: [],
    };
  if (handshake.kind === "no_response")
    return {
      state: "not_installed",
      reason: "No companion answered on this computer.",
      features: [],
    };
  const { response } = handshake;
  const trusted = policy.trustedSignerThumbprints.includes(
    response.signerThumbprint.toLowerCase(),
  );
  if (
    !handshake.signatureVerified ||
    !trusted ||
    response.nonce !== policy.nonce ||
    response.type !== "hello-ack" ||
    response.rawWorkbookExport !== false
  )
    return {
      state: "not_signed",
      reason:
        "The companion reply was not verified: signature, trusted publisher, nonce or data-export rule failed.",
      features: [],
    };
  const order = compareVersions(
    response.companionVersion,
    policy.minCompanionVersion,
  );
  if (order === undefined || order < 0)
    return {
      state: "version_mismatch",
      reason: `The companion is older than the required ${policy.minCompanionVersion} or its version is unreadable.`,
      features: [],
    };
  if (!response.tenantAllowed)
    return {
      state: "tenant_not_allowed",
      reason: "This organisation is not on the companion's tenant allow-list.",
      features: [],
    };
  const features = COMPANION_FEATURES.filter(
    (feature) => response.features.includes(feature) && KNOWN.has(feature),
  );
  return { state: "ready", reason: "Companion verified.", features };
}

/**
 * Companion-only capabilities that may be offered right now. Empty unless the host is Windows desktop
 * Excel and the companion is verified: Web and Mac never get these features, so there is no false parity.
 */
export function companionOnlyFeatures(
  status: CompanionStatus,
  host: CompanionHost,
): CompanionFeature[] {
  if (status.state !== "ready" || !isSupportedCompanionHost(host)) return [];
  return [...status.features];
}

/** Probes through a transport, then derives the state. Any transport failure means "not installed". */
export async function probeCompanion(
  host: CompanionHost,
  transport: CompanionTransport,
  request: CompanionHelloRequest,
  policy: CompanionPolicy,
): Promise<CompanionStatus> {
  if (!isSupportedCompanionHost(host))
    return deriveCompanionState(host, { kind: "no_response" }, policy);
  let result: CompanionHandshakeResult;
  try {
    result = await transport.handshake(request);
  } catch {
    result = { kind: "no_response" };
  }
  return deriveCompanionState(host, result, policy);
}

export type CompanionExecutionOutcome =
  | { status: "completed"; response: CompanionDispatchResponse }
  | {
      status: "unsupported" | "failed";
      errorCode:
        | "UNSUPPORTED_NATIVE_FEATURE"
        | "APPROVAL_INVALID"
        | "WORKBOOK_BINDING_INVALID"
        | "NATIVE_EXECUTION_FAILED";
      response?: CompanionDispatchResponse;
    };

function approvedRequest(
  request: CompanionDispatchRequest,
  now: number,
): boolean {
  const expiry = Date.parse(request.approval.expiresAt);
  return (
    request.contractVersion === "2026-10-24.windows-companion.v1" &&
    request.type === "execute" &&
    request.approval.approved === true &&
    request.approval.grantId.length >= 16 &&
    Number.isFinite(expiry) &&
    expiry > now &&
    request.workbook.origin === "excel-desktop-addin" &&
    request.workbook.sessionId.length >= 16 &&
    request.workbook.workbookFingerprint.length >= 16 &&
    request.workbook.sourceFingerprint.length >= 16
  );
}

/** The only add-in entry point for a native write. It fails closed before calling the transport. */
export async function executeApprovedCompanionOperation(
  host: CompanionHost,
  status: CompanionStatus,
  transport: CompanionExecutionTransport,
  request: CompanionDispatchRequest,
  now = Date.now(),
): Promise<CompanionExecutionOutcome> {
  if (
    !isSupportedCompanionHost(host) ||
    status.state !== "ready" ||
    !status.features.includes(request.feature)
  )
    return { status: "unsupported", errorCode: "UNSUPPORTED_NATIVE_FEATURE" };
  if (!approvedRequest(request, now))
    return { status: "failed", errorCode: "APPROVAL_INVALID" };
  if (!isValidCompanionDispatchRequest(request))
    return { status: "failed", errorCode: "WORKBOOK_BINDING_INVALID" };
  let response: CompanionDispatchResponse;
  try {
    response = await transport.execute(request);
  } catch {
    return { status: "failed", errorCode: "NATIVE_EXECUTION_FAILED" };
  }
  if (
    response.contractVersion !== request.contractVersion ||
    response.type !== "execute-result" ||
    response.requestId !== request.requestId ||
    response.feature !== request.feature ||
    response.operation !== request.operation ||
    response.workbook.sessionId !== request.workbook.sessionId ||
    response.workbook.workbookFingerprint !==
      request.workbook.workbookFingerprint ||
    response.workbook.sourceFingerprint !==
      request.workbook.sourceFingerprint ||
    response.workbook.origin !== request.workbook.origin
  )
    return { status: "failed", errorCode: "NATIVE_EXECUTION_FAILED" };
  if (response.status !== "completed")
    return {
      status: response.status === "unsupported" ? "unsupported" : "failed",
      errorCode: response.errorCode ?? "NATIVE_EXECUTION_FAILED",
      response,
    };
  if (
    response.verification.status !== "verified" ||
    !Number.isInteger(response.verification.changedCells) ||
    response.verification.changedCells < 0
  )
    return {
      status: "failed",
      errorCode: "NATIVE_EXECUTION_FAILED",
      response,
    };
  return { status: "completed", response };
}
