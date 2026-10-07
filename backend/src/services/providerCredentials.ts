import crypto from "node:crypto";
import { config } from "../config.js";
import { dbAll, dbGet, dbRun } from "../db.js";
import {
  decryptCredential,
  encryptCredential,
  encryptionAtRestConfigured,
} from "./credentialVault.js";

/**
 * Upstream provider API keys managed from the admin portal. Keys are stored
 * AES-256-GCM encrypted (credentialVault) and overlaid on config.aiKeys, which
 * the provider router reads on every request, so changes apply without a
 * restart. A key set in the portal wins over the .env value; deleting it falls
 * back to .env.
 *
 * Supports multi-key pools per provider with real-time balance tracking (e.g. DeepSeek, OpenRouter)
 * and seamless key rotation / failover.
 */

export const MANAGED_PROVIDERS = [
  "deepseek",
  "openrouter",
  "openai",
  "anthropic",
  "groq",
  "gemini",
] as const;
export type ManagedProvider = (typeof MANAGED_PROVIDERS)[number];

type AiKeys = typeof config.aiKeys;
const envKeys: Readonly<AiKeys> = { ...config.aiKeys };
const adminKeys = new Map<
  ManagedProvider,
  { masked: string; updatedAt: string; updatedBy: string | null }
>();

// Multi-key pool and in-memory caches
const activeKeyPool = new Map<ManagedProvider, string[]>();
const roundRobinIndex = new Map<ManagedProvider, number>();
const cachedBalances = new Map<string, ProviderBalanceInfo>();

const RELOAD_INTERVAL_MS = 60_000;
let reloadTimer: NodeJS.Timeout | null = null;

export function isManagedProvider(value: string): value is ManagedProvider {
  return (MANAGED_PROVIDERS as readonly string[]).includes(value);
}

/** Shows enough to recognise a key, never enough to use it. */
export function maskProviderKey(key: string): string {
  return key.length <= 12 ? "••••" : `${key.slice(0, 5)}…${key.slice(-4)}`;
}

export interface ProviderBalanceInfo {
  isAvailable: boolean;
  currency: string;
  totalBalance: number | null;
  grantedBalance?: number | null;
  toppedUpBalance?: number | null;
  usage?: number | null;
  limit?: number | null;
  raw?: any;
  error?: string | null;
  checkedAt: string;
}

