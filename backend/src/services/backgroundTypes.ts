export const BACKGROUND_POLICY_VERSION = "2026-10-05";

export type BackgroundTaskStatus =
  | "awaiting_upload"
  | "queued"
  | "running"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "canceled"
  | "purged";

export const TERMINAL_BACKGROUND_STATUSES: ReadonlySet<BackgroundTaskStatus> =
  new Set(["completed", "failed", "canceled", "purged"]);

export interface BackgroundEstimateInput {
  prompt: string;
  language: "si" | "en" | "other";
  projectFingerprint: string;
  manifestDigest: string;
  fileCount: number;
  uploadBytes: number;
  stacks: string[];
  requestedCapCredits?: number;
}

export interface BackgroundEstimateQuote {
  quoteId: string;
  userId: string;
  inputDigest: string;
  modelCredits: number;
  computeCredits: number;
  totalCredits: number;
  minimumCapCredits: number;
  suggestedCapCredits: number;
  maximumCapCredits: number;
  expiresAt: string;
}

export interface BackgroundProofPackV1 {
  version: 1;
  taskId: string;
  status: "completed" | "failed" | "canceled";
  language: "si" | "en" | "other";
  summary: string;
  diff: {
    filesChanged: number;
    additions: number;
    deletions: number;
    newFiles: string[];
    deletedFiles: string[];
  };
  verification: Array<{
    command: string;
    cwd: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    stdoutTail: string;
    stderrTail: string;
    classification: "passed" | "failed" | "baseline_failure" | "skipped";
  }>;
  judgmentReview: string;
  risks: Array<{
    category: "dependency" | "secret" | "debug" | "security" | "behavior";
    severity: "low" | "medium" | "high";
    summary: string;
    files: string[];
  }>;
  screenshots: Array<{
    id: string;
    title: string;
    localUrl: string;
    viewport: string;
  }>;
  unverified: string[];
  billing: {
    estimateCredits: number;
    capCredits: number;
    modelCredits: number;
    computeCredits: number;
    grossUsedCredits: number;
    refundCredits: number;
    netChargedCredits: number;
  };
  deletionReceipt: {
    workspaceDeletedAt: string;
    retainedUntil: string;
    artifactIds: string[];
  };
  startedAt: string;
  finishedAt: string;
}
