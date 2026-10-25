/**
 * Account-takeover hardening shared by the password and Google sign-in routes.
 *
 * Why: `/register` creates an UNVERIFIED account and hands the registrant its password and API key.
 * If the real owner of that address later proves it (Google sign-in, or a password reset link), the
 * account is theirs, so every credential the registrant saw must stop working at that moment.
 * Otherwise an attacker could register `victim@gmail.com`, wait for the victim to sign in with Google
 * and keep using the account through the password and key they already hold ("pre-account takeover").
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { encryptCredential, maskApiKey } from "./credentialVault.js";
import { incrementRateLimit, peekRateLimit } from "./redisStore.js";

type RunSql = (
  sql: string,
  params?: unknown[],
) => Promise<{ changes?: number } | undefined | void>;

/** A bcrypt hash of 32 random bytes nobody knows: password sign-in stays off until a reset sets one. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
}

/**
 * Replaces the user's API key. Returns the new plaintext key (shown once by the caller) or `null`
 * when key encryption is unavailable (nothing is changed then: never store a key in plaintext).
 */
export async function rotateUserApiKey(
  run: RunSql,
  userId: string,
): Promise<string | null> {
  const apiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;
  const encrypted = encryptCredential(apiKey);
  if (!encrypted) return null;
  await run(
    "UPDATE users SET api_key = ?, api_key_hash = ?, api_key_masked = ?, api_key_encrypted = ? WHERE id = ?",
    [
      `encrypted:${userId}`,
      crypto.createHash("sha256").update(apiKey).digest("hex"),
      maskApiKey(apiKey),
      encrypted,
      userId,
    ],
  );
  return apiKey;
}

const memoryWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window counter shared across replicas through Redis, per process otherwise. Used to bound
 * how often a code can be requested and how many wrong guesses an account may make per day.
 */
export async function windowHit(
  key: string,
  windowMs: number,
): Promise<number> {
  try {
    const shared = await incrementRateLimit(key, windowMs);
    if (shared) return shared.count;
  } catch {
    /* Redis unavailable: use this process */
  }
  const now = Date.now();
  const record = memoryWindows.get(key);
  if (!record || record.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  record.count += 1;
  return record.count;
}

/** Current count of a window without changing it. */
export async function windowCount(key: string): Promise<number> {
  try {
    const shared = await peekRateLimit(key);
    if (shared !== null) return shared;
  } catch {
    /* Redis unavailable: use this process */
  }
  const record = memoryWindows.get(key);
  return record && record.resetAt > Date.now() ? record.count : 0;
}

/** Test hook: forget the in-process windows. */
export function resetWindowsForTests(): void {
  memoryWindows.clear();
}

/** Drops every pending proof (email verification codes, reset links) held for the account. */
export async function clearPendingProofs(
  run: RunSql,
  userId: string,
): Promise<void> {
  await run("DELETE FROM email_verifications WHERE user_id = ?", [userId]);
  await run("DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
}
