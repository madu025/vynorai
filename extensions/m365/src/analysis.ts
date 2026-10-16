import { getExcelHeaderLayout, assertValidExcelTabularRange } from "./excel.js";

export const ANALYSIS_CONTRACT_VERSION =
  "2026-10-15.excel-analysis.v1" as const;

type Cell = string | number | boolean | null;
interface RangeInput {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: Cell[][];
  hasHeaders?: boolean;
}

export type InferredType =
  | "number"
  | "integer"
  | "date"
  | "boolean"
  | "text"
  | "empty";
export type RoleHint =
  | "identifier"
  | "measure"
  | "date"
  | "category"
  | "text"
  | "unknown";

/**
 * One column of the privacy-preserving summary. It never holds a cell value of a text,
 * identifier or personal-data column: only counts, shares and number/date bounds.
 */
export interface SchemaColumnSummary {
  index: number;
  name: string;
  inferredType: InferredType;
  roleHint: RoleHint;
  nonBlank: number;
  blank: number;
  distinct?: number;
  duplicateValues?: number;
  containsPersonalData: boolean;
  numeric?: { min: number; max: number };
  date?: { min: string; max: string };
  topShares?: number[];
}

export interface SchemaSummary {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION;
  rowCount: number;
  columnCount: number;
  headerRowCount: 1 | 2;
  blankCells: number;
  columns: SchemaColumnSummary[];
}

export type RecommendationKind =
  | "chart"
  | "pivot-table"
  | "table"
  | "filter"
  | "grouping";

export interface AnalysisRecommendation {
  kind: RecommendationKind;
  title: string;
  columns: number[];
  chartType?: "column" | "line" | "bar" | "pie";
  confidence: number;
  reason: string;
}

export interface AnalysisResult {
  summary: string;
  columns: Array<{
    index: number;
    name: string;
    inferredType: InferredType;
    role: RoleHint;
    confidence: number;
    reason: string;
  }>;
  dataQuality: Array<{
    severity: "info" | "warning" | "error";
    columnIndex?: number;
    message: string;
    confidence: number;
  }>;
  recommendations: AnalysisRecommendation[];
}

export class AnalysisConsentError extends Error {
  readonly code = "AI_CONSENT_REQUIRED";
  constructor() {
    super("AI_CONSENT_REQUIRED");
    this.name = "AnalysisConsentError";
  }
}

const MAX_COLUMNS = 100;
const MAX_NAME = 60;
const MAX_CATEGORY_DISTINCT = 20;
const PERSONAL_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\+\d[\d\s-]{8,14}\d/,
  /\b0\d{9}\b/,
  /\b\d{3}[\s-]\d{3}[\s-]?\d{4}\b/,
  /\b\d{9}[VvXx]\b/,
  /\b\d{12}\b/,
  /\b(?:\d[ -]?){13,19}\b/,
];
const IDENTIFIER_HEADER =
  /(^|[^a-z])(id|uuid|guid|code|ref|reference|number|no|nic|passport|email|e-mail|phone|mobile|tel|name|address|account|iban|ssn|tin)([^a-z]|$)/i;
const DATE_HEADER = /(date|time|day|month|year|period|when)/i;
const DATE_STRING =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$|^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

const MONTH_LABEL =
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i;
const WEEKDAY_LABEL =
  /^(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)$/i;
const PERIOD_LABEL =
  /^(q[1-4]|[1-4]q|h[12]|fy\s?\d{2,4}|(19|20)\d{2}(\s?-?\s?q[1-4])?)$/i;

/** Month, weekday, quarter and fiscal-period labels are time axes, never identifiers. */
export function isTemporalLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return (
    MONTH_LABEL.test(text) ||
    WEEKDAY_LABEL.test(text) ||
    PERIOD_LABEL.test(text)
  );
}

/** Replaces text shaped like personal data so it can never reach a prompt. */
export function redactPersonalData(text: string): string {
  let out = String(text);
  for (const pattern of PERSONAL_PATTERNS)
    out = out.replace(new RegExp(pattern.source, "g"), "[personal-data]");
  return out;
}

function looksPersonal(value: Cell): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value);
  return PERSONAL_PATTERNS.some((pattern) => pattern.test(text));
}

