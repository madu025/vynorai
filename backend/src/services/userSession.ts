import crypto from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

/**
 * User session tokens (dashboard / extension login).
 *
 * - Signed with a key derived for this purpose from JWT_SECRET (HMAC with a label), so a token
 *   minted for another purpose with the raw secret (M365 sessions, approvals, background model
 *   tokens, Google nonces) can never be replayed as a user session.
 * - `kind: "user_session"` is required, and any token that carries another token's claims
 *   (`scope`, `taskId`) is rejected.
 * - `pv` is a fingerprint of the current password hash: changing or resetting the password makes
 *   every older session stop verifying, without a new database column.
 * - Tokens issued before this change (no `kind`, signed with the raw secret) still verify until they
 *   expire (they live at most 30 days), so nobody is logged out by the deployment.
 */

export const USER_SESSION_KIND = "user_session";
export const USER_SESSION_TTL = "30d";

export interface UserSessionClaims {
  userId: string;
  email: string;
}

let derived: { secret: string; key: string } | undefined;

/** HMAC(secret, label): one key per purpose, derived from the single configured secret. */
export function deriveKey(label: string, secret = config.jwtSecret): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`vynor:${label}:v1`)
    .digest("hex");
}

function sessionKey(): string {
  if (!derived || derived.secret !== config.jwtSecret)
    derived = {
      secret: config.jwtSecret,
      key: deriveKey("user-session"),
    };
  return derived.key;
}

/** Short, non-reversible fingerprint of the password hash (bcrypt hashes are salted per user). */
export function passwordFingerprint(passwordHash: string | null | undefined) {
  return crypto
    .createHash("sha256")
    .update(String(passwordHash ?? ""))
    .digest("hex")
    .slice(0, 16);
}

export function signUserSession(
  claims: UserSessionClaims,
  passwordHash: string | null | undefined,
): string {
  return jwt.sign(
    {
      userId: claims.userId,
      email: claims.email,
      kind: USER_SESSION_KIND,
      pv: passwordFingerprint(passwordHash),
    },
    sessionKey(),
    { algorithm: "HS256", expiresIn: USER_SESSION_TTL },
  );
}

export interface VerifiedUserSession {
  userId: string;
  email?: string;
  /** Present on new tokens; undefined for legacy tokens (no password-change check possible). */
  pv?: string;
  legacy: boolean;
}

/** Throws on any invalid token. Callers must still compare `pv` with the stored password hash. */
export function verifyUserSession(token: string): VerifiedUserSession {
  try {
    const claims = jwt.verify(token, sessionKey(), {
      algorithms: ["HS256"],
    }) as Record<string, unknown>;
    if (claims.kind !== USER_SESSION_KIND || typeof claims.userId !== "string")
      throw new Error("not a user session");
    return {
      userId: claims.userId,
      email: typeof claims.email === "string" ? claims.email : undefined,
      pv: typeof claims.pv === "string" ? claims.pv : undefined,
      legacy: false,
    };
  } catch {
    // Legacy window: tokens signed with the raw secret before purpose-bound keys existed.
    const claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
    }) as Record<string, unknown>;
    if (
      claims.kind !== undefined ||
      claims.scope !== undefined ||
      claims.taskId !== undefined ||
      claims.jti !== undefined ||
      typeof claims.userId !== "string"
    )
      throw new Error("not a legacy user session");
    return {
      userId: claims.userId,
      email: typeof claims.email === "string" ? claims.email : undefined,
      legacy: true,
    };
  }
}

/** True when the token's password fingerprint no longer matches the stored password hash. */
export function sessionPredatesPasswordChange(
  session: VerifiedUserSession,
  passwordHash: string | null | undefined,
): boolean {
  if (session.pv === undefined) return false; // legacy token: no fingerprint to compare
  const current = passwordFingerprint(passwordHash);
  const a = Buffer.from(session.pv);
  const b = Buffer.from(current);
  return a.length !== b.length || !crypto.timingSafeEqual(a, b);
}
