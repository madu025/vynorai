import crypto from "node:crypto";
import { z } from "../middleware/validate.js";

/**
 * The one place that mints identifiers and compares secrets. Identifiers that reach the database
 * or an API must be unguessable (CSPRNG, at least 122 bits), never built from a clock, a counter or
 * Math.random(). Existing stored ids are never rewritten; only newly minted ids use these helpers.
 */

const PREFIX = /^[a-z][a-z0-9]{0,15}$/;

/** `prefix_<32 hex chars>` (128 bits of CSPRNG), or just the hex when no prefix is given. */
export function newId(prefix?: string): string {
  const body = crypto.randomBytes(16).toString("hex");
  if (prefix === undefined) return body;
  if (!PREFIX.test(prefix)) throw new Error("INVALID_ID_PREFIX");
  return `${prefix}_${body}`;
}

/** A URL-safe secret token with `bytes` bytes of entropy (default 256 bits). */
export function newToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128)
    throw new Error("INVALID_TOKEN_SIZE");
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Constant-time string comparison. Both sides are hashed first so a different length does not
 * leak through timing and `timingSafeEqual` never throws on unequal buffers.
 */
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = crypto.createHash("sha256").update(a).digest();
  const right = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

/** An id received from a client: bounded length, a conservative charset, no whitespace or controls. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** Ids that may also carry model/provider punctuation (`vendor/model:tag`, `gpt-4.1`). */
export const NAME_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const idParam = (label = "id") =>
  z.string().regex(ID_PATTERN, `${label} is not a valid identifier`);
export const nameParam = (label = "name") =>
  z.string().regex(NAME_PATTERN, `${label} is not a valid identifier`);
