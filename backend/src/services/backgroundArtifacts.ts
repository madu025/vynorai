import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Transform, type Readable } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { billingGet as dbGet, billingRun as dbRun } from "./billingDb.js";

const MAGIC = Buffer.from("VYNORBG1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

function artifactRoot(): string {
  return path.resolve(
    process.env.BG_ARTIFACT_DIR ||
      path.join(process.cwd(), "data", "background-artifacts"),
  );
}

function encryptionKey(): Buffer {
  const encoded = process.env.BG_ARTIFACT_MASTER_KEY;
  if (!encoded) throw new Error("BG_ARTIFACT_MASTER_KEY_NOT_CONFIGURED");
  const key = /^[a-f0-9]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("BG_ARTIFACT_MASTER_KEY_INVALID");
  return key;
}

class ByteLimit extends Transform {
  bytes = 0;
  constructor(
    private readonly maxBytes: number,
    private readonly hash: crypto.Hash,
  ) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes)
      return callback(new Error("ARTIFACT_TOO_LARGE"));
    this.hash.update(chunk);
    callback(null, chunk);
  }
}

export interface StoredBackgroundArtifact {
  id: string;
  sha256: string;
  bytes: number;
  expiresAt: string;
}

export async function storeBackgroundArtifact(
  taskId: string,
  artifactType: "upload" | "patch" | "proof" | "screenshot",
  source: Readable,
  maxBytes: number,
  retentionMs = 7 * 24 * 60 * 60_000,
): Promise<StoredBackgroundArtifact> {
  const id = uuidv4();
  const root = artifactRoot();
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const finalPath = path.join(root, `${id}.enc`);
  const tempPath = path.join(root, `${id}.part`);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const hash = crypto.createHash("sha256");
  const limiter = new ByteLimit(maxBytes, hash);
  const output = fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
  output.write(MAGIC);
  output.write(iv);
  try {
    await pipeline(source, limiter, cipher, output, { end: false });
    output.write(cipher.getAuthTag());
    output.end();
    await new Promise<void>((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
    });
    await fs.promises.rename(tempPath, finalPath);
  } catch (error) {
    output.destroy();
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  const expiresAt = new Date(Date.now() + retentionMs).toISOString();
  const sha256 = hash.digest("hex");
  await dbRun(
    `INSERT INTO background_artifacts
     (id, task_id, artifact_type, storage_path, sha256, bytes, key_version, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      artifactType,
      finalPath,
      sha256,
      limiter.bytes,
      "bg-v1",
      expiresAt,
    ],
  );
  return { id, sha256, bytes: limiter.bytes, expiresAt };
}

export async function storeBackgroundBuffer(
  taskId: string,
  artifactType: "patch" | "proof" | "screenshot",
  value: Buffer,
  maxBytes: number,
): Promise<StoredBackgroundArtifact> {
  const { Readable } = await import("stream");
  return storeBackgroundArtifact(
    taskId,
    artifactType,
    Readable.from(value),
    maxBytes,
  );
}

export async function readBackgroundArtifact(
  artifactId: string,
  maxBytes: number,
): Promise<Buffer> {
  const row = await dbGet<{
    storage_path: string;
    bytes: number;
    deleted_at?: string;
  }>(
    "SELECT storage_path, bytes, deleted_at FROM background_artifacts WHERE id = ?",
    [artifactId],
  );
  if (!row || row.deleted_at) throw new Error("ARTIFACT_NOT_FOUND");
  if (Number(row.bytes) > maxBytes) throw new Error("ARTIFACT_TOO_LARGE");
  const payload = await fs.promises.readFile(row.storage_path);
  if (
    payload.length < MAGIC.length + IV_BYTES + TAG_BYTES ||
    !payload.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("ARTIFACT_CORRUPT");
  const iv = payload.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(
    MAGIC.length + IV_BYTES,
    payload.length - TAG_BYTES,
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function deleteBackgroundArtifact(
  artifactId: string,
): Promise<void> {
  const row = await dbGet<{ storage_path: string; deleted_at?: string }>(
    "SELECT storage_path, deleted_at FROM background_artifacts WHERE id = ?",
    [artifactId],
  );
  if (!row || row.deleted_at) return;
  const root = artifactRoot();
  const target = path.resolve(row.storage_path);
  if (!target.startsWith(`${root}${path.sep}`) || target === root)
    throw new Error("REFUSED_ARTIFACT_DELETE");
  await fs.promises.rm(target, { force: true });
  await dbRun(
    "UPDATE background_artifacts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
    [artifactId],
  );
}