export interface ManagedKeyItem {
  id: string;
  provider: ManagedProvider;
  label: string;
  masked: string;
  source: "admin" | "env";
  isActive: boolean;
  balanceUsd: number | null;
  balanceCurrency: string;
  balanceDetails: any | null;
  lastCheckedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProviderKeyStatus {
  provider: ManagedProvider;
  source: "admin" | "env" | "none";
  masked: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  balance?: ProviderBalanceInfo | null;
  poolCount?: number;
}

function applyKeys(rows: { provider: string; key: string }[]): void {
  for (const provider of MANAGED_PROVIDERS) {
    (config.aiKeys as Record<string, string>)[provider] = envKeys[provider];
  }
  for (const { provider, key } of rows) {
    if (isManagedProvider(provider)) {
      (config.aiKeys as Record<string, string>)[provider] = key;
    }
  }
}

/** Rotates or retrieves an active key from the pool for a provider */
export function getRotatedProviderKey(
  provider: ManagedProvider,
): string | null {
  const pool = activeKeyPool.get(provider);
  if (!pool || pool.length === 0) return config.aiKeys[provider] || null;
  if (pool.length === 1) return pool[0];
  const idx = (roundRobinIndex.get(provider) || 0) % pool.length;
  roundRobinIndex.set(provider, idx + 1);
  return pool[idx];
}

/** Loads portal-managed keys into config.aiKeys and keeps them in sync. */
export async function loadProviderCredentials(): Promise<void> {
  const rows = await dbAll<{
    provider: string;
    key_encrypted: string;
    key_masked: string;
    updated_at: string;
    updated_by: string | null;
  }>(
    "SELECT provider, key_encrypted, key_masked, updated_at, updated_by FROM provider_credentials",
  );

  adminKeys.clear();
  activeKeyPool.clear();
  const usable: { provider: string; key: string }[] = [];
  for (const row of rows) {
    if (!isManagedProvider(row.provider)) continue;
    let key: string | null = null;
    try {
      key = decryptCredential(row.key_encrypted);
    } catch {
      key = null;
    }
    if (!key) {
      console.error(
        `[ProviderKeys] Cannot decrypt the ${row.provider} key; check DATA_ENCRYPTION_KEY.`,
      );
      continue;
    }
    adminKeys.set(row.provider, {
      masked: row.key_masked,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    });
    usable.push({ provider: row.provider, key });

    const pool = activeKeyPool.get(row.provider) || [];
    pool.push(key);
    activeKeyPool.set(row.provider, pool);
  }

  // Next, query multi-key pool table provider_api_keys if present
  try {
    const multiRows = await dbAll<{
      id: string;
      provider: string;
      label: string;
      key_encrypted: string;
      key_masked: string;
      is_active: number;
      balance_usd: number | null;
      balance_currency: string | null;
      balance_details: string | null;
      last_checked_at: string | null;
      updated_at: string;
      updated_by: string | null;
    }>(
      "SELECT id, provider, label, key_encrypted, key_masked, is_active, balance_usd, balance_currency, balance_details, last_checked_at, updated_at, updated_by FROM provider_api_keys ORDER BY updated_at DESC",
    );

    const poolMap = new Map<ManagedProvider, string[]>();
    for (const r of multiRows) {
      if (!isManagedProvider(r.provider)) continue;
      if (r.balance_details) {
        try {
          const parsed = JSON.parse(r.balance_details);
          cachedBalances.set(r.id, parsed);
          if (r.is_active === 1) {
            cachedBalances.set(r.provider, parsed);
          }
        } catch {}
      }
      if (r.is_active === 1) {
        try {
          const dec = decryptCredential(r.key_encrypted);
          if (dec) {
            const list = poolMap.get(r.provider) || [];
            if (!list.includes(dec)) list.push(dec);
            poolMap.set(r.provider, list);
          }
        } catch {}
      }
    }

    // Merge multi-key pool
    for (const [prov, keysList] of poolMap.entries()) {
      if (keysList.length > 0) {
        activeKeyPool.set(prov, keysList);
        const existingIdx = usable.findIndex((u) => u.provider === prov);
        if (existingIdx >= 0) {
          usable[existingIdx].key = keysList[0];
        } else {
          usable.push({ provider: prov, key: keysList[0] });
        }
      }
    }

    // Auto-migration: if provider_credentials has a key that isn't in provider_api_keys, insert it!
    for (const row of rows) {
      if (!isManagedProvider(row.provider)) continue;
      const hasInMulti = multiRows.some((m) => m.provider === row.provider);
      if (!hasInMulti) {
        const id = crypto.randomUUID();
        await dbRun(
          `INSERT INTO provider_api_keys (id, provider, label, key_encrypted, key_masked, is_active, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`,
          [
            id,
            row.provider,
            "Primary Production Key",
            row.key_encrypted,
            row.key_masked,
            row.updated_by || "MIGRATED",
          ],
        ).catch(() => {});
      }
    }
  } catch (err: any) {
    // Non-fatal if table doesn't exist yet before migrations run
  }

  applyKeys(usable);

  // Trigger non-blocking balance check for active DeepSeek / OpenRouter if not cached
  if (config.aiKeys.deepseek && !cachedBalances.has("deepseek")) {
    fetchProviderBalance("deepseek").catch(() => {});
  }
  if (config.aiKeys.openrouter && !cachedBalances.has("openrouter")) {
    fetchProviderBalance("openrouter").catch(() => {});
  }

  if (!reloadTimer) {
    // Picks up changes made through another API replica.
    reloadTimer = setInterval(() => {
      loadProviderCredentials().catch((err) =>
        console.error("[ProviderKeys] reload failed:", err.message),
      );
    }, RELOAD_INTERVAL_MS);
    reloadTimer.unref();
  }
}

export function listProviderKeys(): ProviderKeyStatus[] {
  return MANAGED_PROVIDERS.map((provider) => {
    const admin = adminKeys.get(provider);
    const pool = activeKeyPool.get(provider) || [];
    const balance = cachedBalances.get(provider) || null;
    if (admin) {
      return {
        provider,
        source: "admin",
        masked: admin.masked,
        updatedAt: admin.updatedAt,
        updatedBy: admin.updatedBy,
        balance,
        poolCount: pool.length,
      };
    }
    const env = envKeys[provider];
    return {
      provider,
      source: env ? "env" : "none",
      masked: env ? maskProviderKey(env) : null,
      updatedAt: null,
      updatedBy: null,
      balance,
      poolCount: pool.length,
    };
  });
}

/** Lists all keys configured across the multi-key pool */
export async function listMultiProviderKeys(): Promise<ManagedKeyItem[]> {
  try {
    const rows = await dbAll<{
      id: string;
      provider: string;
      label: string;
      key_masked: string;
      is_active: number;
      balance_usd: number | null;
      balance_currency: string | null;
      balance_details: string | null;
      last_checked_at: string | null;
      updated_at: string;
      updated_by: string | null;
    }>(
      "SELECT id, provider, label, key_masked, is_active, balance_usd, balance_currency, balance_details, last_checked_at, updated_at, updated_by FROM provider_api_keys ORDER BY provider ASC, updated_at DESC",
    );
    return rows.map((r) => {
      let details: any = null;
      if (r.balance_details) {
        try {
          details = JSON.parse(r.balance_details);
        } catch {}
      }
      return {
        id: r.id,
        provider: r.provider as ManagedProvider,
        label: r.label,
        masked: r.key_masked,
        source: "admin",
        isActive: r.is_active === 1,
        balanceUsd: r.balance_usd,
        balanceCurrency: r.balance_currency || "USD",
        balanceDetails: details,
        lastCheckedAt: r.last_checked_at,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      };
    });
  } catch {
    return [];
  }
}

/** Names of providers with a usable key (for /health and the boot banner). */
export function activeProviderNames(): string[] {
  return MANAGED_PROVIDERS.filter((provider) =>
    Boolean(config.aiKeys[provider]),
  );
}

export async function setProviderKey(
  provider: ManagedProvider,
  key: string,
  updatedBy: string,
): Promise<ProviderKeyStatus> {
  const trimmed = key.trim();
  if (trimmed.length < 16 || /\s/.test(trimmed)) {
    throw new Error("That does not look like an API key.");
  }
  if (!encryptionAtRestConfigured()) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not configured; refusing to store provider keys.",
    );
  }
  const encrypted = encryptCredential(trimmed)!;
  await dbRun(
    `INSERT INTO provider_credentials (provider, key_encrypted, key_masked, updated_by, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(provider) DO UPDATE SET
       key_encrypted = excluded.key_encrypted, key_masked = excluded.key_masked,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [provider, encrypted, maskProviderKey(trimmed), updatedBy],
  );

  // Also upsert into provider_api_keys
  try {
    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM provider_api_keys WHERE provider = ? AND is_active = 1 LIMIT 1",
      [provider],
    );
    const keyId = existing?.id || crypto.randomUUID();
    await dbRun(
      `INSERT INTO provider_api_keys (id, provider, label, key_encrypted, key_masked, is_active, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         key_encrypted = excluded.key_encrypted, key_masked = excluded.key_masked,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [
        keyId,
        provider,
        "Primary Key",
        encrypted,
        maskProviderKey(trimmed),
        updatedBy,
      ],
    );
  } catch {}

  // Fetch balance for the new key
  fetchProviderBalance(provider, trimmed).catch(() => {});

  await loadProviderCredentials();
  return listProviderKeys().find((status) => status.provider === provider)!;
}

