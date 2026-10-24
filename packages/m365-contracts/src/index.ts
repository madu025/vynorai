export const M365_CONTRACT_VERSION = "2026-10-14.excel.v1" as const;

export type ExcelCell = string | number | boolean | null;
export type ExcelRow = ExcelCell[];
export type ExcelActionKind =
  | "table"
  | "chart"
  | "new-sheet"
  | "named-range"
  | "slicer"
  | "pivot-table";

export interface ExcelRangeInput {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: ExcelRow[];
  hasHeaders?: boolean;
}

export interface ExcelRangeProfile {
  rowCount: number;
  columnCount: number;
  headerCount: number;
  blankCells: number;
  duplicateHeaderNames: string[];
  chunkCount: number;
  sourceFingerprint: string;
}

export interface ExcelAction {
  kind: ExcelActionKind;
  name: string;
  targetSheet: string;
  preservesSource: true;
  description: string;
}

export interface ExcelActionPlan {
  contractVersion: typeof M365_CONTRACT_VERSION;
  planId: string;
  workbookId: string;
  worksheetName: string;
  sourceAddress: string;
  sourceFingerprint: string;
  profile: ExcelRangeProfile;
  chunks: Array<{ index: number; startRow: number; rowCount: number }>;
  actions: ExcelAction[];
  warnings: string[];
  requiresConfirmation: true;
  approvalToken?: string;
  expiresAt?: string;
}

export const M365_ANALYSIS_CONTRACT_VERSION =
  "2026-10-15.excel-analysis.v1" as const;

/** Versioned contract for deterministic and consent-gated analyst reports. */
export const M365_ADVANCED_ANALYSIS_CONTRACT_VERSION =
  "2026-10-19.excel-advanced-analysis.v1" as const;

export type AnalysisFeature =
  | "forecast"
  | "cohort"
  | "sensitivity"
  | "financial"
  | "fuzzy-match"
  | "split"
  | "anomaly"
  | "fraud-risk"
  | "root-cause"
  | "dashboard"
  | "slicer"
  | "sentiment"
  | "keywords"
  | "classification"
  | "clustering"
  | "similarity";

export type CapabilityStatus =
  | "available"
  | "available_with_fallback"
  | "unsupported"
  | "consent_required";

export interface AnalysisEvidence {
  source: "excel_formula" | "deterministic_local" | "masked_ai" | "model";
  rows?: number;
  cells?: number;
  formula?: string;
  note?: string;
}

export interface VerificationResult {
  status: "verified" | "partial" | "failed" | "not_run";
  errors: string[];
  warnings: string[];
  affectedRows: number;
  affectedCells: number;
}

export interface AdvancedAnalysisRequest {
  contractVersion: typeof M365_ADVANCED_ANALYSIS_CONTRACT_VERSION;
  feature: AnalysisFeature;
  consent: true;
  language: "en" | "si" | "ta";
  workbookId?: string;
  worksheetName: string;
  sourceAddress: string;
  sourceFingerprint?: string;
  columns?: number[];
  options?: Record<string, string | number | boolean | number[]>;
}

export interface AdvancedAnalysisPlan {
  contractVersion: typeof M365_ADVANCED_ANALYSIS_CONTRACT_VERSION;
  planId: string;
  feature: AnalysisFeature;
  status: CapabilityStatus;
  title: string;
  warnings: string[];
  evidence: AnalysisEvidence[];
  stagedChanges: Array<{
    kind: string;
    targetSheet: string;
    description: string;
  }>;
  requiresConfirmation: true;
}

export interface AdvancedAnalysisResult {
  contractVersion: typeof M365_ADVANCED_ANALYSIS_CONTRACT_VERSION;
  feature: AnalysisFeature;
  status: "completed" | "partial" | "unsupported" | "failed";
  evidence: AnalysisEvidence[];
  warnings: string[];
  verification: VerificationResult;
  errorCode?:
    | "UNSUPPORTED_CAPABILITY"
    | "AI_CONSENT_REQUIRED"
    | "SOURCE_CHANGED";
}

export type AnalysisRecommendationKind =
  | "chart"
  | "pivot-table"
  | "table"
  | "filter"
  | "grouping";

/** Advisory only: a recommendation never carries a workbook operation. */
export interface AnalysisRecommendation {
  kind: AnalysisRecommendationKind;
  title: string;
  columns: number[];
  chartType?: "column" | "line" | "bar" | "pie";
  confidence: number;
  reason: string;
}

export * from "./companion.js";