function toIsoDate(
  value: Cell,
  headerSuggestsDate: boolean,
): string | undefined {
  if (typeof value === "number") {
    if (!headerSuggestsDate || !Number.isInteger(value)) return undefined;
    if (value < 20000 || value > 80000) return undefined;
    return new Date((value - 25569) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return undefined;
  const match = DATE_STRING.exec(value.trim());
  if (!match) return undefined;
  let year: number;
  let month: number;
  let day: number;
  if (match[1]) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    // d/m/y: the common convention for the product's markets; ambiguity only affects bounds.
    day = Number(match[4]);
    month = Number(match[5]);
    year = Number(match[6]);
    if (year < 100) year += 2000;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sanitizeHeader(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  const redacted = redactPersonalData(trimmed);
  return redacted || "(unnamed)";
}

/**
 * Deterministic, local source of truth for what the AI is allowed to see. Handles one-row and
 * two-row merged headers through the same layout code the preview plan uses.
 */
export function buildSchemaSummary(input: RangeInput): SchemaSummary {
  assertValidExcelTabularRange(input);
  const layout = getExcelHeaderLayout(input);
  if (layout.headerRowCount === 0)
    throw new Error("A header row is required for AI analysis.");
  const rows = input.values.slice(layout.headerRowCount);
  const columnCount = layout.headers.length;
  if (columnCount > MAX_COLUMNS)
    throw new Error(`Select at most ${MAX_COLUMNS} columns for AI analysis.`);

  let blankCells = 0;
  const columns: SchemaColumnSummary[] = layout.headers.map((header, index) => {
    const name = sanitizeHeader(header);
    const cells = rows.map((row) => row[index] ?? null);
    const present = cells.filter(
      (cell) => cell !== null && String(cell).trim() !== "",
    ) as Cell[];
    const blank = cells.length - present.length;
    blankCells += blank;
    const headerPersonal =
      name !== header.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    const containsPersonalData = headerPersonal || present.some(looksPersonal);
    const headerIdentifier = IDENTIFIER_HEADER.test(header);
    const headerSuggestsDate = DATE_HEADER.test(header);

    if (present.length === 0)
      return {
        index,
        name,
        inferredType: "empty",
        roleHint: "unknown",
        nonBlank: 0,
        blank,
        containsPersonalData,
      };

    const allBoolean = present.every((cell) => typeof cell === "boolean");
    const allNumber = present.every(
      (cell) => typeof cell === "number" && Number.isFinite(cell),
    );
    const dates = present.map((cell) => toIsoDate(cell, headerSuggestsDate));
    const allDates = dates.every((date) => date !== undefined);
    let inferredType: InferredType = "text";
    if (allBoolean) inferredType = "boolean";
    else if (allDates) inferredType = "date";
    else if (allNumber)
      inferredType = present.every((cell) => Number.isInteger(cell))
        ? "integer"
        : "number";

    const counts = new Map<string, number>();
    for (const cell of present) {
      const key = String(cell).trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const distinct = counts.size;
    const uniqueShare = distinct / present.length;
    const temporalLabels = present.every(isTemporalLabel);
    const yearColumn =
      /\byear\b/i.test(header) &&
      present.every(
        (cell) =>
          typeof cell === "number" &&
          Number.isInteger(cell) &&
          cell >= 1900 &&
          cell <= 2100,
      );
    const identifierByShape =
      inferredType === "text" &&
      present.length >= 5 &&
      uniqueShare > 0.9 &&
      !temporalLabels;
    const identifier =
      (headerIdentifier || identifierByShape) && !temporalLabels && !yearColumn;

    let roleHint: RoleHint = "unknown";
    if (identifier || containsPersonalData) roleHint = "identifier";
    else if (inferredType === "date" || temporalLabels || yearColumn)
      roleHint = "date";
    else if (inferredType === "number" || inferredType === "integer")
      roleHint = "measure";
    else if (
      (inferredType === "text" || inferredType === "boolean") &&
      distinct <= MAX_CATEGORY_DISTINCT &&
      (present.length < 5 || uniqueShare <= 0.5)
    )
      roleHint = "category";
    else if (inferredType === "text") roleHint = "text";

    const summary: SchemaColumnSummary = {
      index,
      name,
      inferredType,
      roleHint,
      nonBlank: present.length,
      blank,
      containsPersonalData,
    };
    // Personal-data and identifier columns expose counts only, never value statistics.
    if (roleHint === "identifier") return summary;
    summary.distinct = distinct;
    summary.duplicateValues = present.length - distinct;
    if (inferredType === "number" || inferredType === "integer") {
      const numbers = present as number[];
      summary.numeric = {
        min: Math.min(...numbers),
        max: Math.max(...numbers),
      };
    } else if (inferredType === "date") {
      const sorted = (dates as string[]).slice().sort();
      summary.date = { min: sorted[0], max: sorted[sorted.length - 1] };
    } else if (roleHint === "category") {
      summary.topShares = [...counts.values()]
        .sort((a, b) => b - a)
        .slice(0, 5)
        .map((count) => Math.round((count / present.length) * 1000) / 1000);
    }
    return summary;
  });

  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    rowCount: Math.max(
      rows.length,
      Math.min(
        1_000_000,
        ((input as { sample?: { totalRows: number } }).sample?.totalRows ?? 0) -
          layout.headerRowCount,
      ),
    ),
    columnCount,
    headerRowCount: layout.headerRowCount as 1 | 2,
    blankCells,
    columns,
  };
}

/** The only way to build an analysis request: explicit consent is a precondition. */
export function createAnalysisRequest(
  summary: SchemaSummary,
  consent: boolean,
  language: "en" | "si" | "ta" = "en",
  request = "",
): {
  summary: SchemaSummary;
  language: "en" | "si" | "ta";
  request?: string;
  consent: true;
} {
  if (consent !== true) throw new AnalysisConsentError();
  const wanted = request.replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    summary,
    language,
    ...(wanted ? { request: wanted } : {}),
    consent: true,
  };
}

const ROLES: RoleHint[] = [
  "identifier",
  "measure",
  "date",
  "category",
  "text",
  "unknown",
];
const TYPES: InferredType[] = [
  "number",
  "integer",
  "date",
  "boolean",
  "text",
  "empty",
];
const KINDS: RecommendationKind[] = [
  "chart",
  "pivot-table",
  "table",
  "filter",
  "grouping",
];

class InvalidAnalysisError extends Error {
  readonly code = "AI_ANALYSIS_INVALID";
  constructor(detail: string) {
    super(`AI_ANALYSIS_INVALID: ${detail}`);
  }
}

function fail(detail: string): never {
  throw new InvalidAnalysisError(detail);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function onlyKeys(
  value: Record<string, unknown>,
  keys: string[],
  where: string,
) {
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${where} has unexpected key ${key}`);
}
function text(value: unknown, max: number, where: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    fail(`${where} must be a string up to ${max} characters`);
  return value as string;
}
function unit(value: unknown, where: string): number {
  if (typeof value !== "number" || !(value >= 0 && value <= 1))
    fail(`${where} must be a number between 0 and 1`);
  return value as number;
}
function columnIndex(
  value: unknown,
  columnCount: number,
  where: string,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= columnCount
  )
    fail(`${where} is not a selected column`);
  return value as number;
}

/**
 * Strict client-side check of the server response. Anything that does not match is rejected, so
 * a malformed or manipulated answer can only produce an error message, never a workbook action.
 */
export function validateAnalysisResult(
  value: unknown,
  columnCount: number,
): AnalysisResult {
  if (!isObject(value)) fail("response is not an object");
  const root = value as Record<string, unknown>;
  onlyKeys(
    root,
    ["summary", "columns", "dataQuality", "recommendations"],
    "response",
  );
  const summary = text(root.summary, 600, "summary");
  if (!Array.isArray(root.columns) || root.columns.length > MAX_COLUMNS)
    fail("columns must be an array");
  const columns = (root.columns as unknown[]).map((entry, position) => {
    if (!isObject(entry)) fail(`columns[${position}] is not an object`);
    const column = entry as Record<string, unknown>;
    onlyKeys(
      column,
      ["index", "name", "inferredType", "role", "confidence", "reason"],
      `columns[${position}]`,
    );
    if (!TYPES.includes(column.inferredType as InferredType))
      fail(`columns[${position}].inferredType is not allowed`);
    if (!ROLES.includes(column.role as RoleHint))
      fail(`columns[${position}].role is not allowed`);
    return {
      index: columnIndex(
        column.index,
        columnCount,
        `columns[${position}].index`,
      ),
      name: text(column.name, MAX_NAME, `columns[${position}].name`),
      inferredType: column.inferredType as InferredType,
      role: column.role as RoleHint,
      confidence: unit(column.confidence, `columns[${position}].confidence`),
      reason: text(column.reason, 240, `columns[${position}].reason`),
    };
  });
  if (!Array.isArray(root.dataQuality) || root.dataQuality.length > 30)
    fail("dataQuality must be an array");
  const dataQuality = (root.dataQuality as unknown[]).map((entry, position) => {
    if (!isObject(entry)) fail(`dataQuality[${position}] is not an object`);
    const issue = entry as Record<string, unknown>;
    onlyKeys(
      issue,
      ["severity", "columnIndex", "message", "confidence"],
      `dataQuality[${position}]`,
    );
    if (!["info", "warning", "error"].includes(issue.severity as string))
      fail(`dataQuality[${position}].severity is not allowed`);
    return {
      severity: issue.severity as "info" | "warning" | "error",
      ...(issue.columnIndex === undefined
        ? {}
        : {
            columnIndex: columnIndex(
              issue.columnIndex,
              columnCount,
              `dataQuality[${position}].columnIndex`,
            ),
          }),
      message: text(issue.message, 240, `dataQuality[${position}].message`),
      confidence: unit(issue.confidence, `dataQuality[${position}].confidence`),
    };
  });
  if (!Array.isArray(root.recommendations) || root.recommendations.length > 12)
    fail("recommendations must be an array");
  const recommendations = (root.recommendations as unknown[]).map(
    (entry, position) => {
      if (!isObject(entry))
        fail(`recommendations[${position}] is not an object`);
      const rec = entry as Record<string, unknown>;
      onlyKeys(
        rec,
        ["kind", "title", "columns", "chartType", "confidence", "reason"],
        `recommendations[${position}]`,
      );
      if (!KINDS.includes(rec.kind as RecommendationKind))
        fail(`recommendations[${position}].kind is not allowed`);
      if (!Array.isArray(rec.columns) || rec.columns.length > 6)
        fail(`recommendations[${position}].columns must be an array`);
      if (
        rec.chartType !== undefined &&
        !["column", "line", "bar", "pie"].includes(rec.chartType as string)
      )
        fail(`recommendations[${position}].chartType is not allowed`);
      return {
        kind: rec.kind as RecommendationKind,
        title: text(rec.title, 120, `recommendations[${position}].title`),
        columns: (rec.columns as unknown[]).map((index) =>
          columnIndex(
            index,
            columnCount,
            `recommendations[${position}].columns`,
          ),
        ),
        ...(rec.chartType === undefined
          ? {}
          : {
              chartType: rec.chartType as AnalysisRecommendation["chartType"],
            }),
        confidence: unit(
          rec.confidence,
          `recommendations[${position}].confidence`,
        ),
        reason: text(rec.reason, 240, `recommendations[${position}].reason`),
      };
    },
  );
  return { summary, columns, dataQuality, recommendations };
}

/**
 * Turns a recommendation into the instruction the existing preview flow understands. Filters and
 * groupings are advice only: they have no workbook action, so they return undefined.
 */
export function recommendationToInstruction(
  recommendation: AnalysisRecommendation,
): string | undefined {
  switch (recommendation.kind) {
    case "chart":
      return "Create a chart.";
    case "pivot-table":
      return "Create a PivotTable.";
    case "table":
      return "Format as a table.";
    default:
      return undefined;
  }
}

/**
 * Maps a recommendation to explicit column choices using the roles the local summary assigned.
 * Returns undefined when the roles do not give a clear category and measure, so the existing
 * whole-range preview is used instead of guessing.
 */
export function recommendationToSpecs(
  recommendation: AnalysisRecommendation,
  summary: SchemaSummary,
):
  | {
      chart?: {
        category: number;
        value: number;
        chartType: "column" | "line" | "bar" | "pie";
      };
      pivot?: { rows: number; values: number };
    }
  | undefined {
  const role = (index: number) => summary.columns[index]?.roleHint;
  const axis = recommendation.columns.find((index) =>
    ["category", "date"].includes(role(index) as string),
  );
  const value = recommendation.columns.find(
    (index) => role(index) === "measure",
  );
  if (axis === undefined || value === undefined) return undefined;
  if (recommendation.kind === "chart")
    return {
      chart: {
        category: axis,
        value,
        chartType: recommendation.chartType ?? "column",
      },
    };
  if (recommendation.kind === "pivot-table")
    return { pivot: { rows: axis, values: value } };
  return undefined;
}
