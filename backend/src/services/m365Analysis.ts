import crypto from "node:crypto";
import type { Response } from "express";
import { z } from "../middleware/validate.js";
import { handleChatCompletions, type AuthenticatedUser } from "./aiProxy.js";
import { releaseQuotaReservation, reserveQuotaAtomic } from "./monthlyQuota.js";
import { PiiMap } from "./piiShield.js";

export const ANALYSIS_CONTRACT_VERSION =
  "2026-10-15.excel-analysis.v1" as const;

const TYPES = [
  "number",
  "integer",
  "date",
  "boolean",
  "text",
  "empty",
] as const;
const ROLES = [
  "identifier",
  "measure",
  "date",
  "category",
  "text",
  "unknown",
] as const;
const KINDS = ["chart", "pivot-table", "table", "filter", "grouping"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class M365AnalysisError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "M365AnalysisError";
  }
}

const columnSummarySchema = z
  .object({
    index: z.number().int().min(0).max(99),
    name: z.string().min(1).max(60),
    inferredType: z.enum(TYPES),
    roleHint: z.enum(ROLES),
    nonBlank: z.number().int().min(0).max(1_000_000),
    blank: z.number().int().min(0).max(1_000_000),
    distinct: z.number().int().min(0).max(1_000_000).optional(),
    duplicateValues: z.number().int().min(0).max(1_000_000).optional(),
    containsPersonalData: z.boolean(),
    numeric: z
      .object({ min: z.number().finite(), max: z.number().finite() })
      .strict()
      .optional(),
    date: z
      .object({
        min: z.string().regex(ISO_DATE),
        max: z.string().regex(ISO_DATE),
      })
      .strict()
      .optional(),
    topShares: z.array(z.number().min(0).max(1)).max(5).optional(),
  })
  .strict();

export const schemaSummarySchema = z
  .object({
    contractVersion: z.literal(ANALYSIS_CONTRACT_VERSION),
    rowCount: z.number().int().min(1).max(1_000_000),
    columnCount: z.number().int().min(1).max(100),
    headerRowCount: z.union([z.literal(1), z.literal(2)]),
    blankCells: z.number().int().min(0).max(100_000_000),
    columns: z.array(columnSummarySchema).min(1).max(100),
  })
  .strict();

export type SchemaSummary = z.infer<typeof schemaSummarySchema>;