export async function addProviderApiKey(
  provider: ManagedProvider,
  key: string,
  label: string,
  updatedBy: string,
  isActive = true,
): Promise<ManagedKeyItem> {
  const trimmed = key.trim();
  if (trimmed.length < 16 || /\s/.test(trimmed)) {
    throw new Error("That does not look like an API key.");
  }
  if (!encryptionAtRestConfigured()) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not configured; refusing to store provider keys.",
    );
  }
  const encrypted = encryptCredential(trimmed)!;
  const masked = maskProviderKey(trimmed);
  const id = crypto.randomUUID();

  let balanceResult: ProviderBalanceInfo | null = null;
  try {
    balanceResult = await fetchProviderBalance(provider, trimmed);
  } catch {}

  const balanceUsd = balanceResult?.totalBalance ?? null;
  const balanceCurrency = balanceResult?.currency || "USD";
  const balanceDetails = balanceResult ? JSON.stringify(balanceResult) : null;
  const lastCheckedAt = balanceResult?.checkedAt || new Date().toISOString();

  await dbRun(
    `INSERT INTO provider_api_keys (id, provider, label, key_encrypted, key_masked, is_active, balance_usd, balance_currency, balance_details, last_checked_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      provider,
      label.trim() || `${provider} Key`,
      encrypted,
      masked,
      isActive ? 1 : 0,
      balanceUsd,
      balanceCurrency,
      balanceDetails,
      lastCheckedAt,
      updatedBy,
    ],
  );

  // Also sync primary provider_credentials if this is the active key or only key
  if (isActive) {
    await dbRun(
      `INSERT INTO provider_credentials (provider, key_encrypted, key_masked, updated_by, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(provider) DO UPDATE SET
         key_encrypted = excluded.key_encrypted, key_masked = excluded.key_masked,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [provider, encrypted, masked, updatedBy],
    );
  }

  await loadProviderCredentials();

  return {
    id,
    provider,
    label: label.trim() || `${provider} Key`,
    masked,
    source: "admin",
    isActive,
    balanceUsd,
    balanceCurrency,
    balanceDetails: balanceResult,
    lastCheckedAt,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export async function updateProviderApiKey(
  id: string,
  updates: { label?: string; isActive?: boolean },
): Promise<ManagedKeyItem | null> {
  const row = await dbGet<{
    id: string;
    provider: string;
    label: string;
    key_encrypted: string;
    key_masked: string;
    is_active: number;
    balance_usd: number | null;
    balance_currency: string | null;
    balance_details: string | null;
    last_checked_at: string | null;
    updated_at: string;
    updated_by: string | null;
  }>("SELECT * FROM provider_api_keys WHERE id = ?", [id]);

  if (!row) return null;

  const newLabel =
    updates.label !== undefined ? updates.label.trim() : row.label;
  const newActive =
    updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : row.is_active;

  await dbRun(
    `UPDATE provider_api_keys SET label = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newLabel, newActive, id],
  );

  await loadProviderCredentials();
  const list = await listMultiProviderKeys();
  return list.find((k) => k.id === id) || null;
}

export async function deleteProviderApiKey(id: string): Promise<void> {
  const row = await dbGet<{ provider: string; key_masked: string }>(
    "SELECT provider, key_masked FROM provider_api_keys WHERE id = ?",
    [id],
  );
  await dbRun("DELETE FROM provider_api_keys WHERE id = ?", [id]);

  if (row && isManagedProvider(row.provider)) {
    const remaining = await dbAll<{
      key_encrypted: string;
      key_masked: string;
      updated_by: string;
    }>(
      "SELECT key_encrypted, key_masked, updated_by FROM provider_api_keys WHERE provider = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1",
      [row.provider],
    );
    if (remaining.length > 0) {
      await dbRun(
        `INSERT INTO provider_credentials (provider, key_encrypted, key_masked, updated_by, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(provider) DO UPDATE SET
           key_encrypted = excluded.key_encrypted, key_masked = excluded.key_masked,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [
          row.provider,
          remaining[0].key_encrypted,
          remaining[0].key_masked,
          remaining[0].updated_by,
        ],
      );
    } else {
      await dbRun("DELETE FROM provider_credentials WHERE provider = ?", [
        row.provider,
      ]);
    }
  }

  await loadProviderCredentials();
}

