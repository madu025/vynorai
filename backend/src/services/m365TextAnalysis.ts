import { AI_TEXT_FEATURES } from "./m365Capabilities.js";
import { z } from "../middleware/validate.js";
import type { AuthenticatedUser } from "./aiProxy.js";
import {
  M365AnalysisError,
  assertAnalysisRateLimit,
  runAdvisoryModel,
} from "./m365Analysis.js";
import { PiiMap } from "./piiShield.js";

export const TEXT_ANALYSIS_CONTRACT_VERSION =
  "2026-10-19.excel-text-analysis.v1" as const;

export const textAnalysisRequestSchema = z
  .object({
    contractVersion: z.literal(TEXT_ANALYSIS_CONTRACT_VERSION).optional(),
    feature: z.enum(AI_TEXT_FEATURES),
    language: z.enum(["en", "si", "ta"]).default("en"),
    consent: z.literal(true),
    texts: z.array(z.string().max(1000)).min(1).max(100),
    categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  })
  .strict();

export type TextAnalysisRequest = z.infer<typeof textAnalysisRequestSchema>;

const textAnalysisResultSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(99),
            label: z.string().min(1).max(60),
            keywords: z.array(z.string().min(1).max(40)).max(10),
            confidence: z.number().min(0).max(1),
            evidence: z.string().max(160),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const SYSTEM_PROMPT = [
  "You are a privacy-preserving spreadsheet text analyst.",
  "You receive a bounded batch of masked text items, never a workbook and never raw personal identifiers.",
  "Reply with exactly one JSON object and no markdown.",
  "JSON shape: {results:[{index:number,label:string,keywords:string[],confidence:number,evidence:string}]}",
  "Use one result for every input index exactly once. Keep evidence short and do not repeat text or identifiers.",
  "For sentiment use only positive, negative or neutral as label. For keywords return up to 10 useful normalized words.",
  "For classification use only one of the supplied categories when categories are supplied.",
  "Do not claim certainty, fraud, causation or facts not present in the text.",
].join("\n");

const BATCH_SIZE = 25;
const MAX_TOTAL_CHARS = 60_000;

function buildMessages(
  request: TextAnalysisRequest,
  texts: string[],
): Array<{ role: string; content: string }> {
  const categories = request.categories?.length
    ? `\nAllowed categories: ${JSON.stringify(request.categories)}`
    : "";
  return [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\nLanguage: ${request.language}.${categories}`,
    },
    {
      role: "user",
      content: JSON.stringify(texts.map((text, index) => ({ index, text }))),
    },
  ];
}

function parseResponse(
  text: string,
  count: number,
  feature: TextAnalysisRequest["feature"],
  categories?: string[],
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new M365AnalysisError(
      "AI_TEXT_ANALYSIS_INVALID",
      422,
      "invalid JSON",
    );
  }
  const checked = textAnalysisResultSchema.safeParse(parsed);
  if (!checked.success || checked.data.results.length !== count)
    throw new M365AnalysisError(
      "AI_TEXT_ANALYSIS_INVALID",
      422,
      "result count or schema mismatch",
    );
  const expected = new Set<number>();
  for (const result of checked.data.results) {
    if (expected.has(result.index) || result.index >= count)
      throw new M365AnalysisError(
        "AI_TEXT_ANALYSIS_INVALID",
        422,
        "duplicate or unknown index",
      );
    expected.add(result.index);
    if (
      feature === "sentiment" &&
      !["positive", "negative", "neutral"].includes(result.label)
    )
      throw new M365AnalysisError(
        "AI_TEXT_ANALYSIS_INVALID",
        422,
        "invalid sentiment label",
      );
    if (
      feature === "classification" &&
      categories?.length &&
      !categories.includes(result.label)
    )
      throw new M365AnalysisError(
        "AI_TEXT_ANALYSIS_INVALID",
        422,
        "invalid classification label",
      );
    if (/__PII_(?:EMAIL|PHONE|NIC|CARD)_\d+__/i.test(JSON.stringify(result)))
      throw new M365AnalysisError(
        "AI_TEXT_ANALYSIS_INVALID",
        422,
        "PII token in result",
      );
  }
  return checked.data.results.sort((left, right) => left.index - right.index);
}

/** Consent-gated, masked, bounded batch text analysis through the normal m365 gateway. */
export async function analyzeTextBatch(
  user: AuthenticatedUser,
  rawRequest: unknown,
): Promise<{
  contractVersion: typeof TEXT_ANALYSIS_CONTRACT_VERSION;
  results: unknown[];
  maskedCount: number;
  batches: number;
}> {
  const checked = textAnalysisRequestSchema.safeParse(rawRequest);
  if (!checked.success)
    throw new M365AnalysisError(
      "AI_TEXT_ANALYSIS_INVALID",
      422,
      "request schema mismatch",
    );
  const request = checked.data;
  const totalChars = request.texts.reduce((sum, text) => sum + text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS)
    throw new M365AnalysisError(
      "AI_TEXT_ANALYSIS_INVALID",
      422,
      "batch is too large",
    );
  assertAnalysisRateLimit(user.id);
  const map = new PiiMap();
  const masked = request.texts.map((text) => map.mask(text));
  const results: unknown[] = [];
  for (let start = 0; start < masked.length; start += BATCH_SIZE) {
    const batch = masked.slice(start, start + BATCH_SIZE);
    const messages = buildMessages(request, batch);
    const response = await runAdvisoryModel(
      user,
      messages,
      Math.ceil(
        messages.reduce((sum, item) => sum + item.content.length, 0) / 4,
      ) + 1200,
      1200,
    );
    const parsed = parseResponse(
      response,
      batch.length,
      request.feature,
      request.categories,
    );
    results.push(
      ...parsed.map((item) => ({ ...item, index: item.index + start })),
    );
  }
  return {
    contractVersion: TEXT_ANALYSIS_CONTRACT_VERSION,
    results,
    maskedCount: map.size,
    batches: Math.ceil(masked.length / BATCH_SIZE),
  };
}
