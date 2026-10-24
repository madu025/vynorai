import crypto from "crypto";
import jwt from "jsonwebtoken";

/**
 * Cloudflare Access assertion verification for the admin portal.
 *
 * `Cf-Access-Authenticated-User-Email` is an ordinary request header: anyone who can reach the
 * origin can forge it. Only the signed `Cf-Access-Jwt-Assertion` proves the request passed
 * Cloudflare Access, so the header is trusted only when that JWT verifies (RS256, team JWKS,
 * audience, issuer, expiry) and its email claim equals the header.
 *
 * Configuration (both required, otherwise the Cloudflare path is disabled and fails closed):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. "vynor.cloudflareaccess.com"
 *   CF_ACCESS_AUD          the Access application's AUD tag
 */

export interface CfAccessConfig {
  teamDomain: string;
  audience: string;
}

export interface CfAccessResult {
  ok: boolean;
  email?: string;
  reason?:
    | "not_configured"
    | "missing_assertion"
    | "invalid_assertion"
    | "email_mismatch"
    | "keys_unavailable";
}

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_TIMEOUT_MS = 4000;
const MAX_JWKS_BYTES = 64 * 1024;

let cache: { domain: string; keys: Jwk[]; fetchedAt: number } | undefined;
let fetcherForTests: ((url: string) => Promise<{ keys: Jwk[] }>) | undefined;

/** Test hook: replaces the network fetch of the team JWKS. */
export function setCfAccessJwksFetcherForTests(
  fetcher: ((url: string) => Promise<{ keys: Jwk[] }>) | undefined,
): void {
  fetcherForTests = fetcher;
  cache = undefined;
}

export function readCfAccessConfig(
  env: NodeJS.ProcessEnv = process.env,
): CfAccessConfig | undefined {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const audience = (env.CF_ACCESS_AUD || "").trim();
  // The team domain becomes part of a URL: allow only a plain host name.
  if (!teamDomain || !audience) return undefined;
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(teamDomain))
    return undefined;
  return { teamDomain, audience };
}

async function fetchJwks(domain: string): Promise<Jwk[]> {
  const url = `https://${domain}/cdn-cgi/access/certs`;
  if (fetcherForTests) return (await fetcherForTests(url)).keys;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_JWKS_BYTES) throw new Error("JWKS too large");
    const body = JSON.parse(text) as { keys?: Jwk[] };
    return Array.isArray(body.keys) ? body.keys : [];
  } finally {
    clearTimeout(timer);
  }
}

async function keysFor(domain: string, forceRefresh = false): Promise<Jwk[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cache &&
    cache.domain === domain &&
    now - cache.fetchedAt < JWKS_TTL_MS
  )
    return cache.keys;
  try {
    const keys = await fetchJwks(domain);
    cache = { domain, keys, fetchedAt: now };
    return keys;
  } catch {
    // A short outage must not lock the admin out of an already-cached key set.
    if (cache && cache.domain === domain) return cache.keys;
    throw new Error("keys_unavailable");
  }
}

function toPublicKey(jwk: Jwk): crypto.KeyObject | undefined {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return undefined;
  try {
    return crypto.createPublicKey({
      key: jwk as unknown as crypto.JsonWebKey,
      format: "jwk",
    });
  } catch {
    return undefined;
  }
}

/** Verifies the assertion and that its email claim matches the forwarded header. */
export async function verifyCfAccessAssertion(
  assertion: string,
  headerEmail: string,
  config: CfAccessConfig | undefined = readCfAccessConfig(),
): Promise<CfAccessResult> {
  if (!config) return { ok: false, reason: "not_configured" };
  if (!assertion || assertion.length > 8192)
    return { ok: false, reason: "missing_assertion" };
  const decoded = jwt.decode(assertion, { complete: true });
  const kid =
    decoded && typeof decoded === "object" ? decoded.header?.kid : undefined;
  if (!kid || typeof kid !== "string")
    return { ok: false, reason: "invalid_assertion" };

  let keys: Jwk[];
  try {
    keys = await keysFor(config.teamDomain);
    // A rotated key: refresh once before giving up.
    if (!keys.some((key) => key.kid === kid))
      keys = await keysFor(config.teamDomain, true);
  } catch {
    return { ok: false, reason: "keys_unavailable" };
  }
  const key = keys.find((candidate) => candidate.kid === kid);
  const publicKey = key ? toPublicKey(key) : undefined;
  if (!publicKey) return { ok: false, reason: "invalid_assertion" };

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(assertion, publicKey, {
      algorithms: ["RS256"],
      audience: config.audience,
      issuer: `https://${config.teamDomain}`,
    }) as jwt.JwtPayload;
  } catch {
    return { ok: false, reason: "invalid_assertion" };
  }
  const claimEmail =
    typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!claimEmail || claimEmail !== headerEmail.trim().toLowerCase())
    return { ok: false, reason: "email_mismatch" };
  return { ok: true, email: claimEmail };
}