export async function refreshKeyBalance(
  id: string,
): Promise<ProviderBalanceInfo> {
  const row = await dbGet<{
    id: string;
    provider: string;
    key_encrypted: string;
  }>("SELECT id, provider, key_encrypted FROM provider_api_keys WHERE id = ?", [
    id,
  ]);
  if (!row || !isManagedProvider(row.provider)) {
    throw new Error("Key not found in pool.");
  }
  const dec = decryptCredential(row.key_encrypted);
  if (!dec) {
    throw new Error("Cannot decrypt key.");
  }
  const balance = await fetchProviderBalance(
    row.provider as ManagedProvider,
    dec,
  );
  cachedBalances.set(id, balance);
  cachedBalances.set(row.provider, balance);

  await dbRun(
    `UPDATE provider_api_keys SET balance_usd = ?, balance_currency = ?, balance_details = ?, last_checked_at = ? WHERE id = ?`,
    [
      balance.totalBalance,
      balance.currency,
      JSON.stringify(balance),
      balance.checkedAt,
      id,
    ],
  );

  return balance;
}

export async function deleteProviderKey(
  provider: ManagedProvider,
): Promise<ProviderKeyStatus> {
  await dbRun("DELETE FROM provider_credentials WHERE provider = ?", [
    provider,
  ]);
  await dbRun("DELETE FROM provider_api_keys WHERE provider = ?", [
    provider,
  ]).catch(() => {});
  await loadProviderCredentials();
  return listProviderKeys().find((status) => status.provider === provider)!;
}

