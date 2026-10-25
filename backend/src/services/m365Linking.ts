/**
 * Self-service linking of a Microsoft 365 (Entra) identity to a VynorAI account.
 *
 * Why: the add-in signs people in with their Microsoft work account (prasad@slts.lk) but the plan,
 * keys and billing belong to a VynorAI account (sltsqms@gmail.com). The two have no shared email, so
 * an administrator had to link them by hand. Here the person proves BOTH accounts, device-code style:
 *   1. In Excel (Entra token) the add-in asks for a one-time code (`startLinkCode`).
 *   2. On vynor.lk, signed in to VynorAI, the person types the code, sees WHICH Microsoft account it
 *      belongs to (`previewLinkCode`, the anti-phishing step) and confirms (`confirmLinkCode`).
 * The link is the same `m365_identity_links` row an administrator would create; nothing downstream
 * changes. Email is never used to match accounts.
 *
 * Security decisions (docs/ARCHITECTURE_DECISIONS.md, "Self-service M365 identity linking"):
 * - 8 characters from a 32-symbol alphabet without look-alikes = 40 bits from a CSPRNG, valid 10
 *   minutes, single use. Only an HMAC under a key derived from the server secret is stored, so a
 *   database copy alone cannot be used to forge or recover a code.
 * - A code is bound to (tenant, object) at creation; whoever redeems it links THAT Microsoft
 *   account, which is why the confirm page shows the masked name and address first.
 * - A first-time individual tenant gets a non-billed policy row when the Entra proof asks to start
 *   linking. This grants no workbook access; the identity still needs an explicit verified VynorAI
 *   account link. Existing disabled tenants and organization tenants are never auto-enabled. An
 *   identity linked to another account is never re-pointed or re-enabled.
 * - Wrong codes are rate limited per account and per address (lockout), previews per code are capped.
 * - Audit rows carry ids and a short hash of the object id only: no email, code or label.
 */
import crypto from "node:crypto";
import { dbAll, dbGet, dbRun } from "../db.js";
import { activeM365TenantPlan } from "./m365Entitlements.js";
import { getM365Tenant } from "./m365TenantRegistry.js";
import { incrementRateLimit, peekRateLimit } from "./redisStore.js";
import { logSecurityEvent } from "./securityAudit.js";
import { newId } from "./secureId.js";
import { deriveKey } from "./userSession.js";

/** 32 symbols (5 bits each), no 0/1/I/O look-alikes: 8 symbols = 40 bits. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60_000;
/** Previews of one code before it is treated as burnt. */
export const LINK_CODE_MAX_PREVIEWS = 10;
/** A VynorAI account may serve a limited number of Microsoft identities (stops plan sharing). */
export const MAX_IDENTITY_LINKS_PER_USER = 3;
export const LINK_FAILURE_LIMIT = 5;
export const LINK_FAILURE_WINDOW_MS = 15 * 60_000;

const ALPHABET_SET = new Set(LINK_CODE_ALPHABET);

export type LinkErrorCode =
  | "invalid_or_expired_code"
  | "too_many_attempts"
  | "email_not_verified"
  | "tenant_disabled"
  | "m365_already_linked"
  | "m365_link_disabled"
  | "m365_linked_to_another_account"
  | "m365_seat_limit_reached"
  | "m365_user_link_limit"
  | "confirmation_required";

export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1)
    code += LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)];
  return code;
}

/** "abcd efgh" / "ABCD-EFGH" -> "ABCDEFGH"; anything else (wrong length or symbols) -> undefined. */
export function normalizeLinkCode(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 32) return undefined;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== LINK_CODE_LENGTH) return undefined;
  for (const ch of code) if (!ALPHABET_SET.has(ch)) return undefined;
  return code;
}

export function formatLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Keyed hash of a normalized code: the only form that is ever stored or looked up. */
export function hashLinkCode(code: string): string {
  return crypto
    .createHmac("sha256", deriveKey("m365-link-code"))
    .update(code)
    .digest("hex");
}

/** Short one-way reference for audit rows (the object id itself is not written there). */
export function objectIdRef(objectId: string): string {
  return crypto
    .createHash("sha256")
    .update(objectId)
    .digest("hex")
    .slice(0, 16);
}

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// Failed-attempt lockout (shared across replicas through Redis, per process otherwise)
// ---------------------------------------------------------------------------------------------

const memoryFailures = new Map<string, { count: number; resetAt: number }>();

function failureKeys(userId: string, ip: string): string[] {
  const ipRef = crypto
    .createHash("sha256")
    .update(ip || "unknown")
    .digest("hex")
    .slice(0, 16);
  return [`m365link:fail:user:${userId}`, `m365link:fail:ip:${ipRef}`];
}

