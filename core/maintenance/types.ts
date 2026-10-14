/**
 * VynorAI Proactive Self-Driving Maintenance Swarm — Type Definitions
 *
 * Defines models for autonomous issue triage, worktree isolation,
 * reproduction testing, PR generation, and developer morning briefings.
 */

import type {
  CloudDeliveryManifest,
  CloudDeliveryState,
} from "./cloudDeliveryPolicy.js";
import type {
  CloudArtifactProvenance,
  CanaryObservation,
  CanaryPolicy,
  CloudDeploymentExecutor,
} from "./cloudDeploymentExecutor.js";

export type IssueSourceType =
  | "github_issue"
  | "sentry_crash"
  | "security_audit"
  | "local_test_regression"
  | "blueprint_stage";

export interface BlueprintStage {
  stageNumber: number;
  stageName: string;
  description: string;
  scaffoldIds: string[];
}

export interface ProjectBlueprint {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  stages: BlueprintStage[];
}

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export interface MaintenanceIssue {
  id: string;
  source: IssueSourceType;
  title: string;
  description: string;
  labels: string[];
  severity: IssueSeverity;
  stackTrace?: string;
  targetFiles?: string[];
  cveId?: string;
  reproductionHint?: string;
}

export interface ReproductionTestSpec {
  testFilePath: string;
  testCode: string;
  expectedFailurePattern?: string;
}

export type MaintenanceTaskStatus =
  | "pending"
  | "isolated"
  | "reproduction_created"
  | "reproduction_verified_red"
  | "patch_applied"
  | "verification_verified_green"
  | "pr_created"
  | "dry_run"
  | "reproduction_failed"
  | "fix_failed"
  | "verification_failed";

export interface MaintenanceTaskResult {
  issue: MaintenanceIssue;
  status: MaintenanceTaskStatus;
  branchName: string;
  worktreePath?: string;
  prNumber?: number;
  prUrl?: string;
  prTitle?: string;
  prBody?: string;
  reproductionTestPath?: string;
  diffSummary?: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  verificationEvidence?: string;
  durationMs: number;
  error?: string;
  cloudDeliveryState?: CloudDeliveryState;
}

export interface MorningBriefingReport {
  generatedAt: string;
  totalIssuesScanned: number;
  tasksAttempted: number;
  prsCreated: MaintenanceTaskResult[];
  skippedIssues: Array<{
    issue: MaintenanceIssue;
    reason: string;
  }>;
  markdownBriefing: string;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface CloudDeliveryApproval {
  actor: string;
  scope: string;
  approvedAt: string;
  receiptDigest: string;
}

export interface CloudDeliveryControlClient {
  createManifest(manifest: CloudDeliveryManifest): Promise<void>;
  approve(runId: string, approval: CloudDeliveryApproval): Promise<void>;
  transition(
    runId: string,
    state: CloudDeliveryState,
    evidence?: {
      artifactDigest?: string;
      artifactAttestationDigest?: string;
      artifactSignature?: string;
      artifactKeyId?: string;
      deploymentTarget?: string;
      healthDigest?: string;
      ready?: boolean;
      smokePassed?: boolean;
      logErrorsFree?: boolean;
    },
  ): Promise<void>;
}

export interface GitHubPullRequestResult {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prBody: string;
  headBranch: string;
  baseBranch: string;
  isDraft?: boolean;
}

export interface MaintenanceSwarmConfig {
  maxConcurrentTasks: number;
  maxTasksPerRun: number;
  autoPrCreation: boolean;
  baseBranch: string;
  branchPrefix: string;
  worktreeDir: string;
  briefingOutputDir: string;
  dryRun?: boolean;
  githubToken?: string;
  githubRepo?: GitHubRepoRef;
  pushToRemote?: boolean;
  /** Cloud delivery is PR-only by default; deploy modes require later gates. */
  deliveryMode?:
    | "pr_only"
    | "staging_auto_deploy"
    | "production_canary"
    | "production_auto_deploy";
  /** Required for any non-dry cloud push/PR action. */
  deliveryApproval?: CloudDeliveryApproval;
  /** Digest of a real, current verification receipt; never inferred from model text. */
  verificationDigest?: string;
  capabilityDigest?: string;
  /** Server-owned manifest API; required for any non-dry cloud PR run. */
  deliveryControl?: CloudDeliveryControlClient;
  /** Explicit provider executor; non-PR modes fail closed without it. */
  deliveryExecutor?: CloudDeploymentExecutor;
  deploymentTarget?: string;
  deliveryArtifactProvenance?: CloudArtifactProvenance;
  canaryObservation?: CanaryObservation;
  canaryPolicy?: CanaryPolicy;
}
