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

export const AGENT_TASK_SCHEMA_VERSION = 2 as const;
export type CompletionScope = "simple" | "medium" | "complex";
export type CriterionProvenance =
  | "user_explicit"
  | "inferred"
  | "repository_required";
export type CriterionStatus =
  | "pending"
  | "passed"
  | "failed"
  | "blocked"
  | "user_skipped"
  | "stale";

/** A bounded, redacted statement of one outcome the task must establish. */
export interface CompletionCriterion {
  id: string;
  statement: string;
  provenance: CriterionProvenance;
  required: boolean;
  evidencePolicy: string[];
  status: CriterionStatus;
  reason?: string;
  mutationGeneration?: number;
}

export interface CompletionContract {
  id: string;
  version: 1;
  taskId: string;
  goalVersion: number;
  workspaceId: string;
  scope: CompletionScope;
  confidence: number;
  criteria: CompletionCriterion[];
  createdAt: number;
  updatedAt: number;
}

/** Input accepted before TaskRuntime binds the contract to its task identity. */
export type CompletionContractInput = Omit<
  CompletionContract,
  "id" | "taskId" | "goalVersion" | "workspaceId" | "createdAt" | "updatedAt"
>;

export interface ChangedSurfaceSnapshot {
  generation: number;
  files: string[];
  digest: string;
  capturedAt: number;
}

export interface EvidenceReceipt {
  id: string;
  criterionId: string;
  kind: VerificationResult["kind"];
  status: Exclude<CriterionStatus, "pending" | "stale">;
  summary: string;
  mutationGeneration: number;
  createdAt: number;
  sourceDigest?: string;
}

export interface CriterionDecisionReceipt {
  id: string;
  criterionId: string;
  decision: "corrected" | "skipped";
  reason: string;
  createdAt: number;
}

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
  kind:
    | "test"
    | "typecheck"
    | "lint"
    | "build"
    | "review"
    | "inspection"
    | "response";
  status: "passed" | "failed" | "skipped";
  summary: string;
  /** Mutation generation at which this result was captured. */
  mutationGeneration?: number;
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

export type ImplementationSubagentRole =
  | "architect"
  | "frontend"
  | "backend"
  | "database"
  | "security"
  | "performance"
  | "devops"
  | "qa"
  | "verifier";

export interface SubagentAuthority {
  read: boolean;
  write: boolean;
  command: boolean;
  network: boolean;
}

export interface SubagentHandoff {
  summary: string;
  changedFiles: string[];
  verification: VerificationResult[];
  residualRisks: string[];
  completedAt: number;
}

export interface ImplementationSubagent {
  id: string;
  role: ImplementationSubagentRole;
  objectiveDigest: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  authority: SubagentAuthority;
  /** Canonical workspace-relative files or directory prefixes. */
  fileScope: string[];
  /** IDs of earlier subagents whose verified handoffs must complete first. */
  dependsOn: string[];
  /** Workspace snapshot revision used to reject stale execution. */
  baseWorkspaceRevision: number;
  budget: AgentTaskBudget;
  handoff?: SubagentHandoff;
  createdAt: number;
  updatedAt: number;
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
  /** Version 1 journals predate contracts and are upgraded on load. */
  schemaVersion?: typeof AGENT_TASK_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  workspaceId: string;
  workspaceRevision: number;
  /** Increments when a follow-up changes the intended outcome. */
  goalVersion?: number;
  state: TaskState;
  /** A digest is persisted instead of the raw user prompt. */
  goalDigest: string;
  approvals: ApprovalReceipt[];
  checkpoints: string[];
  verification: VerificationResult[];
  contract?: CompletionContract;
  evidence?: EvidenceReceipt[];
  criterionDecisions?: CriterionDecisionReceipt[];
  mutationGeneration?: number;
  changedSurface?: ChangedSurfaceSnapshot;
  plan?: AgentPlan;
  executionGuard: AgentExecutionGuard;
  budget: AgentTaskBudget;
  subagents?: ImplementationSubagent[];
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
