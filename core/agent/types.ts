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

export type AgentPlanStepState =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "verifying"
  | "succeeded"
  | "failed"
  | "blocked"
  | "canceled";

export type AgentPlanStepKind =
  | "inspect"
  | "act"
  | "edit"
  | "command"
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "review";

export interface AgentPlanStep {
  id: string;
  /** A short, redacted label. Tool arguments and source code are never stored. */
  summary: string;
  kind: AgentPlanStepKind;
  risk: ToolRisk;
  dependsOn: string[];
  state: AgentPlanStepState;
  attempts: number;
  maxAttempts: number;
  verificationRequired: boolean;
  scopeDigest?: string;
  failureCode?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPlan {
  version: 1;
  steps: AgentPlanStep[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentExecutionGuard {
  autonomousSteps: number;
  maxAutonomousSteps: number;
  repeatedActionLimit: number;
  actionDigests: Record<string, number>;
  cancelRequested: boolean;
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
  plan?: AgentPlan;
  executionGuard: AgentExecutionGuard;
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