async function failureCount(key: string): Promise<number> {
  try {
    const shared = await peekRateLimit(key);
    if (shared !== null) return shared;
  } catch {
    /* fall back to this process */
  }
  const record = memoryFailures.get(key);
  return record && record.resetAt > Date.now() ? record.count : 0;
}

async function addFailure(key: string): Promise<void> {
  try {
    const shared = await incrementRateLimit(key, LINK_FAILURE_WINDOW_MS);
    if (shared) return;
  } catch {
    /* fall back to this process */
  }
  const record = memoryFailures.get(key);
  if (!record || record.resetAt <= Date.now())
    memoryFailures.set(key, {
      count: 1,
      resetAt: Date.now() + LINK_FAILURE_WINDOW_MS,
    });
  else record.count += 1;
}

/** True when this account or address has used up its wrong-code allowance. */
export async function isLinkLocked(
  userId: string,
  ip: string,
): Promise<boolean> {
  const [byUser, byIp] = await Promise.all(
    failureKeys(userId, ip).map((key) => failureCount(key)),
  );
  return byUser >= LINK_FAILURE_LIMIT || byIp >= LINK_FAILURE_LIMIT * 4;
}

async function recordLinkFailure(userId: string, ip: string): Promise<void> {
  await Promise.all(failureKeys(userId, ip).map((key) => addFailure(key)));
}

/** Test hook: forget every counter kept in this process. */
export function resetLinkFailureCounters(): void {
  memoryFailures.clear();
}

// ---------------------------------------------------------------------------------------------
// Step 1: the add-in asks for a code (Entra-authenticated)
// ---------------------------------------------------------------------------------------------

export interface StartLinkResult {
  ok: boolean;
  code?: LinkErrorCode;
  /** Shown once, formatted "ABCD-EFGH". */
  linkCode?: string;
  expiresAt?: string;
}

