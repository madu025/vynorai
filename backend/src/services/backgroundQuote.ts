import crypto from "crypto";
import { config } from "../config.js";
import type {
  BackgroundEstimateInput,
  BackgroundEstimateQuote,
} from "./backgroundTypes.js";
import { getRedis } from "./redisStore.js";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const QUOTE_TTL_MS = 10 * 60_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function quoteSecret(): string {
  const value = process.env.BG_QUOTE_SECRET || config.jwtSecret;
  if (config.nodeEnv === "production" && !process.env.BG_QUOTE_SECRET)
    throw new Error("BG_QUOTE_SECRET is required in production");
  return value;
}

import { z } from "zod";

export const BackgroundEstimateInputSchema = z.object({
  prompt: z
    .string({ error: "INVALID_PROMPT" })
    .trim()
    .min(3, "INVALID_PROMPT")
    .max(20_000, "INVALID_PROMPT"),
  projectFingerprint: z
    .string({ error: "INVALID_DIGEST" })
    .regex(SHA256_RE, "INVALID_DIGEST"),
  manifestDigest: z
    .string({ error: "INVALID_DIGEST" })
    .regex(SHA256_RE, "INVALID_DIGEST"),
  fileCount: z
    .number({ error: "INVALID_FILE_COUNT" })
    .int("INVALID_FILE_COUNT")
    .min(1, "INVALID_FILE_COUNT")
    .max(20_000, "INVALID_FILE_COUNT"),
  uploadBytes: z
    .number({ error: "INVALID_UPLOAD_SIZE" })
    .int("INVALID_UPLOAD_SIZE")
    .min(1, "INVALID_UPLOAD_SIZE"),
  language: z.enum(["si", "en", "other"]).optional().default("other"),
  stacks: z
    .array(z.string())
    .optional()
    .default([])
    .transform((items) =>
      [...new Set(items.map((v) => v.slice(0, 32)))].slice(0, 12),
    ),
});

export function validateEstimateInput(value: unknown): BackgroundEstimateInput {
  if (!value || typeof value !== "object") throw new Error("INVALID_INPUT");
  const parsed = BackgroundEstimateInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "INVALID_INPUT");
  }
  const maxUpload = Number(
    process.env.BG_MAX_UPLOAD_BYTES || 100 * 1024 * 1024,
  );
  if (parsed.data.uploadBytes > maxUpload) {
    throw new Error("INVALID_UPLOAD_SIZE");
  }
  return {
    ...parsed.data,
    prompt: parsed.data.prompt.trim(),
    language: parsed.data.language,
    stacks: parsed.data.stacks,
  };
}

export function estimateInputDigest(input: BackgroundEstimateInput): string {
  return crypto.createHash("sha256").update(canonical(input)).digest("hex");
}

export function createEstimateQuote(
  userId: string,
  input: BackgroundEstimateInput,
): {
  quote: BackgroundEstimateQuote;
  signature: string;
} {
  const rounds = Math.min(
    24,
    5 + Math.ceil(input.fileCount / 150) + input.stacks.length * 2,
  );
  const promptCredits = Math.ceil(input.prompt.length / 4) * 4;
  const repositoryCredits =
    Math.ceil(input.uploadBytes / 1024) * 12 + input.fileCount * 40;
  const modelCredits = Math.max(
    100_000,
    Math.ceil((promptCredits + repositoryCredits) * rounds * 0.35),
  );
  const expectedMinutes = Math.min(
    30,
    Math.max(5, 4 + Math.ceil(input.fileCount / 100) + input.stacks.length * 2),
  );
  const perMinute = Math.ceil(
    Number(process.env.BG_COMPUTE_CREDITS_PER_HOUR || 100_000) / 60,
  );
  const computeCredits = expectedMinutes * perMinute;
  const totalCredits = modelCredits + computeCredits;
  const maximumCapCredits = Math.max(
    totalCredits,
    Math.min(8_000_000, totalCredits * 4),
  );
  const suggestedCapCredits = Math.min(
    maximumCapCredits,
    Math.max(totalCredits, Math.ceil(totalCredits * 1.5)),
  );
  const quote: BackgroundEstimateQuote = {
    quoteId: crypto.randomUUID(),
    userId,
    inputDigest: estimateInputDigest(input),
    modelCredits,
    computeCredits,
    totalCredits,
    minimumCapCredits: totalCredits,
    suggestedCapCredits,
    maximumCapCredits,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
  };
  return { quote, signature: signEstimateQuote(quote) };
}

export function signEstimateQuote(quote: BackgroundEstimateQuote): string {
  return crypto
    .createHmac("sha256", quoteSecret())
    .update(canonical(quote))
    .digest("base64url");
}

export function verifyEstimateQuote(
  quote: BackgroundEstimateQuote,
  signature: string,
): boolean {
  if (new Date(quote.expiresAt).getTime() <= Date.now()) return false;
  const expected = Buffer.from(signEstimateQuote(quote));
  const actual = Buffer.from(signature || "");
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

export async function storeEstimateQuote(
  quote: BackgroundEstimateQuote,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  await redis.set(`vynor:bg:v1:quote:${quote.quoteId}`, JSON.stringify(quote), {
    EX: Math.max(
      1,
      Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1000),
    ),
  });
}

export async function consumeEstimateQuote(
  quoteId: string,
): Promise<BackgroundEstimateQuote | null> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  const key = `vynor:bg:v1:quote:${quoteId}`;
  const raw = await redis.getDel(key);
  if (!raw) return null;
  return JSON.parse(raw) as BackgroundEstimateQuote;
}
