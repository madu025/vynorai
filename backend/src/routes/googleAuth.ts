import { cleanDisplayName } from "../services/inputValidation.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { dbGet, dbRun } from "../db.js";
import { authRateLimiter } from "../middleware/security.js";
import { encryptCredential, maskApiKey } from "../services/credentialVault.js";
import { logSecurityEvent } from "../services/securityAudit.js";

/**
 * "Continue with Google" (OpenID Connect authorization code flow with PKCE).
 *
 * GET /api/auth/google            → Google consent (state, nonce, PKCE in a signed cookie)
 * GET /api/auth/google/callback   → verify, find or create the account, then
 *                                   /login.html?<original params>#gtoken=<jwt>
 *
 * The JWT travels in the URL fragment so it never reaches server logs; the login
 * page stores it and continues exactly like a password login, including the
 * IDE ("Login with VynorAI") hand-off.
 */

export const googleAuthRouter = Router();

const COOKIE = "vynor_google_oauth";
const COOKIE_TTL_MS = 10 * 60_000;
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Login-page parameters carried through Google (IDE hand-off and tab). */
const RETURN_PARAMS = ["source", "callback", "ide", "scheme", "state", "mode"];

export function googleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function redirectUri(): string {
  return `${config.baseUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign(value: string): string {
  const mac = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(value)
    .digest("base64url");
  return `${value}.${mac}`;
}

function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const expected = sign(value).slice(dot + 1);
  const given = signed.slice(dot + 1);
  if (given.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ? value
    : null;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function cookieHeader(value: string, maxAgeMs: number): string {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    config.nodeEnv === "production" ? "Secure" : "",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Keeps only known login-page parameters, so the final redirect stays on /login.html. */
export function sanitizeReturnQuery(raw: unknown): string {
  const input = new URLSearchParams(
    typeof raw === "string" ? raw.replace(/^\?/, "") : "",
  );
  const out = new URLSearchParams();
  for (const key of RETURN_PARAMS) {
    const value = input.get(key);
    if (value && value.length <= 512) out.set(key, value);
  }
  return out.toString();
}

function loginPage(query: string, fragment = ""): string {
  return `/login.html${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}

function failRedirect(res: Response, query: string, message: string): void {
  res.redirect(302, loginPage(query, `gerror=${encodeURIComponent(message)}`));
}

export interface GoogleIdClaims {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  nonce?: string;
}

/**
 * Validates an ID token received directly from Google's token endpoint over
 * TLS (OIDC Core 3.1.3.7 allows TLS server validation in place of the
 * signature check for this flow). Throws a user-safe message on failure.
 */
export function validateGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; now?: number },
): GoogleIdClaims & { email: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3)
    throw new Error("Google returned an invalid sign-in token.");
  let claims: GoogleIdClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Google returned an invalid sign-in token.");
  }
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  if (!ISSUERS.has(claims.iss))
    throw new Error("Sign-in token was not issued by Google.");
  if (claims.aud !== expected.clientId)
    throw new Error("Sign-in token is for a different app.");
  if (!claims.exp || claims.exp < now)
    throw new Error("Google sign-in expired. Please try again.");
  if (claims.nonce !== expected.nonce)
    throw new Error("Google sign-in could not be verified. Please try again.");
  const verified =
    claims.email_verified === true || claims.email_verified === "true";
  if (!claims.email || !verified)
    throw new Error("Your Google account email is not verified.");
  return { ...claims, email: claims.email.toLowerCase().trim() };
}

/** GET /api/auth/google/config — lets the login page show the button only when set up. */
googleAuthRouter.get("/config", (_req, res) => {
  res.json({ enabled: googleAuthConfigured() });
});

