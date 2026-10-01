export type TaskState =
  | "queued"
  | "gathering"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "canceled";

export type ToolRisk = "R0" | "R1" | "R2" | "R3";

export interface ApprovalReceipt {
  id: string;
  toolCallId: string;
  toolName: string;
  risk: ToolRisk;
  decision: "approved" | "denied";
  approvedAt: number;
  scopeDigest: string;
}

export interface VerificationResult {
  id: string;
  kind: "test" | "typecheck" | "lint" | "build" | "review" | "response";
  status: "passed" | "failed" | "skipped";
  summary: string;
  createdAt: number;
}

export interface AgentTaskBudget {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  workspaceId: string;
  workspaceRevision: number;
  state: TaskState;
  /** A digest is persisted instead of the raw user prompt. */
  goalDigest: string;
  approvals: ApprovalReceipt[];
  checkpoints: string[];
  verification: VerificationResult[];
  budget: AgentTaskBudget;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTaskEvent {
  sequence: number;
  taskId: string;
  type: string;
  createdAt: number;
  data: Record<string, unknown>;
}
