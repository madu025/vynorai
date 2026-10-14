export interface M365OAuthConfig {
  tenantId: string;
  authority?: "organizations" | "common" | string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

export interface M365OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

interface OAuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STATE_KEY = "vynorai.m365.oauth.state";
const VERIFIER_KEY = "vynorai.m365.oauth.verifier";

export function createOAuthConfig(input: M365OAuthConfig): M365OAuthConfig {
  if (
    !input.tenantId ||
    !input.clientId ||
    !input.redirectUri ||
    input.scopes.length === 0
  ) {
    throw new Error("Incomplete M365 OAuth configuration");
  }
  const redirect = new URL(input.redirectUri);
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost")
    throw new Error("M365 OAuth redirect must use HTTPS");
  return { ...input, scopes: [...new Set(input.scopes)] };
}

export async function beginM365OAuth(
  config: M365OAuthConfig,
  storage: OAuthStorage = sessionStorage,
): Promise<string> {
  const normalized = createOAuthConfig(config);
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(24);
  storage.setItem(STATE_KEY, state);
  storage.setItem(VERIFIER_KEY, verifier);
  const challenge = await sha256Base64Url(verifier);
  const authority = normalized.authority || normalized.tenantId;
  const authorize = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/authorize`,
  );
  authorize.search = new URLSearchParams({
    client_id: normalized.clientId,
    response_type: "code",
    redirect_uri: normalized.redirectUri,
    response_mode: "query",
    scope: normalized.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return authorize.toString();
}

export async function completeM365OAuth(
  callbackUrl: string,
  config: M365OAuthConfig,
  storage: OAuthStorage = sessionStorage,
  request: typeof fetch = fetch,
): Promise<M365OAuthTokens> {
  const normalized = createOAuthConfig(config);
  const callback = new URL(callbackUrl);
  const expectedState = storage.getItem(STATE_KEY);
  const verifier = storage.getItem(VERIFIER_KEY);
  if (
    !expectedState ||
    !verifier ||
    callback.searchParams.get("state") !== expectedState
  )
    throw new Error("OAuth state validation failed");
  const oauthError = callback.searchParams.get("error");
  if (oauthError) throw new Error(`OAuth authorization failed: ${oauthError}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("OAuth authorization code missing");
  const authority = normalized.authority || normalized.tenantId;
  const response = await request(
    `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: normalized.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: normalized.redirectUri,
        code_verifier: verifier,
        scope: normalized.scopes.join(" "),
      }),
    },
  );
  storage.removeItem(STATE_KEY);
  storage.removeItem(VERIFIER_KEY);
  if (!response.ok) throw new Error("OAuth token exchange failed");
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!payload.access_token) throw new Error("OAuth access token missing");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: Number(payload.expires_in || 0),
    tokenType: payload.token_type || "Bearer",
  };
}

function randomBase64Url(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

function base64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