googleAuthRouter.get("/", authRateLimiter, (req: Request, res: Response) => {
  const returnQuery = sanitizeReturnQuery(req.query.return);
  if (!googleAuthConfigured()) {
    return failRedirect(
      res,
      returnQuery,
      "Google sign-in is not available yet.",
    );
  }
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );

  const payload = Buffer.from(
    JSON.stringify({
      state,
      nonce,
      verifier,
      returnQuery,
      exp: Date.now() + COOKIE_TTL_MS,
    }),
  ).toString("base64url");
  res.setHeader("Set-Cookie", cookieHeader(sign(payload), COOKIE_TTL_MS));

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

googleAuthRouter.get(
  "/callback",
  authRateLimiter,
  async (req: Request, res: Response) => {
    const raw = unsign(readCookie(req, COOKIE));
    res.setHeader("Set-Cookie", cookieHeader("", 0));
    let session: {
      state: string;
      nonce: string;
      verifier: string;
      returnQuery: string;
      exp: number;
    } | null = null;
    try {
      session = raw
        ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
        : null;
    } catch {
      session = null;
    }
    const returnQuery = session?.returnQuery ?? "";

    if (typeof req.query.error === "string") {
      return failRedirect(res, returnQuery, "Google sign-in was canceled.");
    }
    if (
      !session ||
      session.exp < Date.now() ||
      req.query.state !== session.state
    ) {
      return failRedirect(
        res,
        returnQuery,
        "Google sign-in expired or was started in another browser. Please try again.",
      );
    }
    if (typeof req.query.code !== "string" || !googleAuthConfigured()) {
      return failRedirect(
        res,
        returnQuery,
        "Google sign-in failed. Please try again.",
      );
    }

    const clientIp =
      (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri(),
          grant_type: "authorization_code",
          code_verifier: session.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tokens = (await tokenResponse.json()) as { id_token?: string };
      if (!tokenResponse.ok || !tokens.id_token) {
        throw new Error("Google sign-in failed. Please try again.");
      }
      const claims = validateGoogleIdToken(tokens.id_token, {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        nonce: session.nonce,
      });

      const user = await findOrCreateGoogleUser(claims.email, claims.name);
      if (user.is_suspended === 1) {
        await logSecurityEvent({
          eventType: "AUTH_LOGIN_BLOCKED_SUSPENDED",
          severity: "CRITICAL",
          actor: claims.email,
          details: "Google login blocked for suspended account",
          ipAddress: clientIp,
        });
        return failRedirect(
          res,
          returnQuery,
          "This account is suspended. Contact security@vynor.lk",
        );
      }
      await logSecurityEvent({
        eventType: user.created ? "AUTH_REGISTER_GOOGLE" : "AUTH_LOGIN_SUCCESS",
        severity: "INFO",
        actor: claims.email,
        target: user.id,
        details: user.created
          ? "Account created with Google"
          : "User authenticated with Google",
        ipAddress: clientIp,
      });

      const token = jwt.sign(
        { userId: user.id, email: claims.email },
        config.jwtSecret,
        {
          expiresIn: "30d",
        },
      );
      res.redirect(
        302,
        loginPage(returnQuery, `gtoken=${encodeURIComponent(token)}`),
      );
    } catch (err) {
      console.error("[GoogleAuth] callback failed:", (err as Error).message);
      failRedirect(
        res,
        returnQuery,
        (err as Error).message || "Google sign-in failed. Please try again.",
      );
    }
  },
);

/**
 * Google has verified the email, so an existing account with that address is
 * signed in (and marked verified); otherwise a new account is created with an
 * unusable random password (password sign-in stays off until one is set).
 */
async function findOrCreateGoogleUser(
  email: string,
  name?: string,
): Promise<{ id: string; is_suspended: number; created: boolean }> {
  const existing = await dbGet<{
    id: string;
    is_suspended: number;
    email_verified: number;
  }>("SELECT id, is_suspended, email_verified FROM users WHERE email = ?", [
    email,
  ]);
  if (existing) {
    if (existing.email_verified !== 1) {
      await dbRun("UPDATE users SET email_verified = 1 WHERE id = ?", [
        existing.id,
      ]);
    }
    return {
      id: existing.id,
      is_suspended: existing.is_suspended,
      created: false,
    };
  }

  const userId = uuidv4();
  const apiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;
  const encryptedApiKey = encryptCredential(apiKey);
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString("hex"),
    12,
  );
  await dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash, api_key_masked, api_key_encrypted, name, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    [
      userId,
      email,
      passwordHash,
      encryptedApiKey ? `encrypted:${userId}` : apiKey,
      crypto.createHash("sha256").update(apiKey).digest("hex"),
      maskApiKey(apiKey),
      encryptedApiKey,
      cleanDisplayName(name) || email.split("@")[0],
    ],
  );
  return { id: userId, is_suspended: 0, created: true };
}
