import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const M365_SCOPES = ["m365.excel.read", "m365.excel.write"] as const;
export type M365Scope = (typeof M365_SCOPES)[number];

export interface M365Identity {
  tenantId: string;
  objectId: string;
  scopes: string[];
}

interface EntraClaims {
  tid: string;
  oid: string;
  scp?: string;
  aud?: string;
  iss?: string;
  azp?: string;
  appid?: string;
  exp?: number;
  ver?: string;
}

interface JwksResponse {
  keys: Array<Record<string, unknown>>;
}

let jwksCache: { expiresAt: number; keys: JwksResponse["keys"] } | undefined;

export function entraConfiguration(): {
  tenantId: string;
  apiClientId: string;
  apiAudience: string;
  allowedClientIds: string[];
  issuer: string;
  jwksUrl: string;
  multiTenant: boolean;
} {
  const tenantId = process.env.M365_ENTRA_TENANT_ID?.trim() || "";
  const apiClientId =
    process.env.M365_ENTRA_API_CLIENT_ID?.trim() ||
    process.env.M365_ENTRA_CLIENT_ID?.trim() ||
    "";
  const allowedClientIds = splitEnvironmentList(
    process.env.M365_ENTRA_ALLOWED_CLIENT_IDS ||
      process.env.M365_ENTRA_CLIENT_ID,
  );
  const multiTenant = process.env.M365_ENTRA_MULTI_TENANT === "true";
  if (!tenantId || !apiClientId || allowedClientIds.length === 0)
    throw new Error("m365_oauth_not_configured");
  return {
    tenantId,
    apiClientId,
    // Entra v2 access tokens identify the target API with its client ID in aud.
    apiAudience: process.env.M365_ENTRA_API_AUDIENCE?.trim() || apiClientId,
    allowedClientIds,
    multiTenant,
    issuer:
      process.env.M365_ENTRA_ISSUER?.trim() ||
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
    jwksUrl:
      process.env.M365_ENTRA_JWKS_URL?.trim() ||
      `https://login.microsoftonline.com/${multiTenant ? "organizations" : tenantId}/discovery/v2.0/keys`,
  };
}

export async function validateEntraAccessToken(
  token: string,
): Promise<M365Identity> {
  const settings = entraConfiguration();
  const decoded = jwt.decode(token, { complete: true });
  const header =
    decoded && typeof decoded === "object" && "header" in decoded
      ? (decoded.header as { kid?: string; alg?: string })
      : undefined;
  if (!header?.kid || header.alg !== "RS256")
    throw new Error("invalid_entra_token");
  const keys = await getJwks(settings.jwksUrl);
  const jwk = keys.find(
    (candidate) => candidate.kid === header.kid && candidate.kty === "RSA",
  );
  if (!jwk) throw new Error("entra_signing_key_not_found");
  const publicKey = crypto.createPublicKey({
    key: jwk as crypto.JsonWebKey,
    format: "jwk",
  });
  const claims = jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    audience: settings.apiAudience,
  }) as EntraClaims;
  if (claims.ver !== "2.0") throw new Error("invalid_entra_token_version");
  const expectedIssuer = settings.multiTenant
    ? `https://login.microsoftonline.com/${claims.tid}/v2.0`
    : settings.issuer;
  if (!claims.tid || claims.iss !== expectedIssuer || !claims.oid)
    throw new Error("invalid_entra_identity");
  const callerClientId = claims.azp || claims.appid;
  if (!callerClientId || !settings.allowedClientIds.includes(callerClientId))
    throw new Error("untrusted_entra_client");
  return {
    tenantId: claims.tid,
    objectId: claims.oid,
    scopes: (claims.scp || "").split(" ").filter(Boolean),
  };
}

async function getJwks(url: string): Promise<JwksResponse["keys"]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("entra_jwks_unavailable");
  const body = (await response.json()) as JwksResponse;
  if (!Array.isArray(body.keys) || body.keys.length === 0)
    throw new Error("entra_jwks_invalid");
  jwksCache = { keys: body.keys, expiresAt: Date.now() + 10 * 60_000 };
  return body.keys;
}

export function validateM365Identity(
  identity: M365Identity,
  requiredScope: M365Scope,
): void {
  const settings = entraConfiguration();
  const allowedTenants = splitEnvironmentList(
    process.env.M365_ALLOWED_TENANT_IDS || process.env.M365_ALLOWED_TENANT_ID,
  );
  if (
    (!settings.multiTenant && identity.tenantId !== settings.tenantId) ||
    (allowedTenants.length > 0 && !allowedTenants.includes(identity.tenantId))
  ) {
    throw new Error("tenant_disabled");
  }
  if (!identity.objectId || !identity.scopes.includes(requiredScope))
    throw new Error("insufficient_scope");
}

function splitEnvironmentList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function createM365ApprovalToken(input: {
  planId: string;
  tenantId: string;
  objectId: string;
  sourceFingerprint: string;
}): string {
  return jwt.sign(
    {
      kind: "m365_excel_approval",
      planId: input.planId,
      tenantId: input.tenantId,
      objectId: input.objectId,
      sourceFingerprint: input.sourceFingerprint,
    },
    config.jwtSecret,
    { expiresIn: "10m", jwtid: crypto.randomUUID() },
  );
}

export function verifyM365ApprovalToken(
  token: string,
  expected: {
    planId: string;
    tenantId: string;
    objectId: string;
    sourceFingerprint: string;
  },
): void {
  const claims = jwt.verify(token, config.jwtSecret) as Record<string, unknown>;
  for (const [key, value] of Object.entries({
    kind: "m365_excel_approval",
    ...expected,
  })) {
    if (claims[key] !== value) throw new Error("approval_mismatch");
  }
}
