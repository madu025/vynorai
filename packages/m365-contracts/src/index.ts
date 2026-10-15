export const M365_CONTRACT_VERSION = "2026-10-14.excel.v1" as const;

export type ExcelCell = string | number | boolean | null;
export type ExcelRow = ExcelCell[];
export type ExcelActionKind =
  | "table"
  | "chart"
  | "new-sheet"
  | "named-range"
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