const unit = z.number().min(0).max(1);
const analysisResultSchema = z
  .object({
    summary: z.string().min(1).max(600),
    columns: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(99),
            name: z.string().min(1).max(60),
            inferredType: z.enum(TYPES),
            role: z.enum(ROLES),
            confidence: unit,
            reason: z.string().min(1).max(240),
          })
          .strict(),
      )
      .max(100),
    dataQuality: z
      .array(
        z
          .object({
            severity: z.enum(["info", "warning", "error"]),
            columnIndex: z.number().int().min(0).max(99).optional(),
            message: z.string().min(1).max(240),
            confidence: unit,
          })
          .strict(),
      )
      .max(30),
    recommendations: z
      .array(
        z
          .object({
            kind: z.enum(KINDS),
            title: z.string().min(1).max(120),
            columns: z.array(z.number().int().min(0).max(99)).max(6),
            chartType: z.enum(["column", "line", "bar", "pie"]).optional(),
            confidence: unit,
            reason: z.string().min(1).max(240),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/**
 * Enforces on the server what the add-in promises on the client: identifier and personal-data
 * columns carry counts only. A summary that breaks this is refused before any model sees it.
 */
export function assertPrivateSummary(summary: SchemaSummary): void {
  if (summary.columns.length !== summary.columnCount)
    throw new M365AnalysisError("AI_SUMMARY_INVALID", 422, "column count");
  summary.columns.forEach((column, position) => {
    if (column.index !== position)
      throw new M365AnalysisError("AI_SUMMARY_INVALID", 422, "column order");
    if (column.numeric && column.numeric.min > column.numeric.max)
      throw new M365AnalysisError("AI_SUMMARY_INVALID", 422, "numeric range");
    if (column.date && column.date.min > column.date.max)
      throw new M365AnalysisError("AI_SUMMARY_INVALID", 422, "date range");
    const restricted =
      column.roleHint === "identifier" || column.containsPersonalData;
    if (
      restricted &&
      (column.numeric ||
        column.date ||
        column.topShares ||
        column.distinct !== undefined ||
        column.duplicateValues !== undefined)
    )
      throw new M365AnalysisError("AI_SUMMARY_NOT_PRIVATE", 422, column.name);
  });
}

/** Masks personal-data shapes in every string with the shared PII shield; returns the count. */
export function shieldSummary(summary: SchemaSummary): {
  summary: SchemaSummary;
  maskedCount: number;
} {
  const map = new PiiMap();
  const shielded: SchemaSummary = {
    ...summary,
    columns: summary.columns.map((column) => ({
      ...column,
      name: map.mask(column.name),
    })),
  };
  return { summary: shielded, maskedCount: map.size };
}

export function summaryHash(summary: SchemaSummary): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(summary))
    .digest("hex");
}

const SYSTEM_PROMPT = [
  "You are a spreadsheet schema analyst.",
  "You receive ONLY a statistical summary of a worksheet: column names, inferred types, counts and bounds. You never see cell values.",
  "Reply with ONE JSON object and nothing else. No markdown, no code fences, no commentary.",
  "JSON shape: {summary: string, columns: [{index, name, inferredType, role, confidence, reason}], dataQuality: [{severity, columnIndex?, message, confidence}], recommendations: [{kind, title, columns: [index], chartType?, confidence, reason}]}.",
  "inferredType is one of number|integer|date|boolean|text|empty. role is one of identifier|measure|date|category|text|unknown.",
  "severity is info|warning|error. kind is chart|pivot-table|table|filter|grouping. chartType is column|line|bar|pie.",
  "confidence is a number from 0 to 1. Every item needs a short reason. Use only column indexes that exist.",
  "Never recommend using identifier or personal-data columns in a chart or pivot-table. A chart needs a measure column. A pivot-table needs a category or date column and a measure column.",
  "You may only recommend analysis. Never output formulas, macros, code, cell edits or instructions to delete or overwrite data.",
].join("\n");

export function buildAnalysisMessages(summary: SchemaSummary) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Worksheet summary:\n${JSON.stringify(summary)}`,
    },
  ];
}

/** Accepts a bare JSON object or one wrapped in a single code fence; nothing else. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!candidate.startsWith("{") || !candidate.endsWith("}"))
    throw new M365AnalysisError(
      "AI_ANALYSIS_INVALID",
      502,
      "not a JSON object",
    );
  try {
    return JSON.parse(candidate);
  } catch {
    throw new M365AnalysisError("AI_ANALYSIS_INVALID", 502, "unparseable JSON");
  }
}

/**
 * Validates the model output against the strict contract and the summary it was given. A shape
 * violation rejects the whole answer; a recommendation that would use an identifier column or
 * lacks the columns it needs is dropped instead of being offered to the user.
 */
export function parseAnalysisResponse(
  text: string,
  summary: SchemaSummary,
): { result: AnalysisResult; droppedRecommendations: number } {
  if (text.length > 30_000)
    throw new M365AnalysisError(
      "AI_ANALYSIS_INVALID",
      502,
      "response too large",
    );
  const parsed = analysisResultSchema.safeParse(extractJsonObject(text));
  if (!parsed.success)
    throw new M365AnalysisError("AI_ANALYSIS_INVALID", 502, "schema mismatch");
  const result = parsed.data;
  const count = summary.columnCount;
  const inRange = (index: number) => index >= 0 && index < count;
  if (
    result.columns.some((column) => !inRange(column.index)) ||
    result.dataQuality.some(
      (issue) => issue.columnIndex !== undefined && !inRange(issue.columnIndex),
    ) ||
    result.recommendations.some((rec) => rec.columns.some((i) => !inRange(i)))
  )
    throw new M365AnalysisError("AI_ANALYSIS_INVALID", 502, "unknown column");

  const column = (index: number) => summary.columns[index];
  const restricted = (index: number) =>
    column(index).roleHint === "identifier" ||
    column(index).containsPersonalData;
  const kept = result.recommendations.filter((rec) => {
    if (rec.kind === "chart" || rec.kind === "pivot-table") {
      if (rec.columns.length === 0 || rec.columns.some(restricted))
        return false;
      const hasMeasure = rec.columns.some(
        (i) => column(i).roleHint === "measure",
      );
      if (!hasMeasure) return false;
      if (
        rec.kind === "pivot-table" &&
        !rec.columns.some((i) =>
          ["category", "date"].includes(column(i).roleHint),
        )
      )
        return false;
    }
    return true;
  });
  // Names come from the local summary, never from the model, so a model cannot relabel a column.
  const columns = result.columns.map((entry) => ({
    ...entry,
    name: column(entry.index).name,
  }));
  return {
    result: { ...result, columns, recommendations: kept },
    droppedRecommendations: result.recommendations.length - kept.length,
  };
}

/** In-process stand-in for an HTTP response so the existing AI proxy can be reused unchanged. */
class InProcessResponse {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  body: unknown;
  chunks: string[] = [];
  private headers = new Map<string, string>();
  setHeader(name: string, value: unknown) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }
  write(chunk: unknown) {
    this.headersSent = true;
    this.chunks.push(String(chunk));
    return true;
  }
  end(chunk?: unknown) {
    if (chunk) this.chunks.push(String(chunk));
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  off() {
    return this;
  }
  flushHeaders() {}

  text(): string {
    const message = (this.body as any)?.choices?.[0]?.message?.content;
    if (typeof message === "string") return message;
    let out = "";
    for (const line of this.chunks.join("").split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        out +=
          chunk?.choices?.[0]?.delta?.content ??
          chunk?.choices?.[0]?.message?.content ??
          "";
      } catch {
        // Ignore a partial SSE line.
      }
    }
    return out;
  }
}

export interface AnalysisRunner {
  (
    user: AuthenticatedUser,
    messages: Array<{ role: string; content: string }>,
    estimatedCredits: number,
  ): Promise<string>;
}

/** Default runner: the existing proxy (routing, PII shield, credits, economics ledger). */
export const proxyAnalysisRunner: AnalysisRunner = async (
  user,
  messages,
  estimatedCredits,
) => {
  const reservation = await reserveQuotaAtomic(
    user.id,
    user.subscriptionPlan || "free",
    estimatedCredits,
  );
  if (!reservation) throw new M365AnalysisError("CREDITS_EXHAUSTED", 403);
  const response = new InProcessResponse();
  const proxied = new Proxy(response, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => proxied;
    },
  });
  try {
    await handleChatCompletions(
      user,
      {
        messages,
        stream: false,
        temperature: 0,
        max_tokens: 2000,
        cache_policy: "bypass",
      },
      proxied as unknown as Response,
      reservation,
    );
  } catch (error) {
    await releaseQuotaReservation(reservation).catch(() => undefined);
    throw new M365AnalysisError(
      "AI_PROVIDER_UNAVAILABLE",
      502,
      (error as Error).message?.slice(0, 80),
    );
  }
  if (response.statusCode >= 400) {
    const code = (response.body as any)?.error?.code;
    throw new M365AnalysisError(
      typeof code === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(code)
        ? code
        : "AI_PROVIDER_UNAVAILABLE",
      response.statusCode >= 500 ? 502 : response.statusCode,
    );
  }
  return response.text();
};

let runner: AnalysisRunner = proxyAnalysisRunner;
/** Test seam: the route tests use a deterministic runner; production always uses the proxy. */
export function setM365AnalysisRunnerForTests(next?: AnalysisRunner): void {
  runner = next ?? proxyAnalysisRunner;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const recent = new Map<string, number[]>();
export function assertAnalysisRateLimit(
  userId: string,
  now = Date.now(),
): void {
  const stamps = (recent.get(userId) ?? []).filter(
    (stamp) => now - stamp < WINDOW_MS,
  );
  if (stamps.length >= MAX_PER_WINDOW)
    throw new M365AnalysisError("AI_ANALYSIS_RATE_LIMITED", 429);
  stamps.push(now);
  recent.set(userId, stamps);
}
export function resetAnalysisRateLimitForTests(): void {
  recent.clear();
}

export async function analyzeSchemaSummary(
  user: AuthenticatedUser,
  rawSummary: unknown,
): Promise<{
  result: AnalysisResult;
  summaryHash: string;
  maskedCount: number;
  droppedRecommendations: number;
}> {
  const checked = schemaSummarySchema.safeParse(rawSummary);
  if (!checked.success) throw new M365AnalysisError("AI_SUMMARY_INVALID", 422);
  assertPrivateSummary(checked.data);
  const { summary, maskedCount } = shieldSummary(checked.data);
  assertAnalysisRateLimit(user.id);
  const messages = buildAnalysisMessages(summary);
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const text = await runner(user, messages, Math.ceil(chars / 4) + 2000);
  const { result, droppedRecommendations } = parseAnalysisResponse(
    text,
    summary,
  );
  return {
    result,
    summaryHash: summaryHash(checked.data),
    maskedCount,
    droppedRecommendations,
  };
}
