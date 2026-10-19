/**
 * Sends one mail through Microsoft Graph as the signed-in (delegated) user: POST /me/sendMail with
 * the Mail.Send permission. There is no SMTP, Resend or simulated route here: when no usable Graph
 * token exists the call fails with M365_GRAPH_AUTH_REQUIRED and nothing is sent.
 *
 * A Graph token reaches this code in memory only (a request header, or an on-behalf-of exchange of
 * the add-in's API token). It is never stored, logged or returned, and neither is the message.
 */
import crypto from "node:crypto";

export const GRAPH_SEND_MAIL_URL =
  "https://graph.microsoft.com/v1.0/me/sendMail";
const GRAPH_AUDIENCES = new Set([
  "https://graph.microsoft.com",
  "https://graph.microsoft.com/",
  "00000003-0000-0000-c000-000000000000",
]);
/** A token that expires within this many seconds is refused: it could lapse before Graph reads it. */
const EXPIRY_MARGIN_SECONDS = 60;

export type GraphMailErrorCode =
  | "M365_GRAPH_AUTH_REQUIRED"
  | "M365_GRAPH_TOKEN_EXPIRED"
  | "M365_GRAPH_PERMISSION_MISSING"
  | "M365_GRAPH_PERMISSION_DENIED"
  | "M365_GRAPH_THROTTLED"
  | "M365_GRAPH_PAYLOAD_TOO_LARGE"
  | "M365_GRAPH_UNAVAILABLE"
  | "M365_GRAPH_RECIPIENT_INVALID";

export class GraphMailError extends Error {
  constructor(
    readonly code: GraphMailErrorCode,
    readonly status: number,
    message: string,
    readonly options: {
      retryAfterSeconds?: number;
      graphStatus?: number;
      requestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "GraphMailError";
  }
}

export interface GraphFetcher {
  (input: string, init?: RequestInit): Promise<Response>;
}

let fetcher: GraphFetcher = (input, init) => fetch(input, init);
/** Test seam: production always calls Microsoft Graph. */
export function setGraphFetcherForTests(next?: GraphFetcher): void {
  fetcher = next ?? ((input, init) => fetch(input, init));
}

/** A bearer value from a header: "Bearer x" or the bare token. Never logged. */
export function bearerFromHeader(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.replace(/^Bearer\s+/i, "").trim();
  return token.length >= 20 && token.length <= 8192 && !/\s/.test(token)
    ? token
    : undefined;
}

/** Reads the claims of a Graph token without keeping it: expiry, audience and delegated scopes. */
export function inspectGraphToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { expiresAt: number; scopes: string[] } {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "The Microsoft Graph token is not valid.",
    );
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "The Microsoft Graph token is not valid.",
    );
  }
  const audience = typeof claims.aud === "string" ? claims.aud : "";
  if (!GRAPH_AUDIENCES.has(audience))
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "The token is not a Microsoft Graph token (wrong audience).",
    );
  const expiresAt = Number(claims.exp);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= nowSeconds + EXPIRY_MARGIN_SECONDS
  )
    throw new GraphMailError(
      "M365_GRAPH_TOKEN_EXPIRED",
      401,
      "The Microsoft Graph token has expired. Sign in again.",
    );
  const scopes =
    typeof claims.scp === "string"
      ? claims.scp.split(/\s+/).filter(Boolean)
      : [];
  if (!scopes.some((scope) => scope.toLowerCase() === "mail.send"))
    throw new GraphMailError(
      "M365_GRAPH_PERMISSION_MISSING",
      403,
      "The token does not carry the delegated Mail.Send permission.",
    );
  return { expiresAt, scopes };
}

/** True when an on-behalf-of exchange can run: the API app's id, tenant and client secret are set. */
export function oboConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.M365_ENTRA_TENANT_ID &&
      (env.M365_ENTRA_API_CLIENT_ID || env.M365_ENTRA_CLIENT_ID) &&
      env.M365_ENTRA_CLIENT_SECRET,
  );
}

/** Exchanges the add-in's API access token for a Graph token with Mail.Send (on-behalf-of). */
export async function acquireGraphTokenOnBehalfOf(
  apiToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!oboConfigured(env))
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "No Microsoft Graph token is available and the on-behalf-of exchange is not configured (M365_ENTRA_CLIENT_SECRET).",
    );
  const tenant = encodeURIComponent(env.M365_ENTRA_TENANT_ID!);
  let response: Response;
  try {
    response = await fetcher(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          client_id: (env.M365_ENTRA_API_CLIENT_ID ||
            env.M365_ENTRA_CLIENT_ID)!,
          client_secret: env.M365_ENTRA_CLIENT_SECRET!,
          assertion: apiToken,
          requested_token_use: "on_behalf_of",
          scope: "https://graph.microsoft.com/Mail.Send",
        }).toString(),
      },
    );
  } catch {
    throw new GraphMailError(
      "M365_GRAPH_UNAVAILABLE",
      502,
      "Microsoft Entra could not be reached.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof body.access_token !== "string")
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "Microsoft Entra did not issue a Graph token (consent for Mail.Send may be missing).",
    );
  return body.access_token;
}

export interface GraphSendResult {
  graphStatus: number;
  requestId: string;
}

/** Sends one HTML mail to one recipient as the token's user. Resolves only on a Graph 2xx answer. */
export async function sendGraphMail(options: {
  token: string;
  to: string;
  subject: string;
  html: string;
  correlationId?: string;
}): Promise<GraphSendResult> {
  const { token, to, subject, html } = options;
  if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(to))
    throw new GraphMailError(
      "M365_GRAPH_RECIPIENT_INVALID",
      400,
      "The recipient address is not valid.",
    );
  inspectGraphToken(token);
  const correlationId = options.correlationId ?? crypto.randomUUID();
  let response: Response;
  try {
    response = await fetcher(GRAPH_SEND_MAIL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "client-request-id": correlationId,
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
  } catch {
    throw new GraphMailError(
      "M365_GRAPH_UNAVAILABLE",
      502,
      "Microsoft Graph could not be reached.",
      {
        requestId: correlationId,
      },
    );
  }
  const requestId =
    response.headers.get("request-id") ||
    response.headers.get("client-request-id") ||
    correlationId;
  if (response.status >= 200 && response.status < 300)
    return { graphStatus: response.status, requestId };
  const detail = { graphStatus: response.status, requestId };
  if (response.status === 401)
    throw new GraphMailError(
      "M365_GRAPH_AUTH_REQUIRED",
      401,
      "Microsoft Graph refused the token (401). Sign in again.",
      detail,
    );
  if (response.status === 403)
    throw new GraphMailError(
      "M365_GRAPH_PERMISSION_DENIED",
      403,
      "Microsoft Graph denied the request (403). Grant the delegated Mail.Send permission, or the mailbox may not allow it.",
      detail,
    );
  if (response.status === 413)
    throw new GraphMailError(
      "M365_GRAPH_PAYLOAD_TOO_LARGE",
      413,
      "The message is too large for Microsoft Graph.",
      detail,
    );
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new GraphMailError(
      "M365_GRAPH_THROTTLED",
      429,
      "Microsoft Graph is throttling this mailbox. Try again later.",
      {
        ...detail,
        ...(Number.isFinite(retry) && retry > 0
          ? { retryAfterSeconds: retry }
          : {}),
      },
    );
  }
  throw new GraphMailError(
    "M365_GRAPH_UNAVAILABLE",
    502,
    `Microsoft Graph answered ${response.status}.`,
    detail,
  );
}
