import { config } from "../config.js";
import { dbAll, dbRun } from "../db.js";
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

const RELOAD_INTERVAL_MS = 60_000;
let reloadTimer: NodeJS.Timeout | null = null;

export function isManagedProvider(value: string): value is ManagedProvider {
  return (MANAGED_PROVIDERS as readonly string[]).includes(value);
}

/** Shows enough to recognise a key, never enough to use it. */
export function maskProviderKey(key: string): string {
  return key.length <= 12 ? "••••" : `${key.slice(0, 5)}…${key.slice(-4)}`;
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
  }
  applyKeys(usable);

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

export interface ProviderKeyStatus {
  provider: ManagedProvider;
  source: "admin" | "env" | "none";
  masked: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function listProviderKeys(): ProviderKeyStatus[] {
  return MANAGED_PROVIDERS.map((provider) => {
    const admin = adminKeys.get(provider);
    if (admin) {
      return {
        provider,
        source: "admin",
        masked: admin.masked,
        updatedAt: admin.updatedAt,
        updatedBy: admin.updatedBy,
      };
    }
    const env = envKeys[provider];
    return {
      provider,
      source: env ? "env" : "none",
      masked: env ? maskProviderKey(env) : null,
      updatedAt: null,
      updatedBy: null,
    };
  });
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
  await loadProviderCredentials();
  return listProviderKeys().find((status) => status.provider === provider)!;
}

export async function deleteProviderKey(
  provider: ManagedProvider,
): Promise<ProviderKeyStatus> {
  await dbRun("DELETE FROM provider_credentials WHERE provider = ?", [
    provider,
  ]);
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
    url: "https://openrouter.ai/api/v1/key",
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
 * Checks a key against the provider's model-list endpoint (free, no tokens).
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
