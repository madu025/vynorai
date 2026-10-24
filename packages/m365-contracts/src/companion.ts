/**
 * Contract for the optional, signed Windows companion. The companion is NOT built in this repository:
 * these types fix the vocabulary (states, capabilities, handshake messages) so the add-in, the backend
 * and a future signed companion agree on names. See docs/WINDOWS_COMPANION_DESIGN.md.
 */
export const M365_COMPANION_CONTRACT_VERSION =
  "2026-10-24.windows-companion.v1" as const;

/** Why the companion can or cannot be used right now. Only "ready" exposes companion features. */
export type CompanionState =
  | "not_installed"
  | "not_signed"
  | "unsupported_host"
  | "version_mismatch"
  | "tenant_not_allowed"
  | "ready";

/** Features that Office.js cannot do and that only a Windows desktop companion could add. */
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
] as const;

export type CompanionHostPlatform = "web" | "windows" | "mac" | "unknown";
export type CompanionExcelSurface = "web" | "desktop" | "unknown";

/** Authenticated local discovery: the add-in asks, the companion answers. Neither carries workbook data. */
export interface CompanionHelloRequest {
  contractVersion: typeof M365_COMPANION_CONTRACT_VERSION;
  type: "hello";
  /** Fresh random value (at least 16 bytes, base64url) so a reply cannot be replayed. */
  nonce: string;
  /** Tenant id of the signed-in user, checked against the companion's tenant allow-list. */
  tenantId: string;
  /** Oldest companion version the add-in accepts. */
  minCompanionVersion: string;
}

export interface CompanionHelloResponse {
  contractVersion: typeof M365_COMPANION_CONTRACT_VERSION;
  type: "hello-ack";
  /** Echo of the request nonce, covered by the signature. */
  nonce: string;
  companionVersion: string;
  /** Publisher certificate thumbprint (SHA-256) the companion binary is signed with. */
  signerThumbprint: string;
  /** Signature over nonce + companionVersion + tenantId + sorted features, made with the signer key. */
  signature: string;
  /** Result of the companion's own tenant allow-list check for the tenantId in the request. */
  tenantAllowed: boolean;
  features: CompanionFeature[];
  /** Always false by default: raw workbook export is never part of the handshake. */
  rawWorkbookExport: false;
}

/** What the transport reports to the pure state function (no signature maths happens in the pane). */
export type CompanionHandshakeResult =
  | { kind: "no_response" }
  | {
      kind: "response";
      response: CompanionHelloResponse;
      /** True only when a trusted verifier confirmed the signature, nonce echo and publisher pin. */
      signatureVerified: boolean;
    };

export interface CompanionStatusReport {
  contractVersion: typeof M365_COMPANION_CONTRACT_VERSION;
  state: CompanionState;
  reason: string;
  features: CompanionFeature[];
}