const TEST_ENDPOINTS: Record<
  ManagedProvider,
  (key: string) => { url: string; headers: Record<string, string> }
> = {
  deepseek: (key) => ({
    url: "https://api.deepseek.com/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  openrouter: (key) => ({
    url: "https://openrouter.ai/api/v1/auth/key",
    headers: { Authorization: `Bearer ${key}` },
  }),
  openai: (key) => ({
    url: "https://api.openai.com/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  anthropic: (key) => ({
    url: "https://api.anthropic.com/v1/models",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }),
  groq: (key) => ({
    url: "https://api.groq.com/openai/v1/models",
    headers: { Authorization: `Bearer ${key}` },
  }),
  gemini: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: {},
  }),
};

/**
 * Checks a key against the provider's model-list or auth endpoint (free, no tokens).
 * Uses the stored key when `key` is omitted.
 */
export async function testProviderKey(
  provider: ManagedProvider,
  key?: string,
): Promise<{ ok: boolean; status: number; message: string }> {
  const candidate = key?.trim() || config.aiKeys[provider];
  if (!candidate)
    return { ok: false, status: 0, message: "No key configured." };
  const { url, headers } = TEST_ENDPOINTS[provider](candidate);
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok)
      return { ok: true, status: response.status, message: "Key works." };
    const message =
      response.status === 401 || response.status === 403
        ? "The provider rejected this key."
        : response.status === 402
          ? "The key is valid but the account has no balance."
          : `Provider returned HTTP ${response.status}.`;
    return { ok: false, status: response.status, message };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `Could not reach the provider: ${(err as Error).message}`,
    };
  }
}

