export const DEVELOPMENT_SUPERVISOR_VERSION =
  "2026-10-25.development-supervisor.v1";

export const DEVELOPMENT_STAGES = [
  "research",
  "plan",
  "implement",
  "verify",
  "review",
] as const;

export type DevelopmentStage = (typeof DEVELOPMENT_STAGES)[number];

export interface DevelopmentStageResult {
  stage: DevelopmentStage;
  summary: string;
  changedFiles: string[];
  verification: "not-run" | "passed" | "failed";
}

export interface DevelopmentSupervisorState {
  version: typeof DEVELOPMENT_SUPERVISOR_VERSION;
  stages: DevelopmentStageResult[];
  current?: DevelopmentStage;
}

export const DEVELOPMENT_STAGE_INSTRUCTIONS: Record<DevelopmentStage, string> =
  {
    research:
      "Read-only research. Inspect the repository and relevant architecture docs. Find confirmed defects or one realistic missing feature. Do not edit files, run mutating commands, commit, push, deploy, or invent unsupported platform capabilities. End with concise evidence and exact paths.",
    plan: "Read-only planning. Use the research evidence and existing architecture to choose exactly one bounded, in-scope change. Do not edit files. Reject ideas that require fake Office.js, Power Pivot, Python, VBA/COM, Solver, or cloud permissions that are not implemented.",
    implement:
      "Implement only the selected change. Preserve existing working behavior. Add or update deterministic tests. Do not commit, push, deploy, change production, access credentials, or make unrelated rewrites.",
    verify:
      "Verification only. Run the smallest relevant tests, typechecks, builds, and diff checks. Do not edit files or repair failures in this stage. Report every command and its result.",
    review:
      "Read-only final review. Inspect the diff, test evidence, safety boundaries, and unsupported capability claims. Do not edit files. Report confirmed residual risks and whether the patch is safe for manual review.",
  };

export function createDevelopmentSupervisorState(): DevelopmentSupervisorState {
  return {
    version: DEVELOPMENT_SUPERVISOR_VERSION,
    stages: [],
  };
}

export function nextDevelopmentStage(
  state: DevelopmentSupervisorState,
): DevelopmentStage | undefined {
  return DEVELOPMENT_STAGES.find(
    (stage) => !state.stages.some((result) => result.stage === stage),
  );
}

export function recordDevelopmentStage(
  state: DevelopmentSupervisorState,
  result: DevelopmentStageResult,
): DevelopmentSupervisorState {
  if (state.stages.some((item) => item.stage === result.stage))
    throw new Error(`DEVELOPMENT_STAGE_ALREADY_RECORDED:${result.stage}`);
  return {
    ...state,
    current: undefined,
    stages: [
      ...state.stages,
      { ...result, summary: result.summary.slice(0, 4_000) },
    ],
  };
}

export function assertSafeDevelopmentCommand(command: string): void {
  const normalized = command.trim().toLowerCase();
  if (!normalized || normalized.length > 2_000)
    throw new Error("COMMAND_DENIED");

  const forbidden = [
    /\bgit\s+(commit|push|reset|clean|checkout|restore)\b/,
    /\b(deploy|publish|release|rolling-deploy|docker\s+push)\b/,
    /\b(ssh|scp|sftp|rsync)\b/,
    /\b(curl|wget)\s+.*\b(post|put|patch|delete)\b/,
    /\b(vynor_host|vynor_key|ssh_key|token|api[_-]?key|password|secret)\b/,
    /(^|[;&|])\s*(rm|rmdir|del|format)\b/,
  ];
  if (forbidden.some((pattern) => pattern.test(normalized)))
    throw new Error("DEVELOPMENT_COMMAND_NOT_ALLOWED");
}
