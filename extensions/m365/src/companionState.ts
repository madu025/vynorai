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
  | "sparklines-authoring";

export const COMPANION_FEATURES: readonly CompanionFeature[] = [
  "vba-com",
  "solver",
  "scenario-manager",
  "power-pivot-authoring",
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

/** The transport is an interface only. This repository ships no companion, so it reports none. */
export interface CompanionTransport {
  handshake(request: CompanionHelloRequest): Promise<CompanionHandshakeResult>;
}

export const noCompanionTransport: CompanionTransport = {
  async handshake() {
    return { kind: "no_response" };
  },
};

/** Maps Office.context.diagnostics.platform ("PC", "Mac", "OfficeOnline", ...) to a host. */
export function classifyHost(
  officePlatform: string | undefined,
): CompanionHost {
  switch (officePlatform) {
    case "PC":
      return { platform: "windows", surface: "desktop" };
    case "Mac":
      return { platform: "mac", surface: "desktop" };
    case "OfficeOnline":
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
