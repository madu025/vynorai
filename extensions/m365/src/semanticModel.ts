/**
 * A deterministic, on-device semantic model used as the safe alternative to Excel's
 * Power Pivot/Data Model/OLAP surfaces.  It is deliberately a metadata and evidence
 * model: it never claims to create a native workbook Data Model and it never writes
 * workbook cells.  A later staged formula, PivotTable or report can use the model's
 * reported relationships and measures.
 */
import {
  mapRelationships,
  type KeyCell,
  type RelationTable,
} from "./relationships.js";

export const SEMANTIC_MODEL_MAX_TABLES = 10;
export const SEMANTIC_MODEL_MAX_ROWS = 20_000;
export const SEMANTIC_MODEL_MAX_COLUMNS = 50;
export const SEMANTIC_MODEL_CONTRACT_VERSION =
  "2026-10-25.excel-semantic-model.v1" as const;

export type SemanticColumnRole =
  | "key"
  | "dimension"
  | "measure"
  | "date"
  | "text";

export interface SemanticColumn {
  name: string;
  role: SemanticColumnRole;
  nonBlank: number;
  distinct: number;
  sampleType: "number" | "date" | "text" | "empty";
  measures?: ("sum" | "average" | "min" | "max")[];
}

export interface SemanticTable {
  label: string;
  rows: number;
  columns: SemanticColumn[];
}

export interface SemanticModelInput {
  label: string;
  headers: string[];
  rows: KeyCell[][];
}

export interface SemanticModel {
  contractVersion: typeof SEMANTIC_MODEL_CONTRACT_VERSION;
  modelType: "vynorai-semantic-model";
  nativeFeature: "power-pivot-data-model-olap";
  implementation: "deterministic-local-metadata";
  tables: SemanticTable[];
  relationships: ReturnType<typeof mapRelationships>["links"];
  warnings: string[];
  limitations: string[];
  evidence: {
    tables: number;
    sampledRows: number;
    columns: number;
    relationshipCandidates: number;
  };
}

const valueText = (value: KeyCell): string =>
  value === null || value === undefined ? "" : String(value).trim();

const isBlank = (value: KeyCell): boolean => valueText(value) === "";

const dateLike = (value: KeyCell): boolean => {
  if (typeof value === "number") return false;
  const text = valueText(value);
  if (!text || !/[\d]/.test(text)) return false;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && /[-/]/.test(text);
};

const normalHeader = (header: string): string => header.trim().toLowerCase();

function duplicateCount(values: KeyCell[]): number {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    const key = valueText(value);
    if (!key) continue;
    if (seen.has(key)) duplicate.add(key);
    seen.add(key);
  }
  return duplicate.size;
}

function classifyColumn(name: string, values: KeyCell[]): SemanticColumn {
  const present = values.filter((value) => !isBlank(value));
  const numeric = present.filter((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    const text = valueText(value).replace(/,/g, "");
    return (
      text !== "" &&
      Number.isFinite(Number(text)) &&
      /^[-+]?\d*\.?\d+$/.test(text)
    );
  });
  const dates = present.filter(dateLike);
  const numberRatio = present.length ? numeric.length / present.length : 0;
  const dateRatio = present.length ? dates.length / present.length : 0;
  const normalized = normalHeader(name);
  const highlyUnique =
    present.length > 0 &&
    new Set(present.map(valueText)).size / present.length > 0.95;
  const looksLikeKey =
    /(^|[ _-])(id|code|key|number|no|order|customer|account|sku)(s)?($|[ _-])/i.test(
      name,
    ) ||
    (numberRatio < 0.8 && highlyUnique);
  let role: SemanticColumnRole = "text";
  let sampleType: SemanticColumn["sampleType"] = "text";
  if (!present.length) {
    role = "text";
    sampleType = "empty";
  } else if (
    dateRatio >= 0.8 ||
    /(^|[ _-])date($|[ _-])|time|month|year/i.test(name)
  ) {
    role = "date";
    sampleType = "date";
  } else if (numberRatio >= 0.8 && !looksLikeKey) {
    role = "measure";
    sampleType = "number";
  } else if (looksLikeKey) {
    role = "key";
    sampleType = numberRatio >= 0.8 ? "number" : "text";
  } else if (numberRatio >= 0.8) {
    role = "dimension";
    sampleType = "number";
  } else {
    role = normalized.length ? "dimension" : "text";
  }
  const column: SemanticColumn = {
    name,
    role,
    nonBlank: present.length,
    distinct: new Set(present.map(valueText)).size,
    sampleType,
  };
  if (role === "measure") column.measures = ["sum", "average", "min", "max"];
  return column;
}

