/**
 * VynorAI Proactive Self-Driving Maintenance Swarm — Type Definitions
 *
 * Defines models for autonomous issue triage, worktree isolation,
 * reproduction testing, PR generation, and developer morning briefings.
 */

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
}