/**
 * Queries real-time account balance / credits from upstream provider (DeepSeek, OpenRouter).
 */
export async function fetchProviderBalance(
  provider: ManagedProvider,
  key?: string,
): Promise<ProviderBalanceInfo> {
  const candidate = key?.trim() || config.aiKeys[provider];
  const now = new Date().toISOString();

  if (!candidate) {
    return {
      isAvailable: false,
      currency: "USD",
      totalBalance: null,
      error: `No ${provider} key configured.`,
      checkedAt: now,
    };
  }

  if (provider === "deepseek") {
    try {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${candidate}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return {
          isAvailable: false,
          currency: "USD",
          totalBalance: null,
          error: `DeepSeek balance HTTP ${res.status}`,
          checkedAt: now,
        };
      }
      const data = (await res.json()) as any;
      const info = data.balance_infos?.[0];
      const total =
        info?.total_balance !== undefined
          ? parseFloat(info.total_balance)
          : null;
      const granted =
        info?.granted_balance !== undefined
          ? parseFloat(info.granted_balance)
          : 0;
      const toppedUp =
        info?.topped_up_balance !== undefined
          ? parseFloat(info.topped_up_balance)
          : 0;
      const balanceResult: ProviderBalanceInfo = {
        isAvailable: Boolean(data.is_available),
        currency: info?.currency || "USD",
        totalBalance: total !== null && !isNaN(total) ? total : null,
        grantedBalance: !isNaN(granted) ? granted : 0,
        toppedUpBalance: !isNaN(toppedUp) ? toppedUp : 0,
        raw: data,
        checkedAt: now,
      };
      cachedBalances.set(provider, balanceResult);
      return balanceResult;
    } catch (err: any) {
      return {
        isAvailable: false,
        currency: "USD",
        totalBalance: null,
        error: err.message,
        checkedAt: now,
      };
    }
  }

  if (provider === "openrouter") {
    try {
      const creditsRes = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${candidate}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (creditsRes.ok) {
        const creditsData = (await creditsRes.json()) as any;
        const totalCredits = Number(creditsData.data?.total_credits || 0);
        const totalUsage = Number(creditsData.data?.total_usage || 0);
        const remaining = Math.max(0, totalCredits - totalUsage);
        const balanceResult: ProviderBalanceInfo = {
          isAvailable: true,
          currency: "USD",
          totalBalance: remaining,
          usage: totalUsage,
          limit: totalCredits,
          raw: creditsData,
          checkedAt: now,
        };
        cachedBalances.set(provider, balanceResult);
        return balanceResult;
      }
      const authRes = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${candidate}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (authRes.ok) {
        const authData = (await authRes.json()) as any;
        const limit =
          authData.data?.limit !== null ? Number(authData.data?.limit) : null;
        const usage = Number(authData.data?.usage || 0);
        const balance = limit !== null ? Math.max(0, limit - usage) : null;
        const balanceResult: ProviderBalanceInfo = {
          isAvailable: true,
          currency: "USD",
          totalBalance: balance,
          usage,
          limit,
          raw: authData,
          checkedAt: now,
        };
        cachedBalances.set(provider, balanceResult);
        return balanceResult;
      }
      return {
        isAvailable: false,
        currency: "USD",
        totalBalance: null,
        error: `OpenRouter balance HTTP ${creditsRes.status}`,
        checkedAt: now,
      };
    } catch (err: any) {
      return {
        isAvailable: false,
        currency: "USD",
        totalBalance: null,
        error: err.message,
        checkedAt: now,
      };
    }
  }

  // Other providers: verify connectivity
  const test = await testProviderKey(provider, candidate);
  const result: ProviderBalanceInfo = {
    isAvailable: test.ok,
    currency: "USD",
    totalBalance: null,
    error: test.ok ? null : test.message,
    raw: { statusText: test.message },
    checkedAt: now,
  };
  cachedBalances.set(provider, result);
  return result;
}