export async function startLinkCode(identity: {
  tenantId: string;
  objectId: string;
  label?: string;
}): Promise<StartLinkResult> {
  const existing = await dbGet<{ enabled: number | string }>(
    "SELECT enabled FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [identity.tenantId, identity.objectId],
  );
  if (existing)
    return {
      ok: false,
      code:
        Number(existing.enabled) === 1
          ? "m365_already_linked"
          : "m365_link_disabled",
    };
  const tenant = await getM365Tenant(identity.tenantId);
  if (!tenant || tenant.status !== "enabled")
    return { ok: false, code: "tenant_disabled" };
  // One live code per identity: asking again replaces the earlier one.
  await dbRun(
    "DELETE FROM m365_link_codes WHERE tenant_id = ? AND object_id = ? AND consumed_at IS NULL",
    [identity.tenantId, identity.objectId],
  );
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLinkCode();
    try {
      await dbRun(
        `INSERT INTO m365_link_codes (id, tenant_id, object_id, code_hash, label, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newId("lnk"),
          identity.tenantId,
          identity.objectId,
          hashLinkCode(code),
          (identity.label || "").slice(0, 160) || "a Microsoft account",
          expiresAt,
        ],
      );
      return { ok: true, linkCode: formatLinkCode(code), expiresAt };
    } catch (error) {
      // A hash collision (unique code_hash) is astronomically unlikely; anything else is a real error.
      if (!/unique|duplicate/i.test(String((error as Error)?.message)))
        throw error;
    }
  }
  throw new Error("m365_link_code_generation_failed");
}

export type LinkState = "pending" | "linked" | "expired" | "none";

export async function linkStatus(
  tenantId: string,
  objectId: string,
): Promise<{ linked: boolean; state: LinkState; expiresAt?: string }> {
  const link = await dbGet<{ enabled: number | string }>(
    "SELECT enabled FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
  if (link && Number(link.enabled) === 1)
    return { linked: true, state: "linked" };
  const code = await dbGet<{ expires_at: string }>(
    `SELECT expires_at FROM m365_link_codes WHERE tenant_id = ? AND object_id = ? AND consumed_at IS NULL
     ORDER BY expires_at DESC LIMIT 1`,
    [tenantId, objectId],
  );
  if (!code) return { linked: false, state: "none" };
  const expiresAt = new Date(code.expires_at).toISOString();
  return Date.parse(expiresAt) > Date.now()
    ? { linked: false, state: "pending", expiresAt }
    : { linked: false, state: "expired", expiresAt };
}

// ---------------------------------------------------------------------------------------------
// Steps 2 and 3: the VynorAI account previews, then confirms
// ---------------------------------------------------------------------------------------------

interface CodeRow {
  id: string;
  tenant_id: string;
  object_id: string;
  label: string;
  expires_at: string;
  attempts: number | string;
}

async function findLiveCode(code: string): Promise<CodeRow | undefined> {
  const row = await dbGet<CodeRow>(
    `SELECT id, tenant_id, object_id, label, expires_at, attempts FROM m365_link_codes
     WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [hashLinkCode(code), nowIso()],
  );
  return row && Number(row.attempts) < LINK_CODE_MAX_PREVIEWS ? row : undefined;
}

export interface PreviewResult {
  ok: boolean;
  code?: LinkErrorCode;
  /** Masked Microsoft account ("Prasad P. (p***@slts.lk)"). */
  label?: string;
  tenantName?: string | null;
  expiresAt?: string;
}

export async function previewLinkCode(input: {
  userId: string;
  ip: string;
  rawCode: unknown;
}): Promise<PreviewResult> {
  if (await isLinkLocked(input.userId, input.ip))
    return { ok: false, code: "too_many_attempts" };
  const code = normalizeLinkCode(input.rawCode);
  const row = code ? await findLiveCode(code) : undefined;
  if (!row) {
    await recordLinkFailure(input.userId, input.ip);
    return { ok: false, code: "invalid_or_expired_code" };
  }
  await dbRun(
    "UPDATE m365_link_codes SET attempts = attempts + 1 WHERE id = ?",
    [row.id],
  );
  const tenant = await getM365Tenant(row.tenant_id);
  return {
    ok: true,
    label: row.label,
    tenantName: tenant?.displayName ?? null,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export interface ConfirmResult {
  ok: boolean;
  code?: LinkErrorCode;
  tenantId?: string;
}

/**
 * Links the Microsoft account the code belongs to with the signed-in VynorAI account. The code is
 * claimed first with one conditional UPDATE, so two simultaneous confirmations cannot both succeed;
 * if the link itself is refused the claim is released so the person can retry after the cause is fixed.
 */
export async function confirmLinkCode(input: {
  userId: string;
  emailVerified: boolean;
  ip: string;
  rawCode: unknown;
  confirm: unknown;
}): Promise<ConfirmResult> {
  if (input.confirm !== true)
    return { ok: false, code: "confirmation_required" };
  if (!input.emailVerified) return { ok: false, code: "email_not_verified" };
  if (await isLinkLocked(input.userId, input.ip))
    return { ok: false, code: "too_many_attempts" };
  const code = normalizeLinkCode(input.rawCode);
  const row = code ? await findLiveCode(code) : undefined;
  if (!row) {
    await recordLinkFailure(input.userId, input.ip);
    return { ok: false, code: "invalid_or_expired_code" };
  }

  const tenant = await getM365Tenant(row.tenant_id);
  if (!tenant || tenant.status !== "enabled")
    return { ok: false, code: "tenant_disabled" };
  const existing = await dbGet<{ user_id: string; enabled: number | string }>(
    "SELECT user_id, enabled FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?",
    [row.tenant_id, row.object_id],
  );
  if (existing) {
    if (existing.user_id !== input.userId)
      return { ok: false, code: "m365_linked_to_another_account" };
    return {
      ok: false,
      code:
        Number(existing.enabled) === 1
          ? "m365_already_linked"
          : "m365_link_disabled",
    };
  }
  const owned = await dbGet<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM m365_identity_links WHERE user_id = ? AND enabled = 1",
    [input.userId],
  );
  if (Number(owned?.count ?? 0) >= MAX_IDENTITY_LINKS_PER_USER)
    return { ok: false, code: "m365_user_link_limit" };

  // Claim the code: exactly one caller changes the row.
  const claimed = await dbRun(
    "UPDATE m365_link_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
    [nowIso(), row.id, nowIso()],
  );
  if (!claimed || claimed.changes < 1) {
    await recordLinkFailure(input.userId, input.ip);
    return { ok: false, code: "invalid_or_expired_code" };
  }

  let inserted = 0;
  try {
    const tenantPlan = activeM365TenantPlan(tenant);
    const result = tenantPlan
      ? await dbRun(
          `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
           SELECT ?, ?, ?, 1, 'self'
           WHERE (SELECT COUNT(*) FROM m365_identity_links WHERE tenant_id = ? AND enabled = 1)
             < ?
             AND NOT EXISTS (SELECT 1 FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?)
             AND (SELECT COUNT(*) FROM m365_identity_links WHERE user_id = ? AND enabled = 1) < ?`,
          [
            row.tenant_id,
            row.object_id,
            input.userId,
            row.tenant_id,
            tenantPlan.seatLimit,
            row.tenant_id,
            row.object_id,
            input.userId,
            MAX_IDENTITY_LINKS_PER_USER,
          ],
        )
      : await dbRun(
          `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, linked_via)
           SELECT ?, ?, ?, 1, 'self'
           WHERE NOT EXISTS (SELECT 1 FROM m365_identity_links WHERE tenant_id = ? AND object_id = ?)
             AND (SELECT COUNT(*) FROM m365_identity_links WHERE user_id = ? AND enabled = 1) < ?`,
          [
            row.tenant_id,
            row.object_id,
            input.userId,
            row.tenant_id,
            row.object_id,
            input.userId,
            MAX_IDENTITY_LINKS_PER_USER,
          ],
        );
    inserted = result?.changes ?? 0;
  } catch (error) {
    // A simultaneous insert for the same identity loses on the primary key.
    if (!/unique|duplicate|constraint/i.test(String((error as Error)?.message)))
      throw error;
  }
  if (inserted < 1) {
    // Refused (seat limit, tenant switched off, or lost a race): give the code back.
    await dbRun(
      "UPDATE m365_link_codes SET consumed_at = NULL WHERE id = ? AND consumed_at IS NOT NULL",
      [row.id],
    );
    const fresh = await getM365Tenant(row.tenant_id);
    if (!fresh || fresh.status !== "enabled")
      return { ok: false, code: "tenant_disabled" };
    // Two simultaneous confirmations for different identities can both pass the early check; the
    // guarded INSERT is what enforces the per-account cap, so name that cause when it was the one.
    const nowOwned = await dbGet<{ count: number | string }>(
      "SELECT COUNT(*) AS count FROM m365_identity_links WHERE user_id = ? AND enabled = 1",
      [input.userId],
    );
    return {
      ok: false,
      code:
        Number(nowOwned?.count ?? 0) >= MAX_IDENTITY_LINKS_PER_USER
          ? "m365_user_link_limit"
          : "m365_seat_limit_reached",
    };
  }

  await logSecurityEvent({
    eventType: "M365_IDENTITY_SELF_LINKED",
    actor: input.userId,
    target: row.tenant_id,
    details: JSON.stringify({ objectRef: objectIdRef(row.object_id) }),
    ipAddress: input.ip,
  });
  return { ok: true, tenantId: row.tenant_id };
}

// ---------------------------------------------------------------------------------------------
// The person's own links
// ---------------------------------------------------------------------------------------------

export interface OwnLink {
  tenantId: string;
  objectId: string;
  tenantName: string | null;
  enabled: boolean;
  linkedVia: string;
  createdAt: string | null;
}

export async function listOwnLinks(userId: string): Promise<OwnLink[]> {
  const rows = await dbAll<{
    tenant_id: string;
    object_id: string;
    enabled: number | string;
    linked_via: string | null;
    created_at: string | null;
    display_name: string | null;
  }>(
    `SELECT l.tenant_id, l.object_id, l.enabled, l.linked_via, l.created_at, t.display_name
     FROM m365_identity_links l LEFT JOIN m365_tenants t ON t.tenant_id = l.tenant_id
     WHERE l.user_id = ? ORDER BY l.created_at`,
    [userId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    objectId: row.object_id,
    tenantName: row.display_name,
    enabled: Number(row.enabled) === 1,
    linkedVia: row.linked_via || "admin",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

/**
 * Removes the person's own ENABLED link. A link an administrator disabled is left alone (removing it
 * would let the person undo the administrator's decision by linking again).
 */
export async function unlinkOwnIdentity(input: {
  userId: string;
  tenantId: string;
  objectId: string;
  ip: string;
}): Promise<boolean> {
  const result = await dbRun(
    "DELETE FROM m365_identity_links WHERE tenant_id = ? AND object_id = ? AND user_id = ? AND enabled = 1",
    [input.tenantId, input.objectId, input.userId],
  );
  if (!result || result.changes < 1) return false;
  await logSecurityEvent({
    eventType: "M365_IDENTITY_SELF_UNLINKED",
    actor: input.userId,
    target: input.tenantId,
    details: JSON.stringify({ objectRef: objectIdRef(input.objectId) }),
    ipAddress: input.ip,
  });
  return true;
}

/** Deletes consumed codes and codes expired for more than a day. Idempotent; run by the retention job. */
export async function sweepLinkCodes(): Promise<number> {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const result = await dbRun(
    "DELETE FROM m365_link_codes WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)",
    [cutoff, cutoff],
  );
  return result?.changes ?? 0;
}
