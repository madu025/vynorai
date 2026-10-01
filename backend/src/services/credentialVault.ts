import crypto from "crypto";

const VERSION = "v1";

function getEncryptionKey(): Buffer | null {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) return null;

  const key = /^[a-f0-9]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64");
  }
  return key;
}

export function encryptionAtRestConfigured(): boolean {
  return getEncryptionKey() !== null;
}

export function encryptCredential(value: string): string | null {
  const key = getEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptCredential(payload?: string | null): string | null {
  if (!payload) return null;
  const key = getEncryptionKey();
  if (!key) return null;
  const [version, iv, tag, encrypted] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !encrypted) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 14)}...${apiKey.slice(-4)}`;
}