function tableModel(table: SemanticModelInput): SemanticTable {
  const headers = table.headers.slice(0, SEMANTIC_MODEL_MAX_COLUMNS);
  const rows = table.rows.slice(0, SEMANTIC_MODEL_MAX_ROWS);
  return {
    label: table.label,
    rows: rows.length,
    columns: headers.map((name, index) =>
      classifyColumn(
        String(name ?? ""),
        rows.map((row) => row[index]),
      ),
    ),
  };
}

/**
 * Builds the model from the same bounded rows already used by map_relationships.
 * The input is assumed to have been read from Excel with headers separated from rows.
 */
export function buildSemanticModel(
  inputs: SemanticModelInput[],
): SemanticModel {
  if (inputs.length < 2)
    throw new Error("A semantic model needs at least two tables or ranges.");
  if (inputs.length > SEMANTIC_MODEL_MAX_TABLES)
    throw new Error(
      `A semantic model supports at most ${SEMANTIC_MODEL_MAX_TABLES} tables.`,
    );
  const tables = inputs.map((input) => ({
    ...input,
    headers: input.headers.slice(0, SEMANTIC_MODEL_MAX_COLUMNS),
    rows: input.rows.slice(0, SEMANTIC_MODEL_MAX_ROWS),
  }));
  const relationTables: RelationTable[] = tables.map((table) => ({
    label: table.label,
    headers: table.headers,
    rows: table.rows,
  }));
  const relationships = mapRelationships(relationTables);
  const warnings: string[] = [];
  for (const table of tables) {
    if (table.rows.length === SEMANTIC_MODEL_MAX_ROWS)
      warnings.push(
        `${table.label} was bounded to ${SEMANTIC_MODEL_MAX_ROWS.toLocaleString("en-US")} rows for local profiling.`,
      );
    if (table.headers.length === SEMANTIC_MODEL_MAX_COLUMNS)
      warnings.push(
        `${table.label} was bounded to ${SEMANTIC_MODEL_MAX_COLUMNS} columns for local profiling.`,
      );
    if (table.headers.some((header) => !String(header).trim()))
      warnings.push(
        `${table.label} contains a blank header; that column is not a reliable semantic field.`,
      );
    if (table.headers.length !== new Set(table.headers.map(normalHeader)).size)
      warnings.push(
        `${table.label} contains duplicate header names; measures must use the exact column context.`,
      );
  }
  if (!relationships.links.length)
    warnings.push(
      "No relationship was inferred. A cross-table calculation must ask for an explicit key; this model does not guess one.",
    );
  return {
    contractVersion: SEMANTIC_MODEL_CONTRACT_VERSION,
    modelType: "vynorai-semantic-model",
    nativeFeature: "power-pivot-data-model-olap",
    implementation: "deterministic-local-metadata",
    tables: tables.map(tableModel),
    relationships: relationships.links,
    warnings,
    limitations: [
      "This is not a native Power Pivot/Data Model/OLAP connection and does not create a cube or DAX measure.",
      "Rows are profiled on the device within the stated bounds; large-range totals still use Excel formulas or PivotTables.",
      "Relationships are evidence for safe formulas/reports; many-to-many links are not used for automatic joins.",
    ],
    evidence: {
      tables: tables.length,
      sampledRows: tables.reduce((sum, table) => sum + table.rows.length, 0),
      columns: tables.reduce((sum, table) => sum + table.headers.length, 0),
      relationshipCandidates: relationships.links.length,
    },
  };
}
