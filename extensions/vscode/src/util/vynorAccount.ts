/**
 * Key and account belong together. A key is checked with the server before it
 * is stored, and the account it belongs to is recorded next to a fingerprint
 * of that key, so a different key never inherits the previous account.
 * No vscode import: this module is unit tested on its own.
 */
import * as crypto from "node:crypto";

export interface VynorQuotaInfo {
  planId: string;
  planName: string;
  monthlyTokens: number;
  usedTokens: number;
  remainingTokens: number;
  percentageUsed: number;
  periodEnd: string;
  email: string;
  tokensSaved?: number;
  savingPercentage?: number;
  estimatedLkrSaved?: number;
}

export type KeyCheck =
  | { ok: true; quota: VynorQuotaInfo }
  | { ok: false; reason: "invalid" | "unreachable" };

export function parseQuota(data: any): VynorQuotaInfo {
  const monthly = data?.monthlyUsage || {};
  const slm = data?.slmSavings || {};
  const maxTokens = monthly.max_tokens || 100_000;
  const usedTokens = monthly.used_tokens || 0;
  return {
    planId: monthly.plan_name || "free",
    planName: (monthly.plan_name || "Free Tier").toUpperCase(),
    monthlyTokens: maxTokens,
    usedTokens,
    remainingTokens: Math.max(0, maxTokens - usedTokens),
    percentageUsed: Math.min(100, Math.round((usedTokens / maxTokens) * 100)),
    periodEnd: monthly.period_end || "",
    email: data?.user?.email || "",
    tokensSaved: slm.tokensSaved || 0,
    savingPercentage: slm.savingPercentage || 0,
    estimatedLkrSaved: slm.estimatedLkrSaved || 0,
  };
}

/** Asks the server who owns the key. Never throws. */
export async function checkVynorKey(
  apiKey: string,
  webUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`${webUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "invalid" };
  }
  if (!res.ok) return { ok: false, reason: "unreachable" };
  try {
    return { ok: true, quota: parseQuota(await res.json()) };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export interface AccountBinding {
  keyHash: string;
  email: string;
}

export function keyFingerprint(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function makeBinding(apiKey: string, email: string): AccountBinding {
  return { keyHash: keyFingerprint(apiKey), email };
}

/** The account recorded for exactly this key, or "" when none is. */
export function boundEmail(binding: unknown, apiKey: string): string {
  const b = binding as Partial<AccountBinding> | undefined;
  if (!b || typeof b.email !== "string" || b.keyHash !== keyFingerprint(apiKey))
    return "";
  return b.email;
}

/** Server answer wins; an email handed over by the browser flow is the fallback. */
export function accountEmailFor(
  quota: VynorQuotaInfo | undefined,
  provided: string,
): string {
  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  if (quota && isEmail(quota.email)) return quota.email;
  return isEmail(provided) ? provided : "";
}
