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

export function validateEstimateInput(value: unknown): BackgroundEstimateInput {
  const input = value as Partial<BackgroundEstimateInput>;
  if (!input || typeof input !== "object") throw new Error("INVALID_INPUT");
  if (
    typeof input.prompt !== "string" ||
    input.prompt.trim().length < 3 ||
    input.prompt.length > 20_000
  )
    throw new Error("INVALID_PROMPT");
  if (
    !SHA256_RE.test(input.projectFingerprint || "") ||
    !SHA256_RE.test(input.manifestDigest || "")
  )
    throw new Error("INVALID_DIGEST");
  if (
    !Number.isInteger(input.fileCount) ||
    input.fileCount! < 1 ||
    input.fileCount! > 20_000
  )
    throw new Error("INVALID_FILE_COUNT");
  const maxUpload = Number(
    process.env.BG_MAX_UPLOAD_BYTES || 100 * 1024 * 1024,
  );
  if (
    !Number.isInteger(input.uploadBytes) ||
    input.uploadBytes! < 1 ||
    input.uploadBytes! > maxUpload
  )
    throw new Error("INVALID_UPLOAD_SIZE");
  const language = ["si", "en", "other"].includes(input.language || "")
    ? input.language!
    : "other";
  const stacks = Array.isArray(input.stacks)
    ? [
        ...new Set(
          input.stacks
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.slice(0, 32)),
        ),
      ].slice(0, 12)
    : [];
  return {
    ...input,
    prompt: input.prompt.trim(),
    language,
    stacks,
  } as BackgroundEstimateInput;
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
