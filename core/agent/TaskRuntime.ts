import { createHash, randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";

import { Mutex } from "async-mutex";

import { MAX_AUTONOMOUS_STEPS } from "./guardErrors";
import { TaskJournal } from "./TaskJournal";
import { classifyDelegatedToolCall } from "./SubagentToolPolicy";
import { hasPassedRequiredVerification } from "./verification";
import type {
  AgentTask,
  AgentTaskBudget,
  ApprovalReceipt,
  CompletionContract,
  CompletionContractInput,
  CompletionCriterion,
  CriterionDecisionReceipt,
  CriterionStatus,
  EvidenceReceipt,
  ImplementationSubagent,
  ImplementationSubagentRole,
  SubagentAuthority,
  TaskState,
  ToolRisk,
  VerificationResult,
} from "./types";

const TERMINAL_STATES = new Set<TaskState>(["completed", "failed", "canceled"]);
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  queued: ["gathering", "canceled", "failed"],
  gathering: [
    "planning",
    "awaiting_approval",
    "executing",
    "verifying",
    "failed",
    "canceled",
  ],
  planning: [
    "awaiting_approval",
    "executing",
    "verifying",
    "failed",
    "canceled",
  ],
  awaiting_approval: ["executing", "canceled", "failed"],
  executing: [
    "gathering",
    "awaiting_approval",
    "verifying",
    "failed",
    "canceled",
  ],
  verifying: ["completed", "executing", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

const DEFAULT_BUDGET: AgentTaskBudget = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  maxInputTokens: 200_000,
  maxOutputTokens: 32_000,
  maxCostUsd: 3,
};

const MAX_IMPLEMENTATION_SUBAGENTS = 8;
export { MAX_AUTONOMOUS_STEPS };

function canonicalScopePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  )
    throw new Error(
      "Subagent file scope must be a safe workspace-relative path",
    );
  return normalized.replace(/\/$/, "");
}

function scopesOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const CRITERION_ID = /^[a-z][a-z0-9._-]{0,63}$/i;
const ABSOLUTE_PATH =
  /(?:^|[\s("'`])(?:[a-z]:[\\/]|\\\\|\/(?:home|users|tmp|private|var)\b)/i;

function assertSafeText(value: string, label: string, max: number): string {
  const text = String(value ?? "")
    .trim()
    .slice(0, max);
  if (!text) throw new Error(`${label} is required`);
  if (ABSOLUTE_PATH.test(text))
    throw new Error(`${label} must not contain an absolute path`);
  return text;
}

function normalizeContract(input: CompletionContract): CompletionContract {
  if (input.version !== 1)
    throw new Error("Unsupported completion contract version");
  if (!["simple", "medium", "complex"].includes(input.scope))
    throw new Error("Invalid completion contract scope");
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  )
    throw new Error("Invalid completion contract confidence");
  if (
    !Array.isArray(input.criteria) ||
    input.criteria.length === 0 ||
    input.criteria.length > 32
  )
    throw new Error("Completion contract must contain 1 to 32 criteria");
  const ids = new Set<string>();
  const criteria = input.criteria.map((criterion): CompletionCriterion => {
    const id = String(criterion.id ?? "").trim();
    if (!CRITERION_ID.test(id) || ids.has(id))
      throw new Error("Invalid or duplicate completion criterion id");
    ids.add(id);
    const statement = assertSafeText(
      criterion.statement,
      "Completion criterion statement",
      500,
    );
    const evidencePolicy = (
      Array.isArray(criterion.evidencePolicy) ? criterion.evidencePolicy : []
    )
      .map((item) => String(item).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);
    if (!evidencePolicy.length)
      throw new Error("Completion criterion evidence policy is required");
    if (
      !["user_explicit", "inferred", "repository_required"].includes(
        criterion.provenance,
      )
    )
      throw new Error("Invalid completion criterion provenance");
    if (
      ![
        "pending",
        "passed",
        "failed",
        "blocked",
        "user_skipped",
        "stale",
      ].includes(criterion.status)
    )
      throw new Error("Invalid completion criterion status");
    return {
      id,
      statement,
      provenance: criterion.provenance,
      required: Boolean(criterion.required),
      evidencePolicy,
      status: criterion.status ?? "pending",
      reason: criterion.reason
        ? assertSafeText(criterion.reason, "Completion criterion reason", 500)
        : undefined,
      mutationGeneration: criterion.mutationGeneration,
    };
  });
  return {
    id: input.id,
    version: 1,
    taskId: input.taskId,
    goalVersion: input.goalVersion,
    workspaceId: input.workspaceId,
    scope: input.scope,
    confidence: input.confidence,
    criteria,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeTask(task: AgentTask): AgentTask {
  // Journals written before the contract protocol are deliberately upgraded
  // in memory and retain their old completion semantics.
  if (task.schemaVersion && task.schemaVersion > 2)
    throw new Error("Unsupported newer agent task schema");
  task.schemaVersion ??= 2;
  task.goalVersion ??= 1;
  task.approvals ??= [];
  task.checkpoints ??= [];
  task.verification ??= [];
  task.evidence ??= [];
  task.criterionDecisions ??= [];
  task.mutationGeneration ??= 0;
  task.executionGuard ??= {
    autonomousSteps: 0,
    maxAutonomousSteps: MAX_AUTONOMOUS_STEPS,
    repeatedActionLimit: 3,
    actionDigests: {},
    cancelRequested: false,
  };
  if (task.contract) {
    const legacyContract = task.contract as Partial<CompletionContract>;
    task.contract = normalizeContract({
      ...task.contract,
      id: legacyContract.id ?? `legacy-${task.id}`,
      taskId: legacyContract.taskId ?? task.id,
      goalVersion: legacyContract.goalVersion ?? task.goalVersion ?? 1,
      workspaceId: legacyContract.workspaceId ?? task.workspaceId,
    });
  }
  return task;
}

function contractIsComplete(task: AgentTask): boolean {
  if (!task.contract) return true;
  return task.contract.criteria
    .filter((criterion) => criterion.required)
    .every((criterion) => {
      if (criterion.status === "user_skipped")
        return (task.criterionDecisions ?? []).some(
          (decision) =>
            decision.criterionId === criterion.id &&
            decision.decision === "skipped",
        );
      if (criterion.status !== "passed") return false;
      return (task.evidence ?? []).some(
        (receipt) =>
          receipt.criterionId === criterion.id &&
          receipt.status === "passed" &&
          receipt.mutationGeneration === (task.mutationGeneration ?? 0),
      );
    });
}

export class TaskRuntime {
  private readonly mutex = new Mutex();
  private readonly journal: TaskJournal;
  private readonly tasks = new Map<string, AgentTask>();
  private sequence: number;

  constructor(
    directory = path.join(
      // Same lookup as core/util/paths.ts, so an isolated profile (E2E) does
      // not write its task journals into the user's own folder.
      process.env.VYNORAI_GLOBAL_DIR ||
        process.env.CONTINUE_GLOBAL_DIR ||
        path.join(os.homedir(), ".vynorai"),
      "agent-tasks",
    ),
  ) {
    this.journal = new TaskJournal(directory);
    this.sequence = this.journal.maxEventSequence();
  }

  async start(input: {
    sessionId: string;
    workspaceId: string;
    workspaceRevision: number;
    goal: string;
    contract?: CompletionContractInput;
    budget?: Partial<
      Pick<AgentTaskBudget, "maxInputTokens" | "maxOutputTokens" | "maxCostUsd">
    >;
  }): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const now = Date.now();
      const task: AgentTask = {
        schemaVersion: 2,
        id: randomUUID(),
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workspaceRevision: input.workspaceRevision,
        goalVersion: 1,
        state: "gathering",
        goalDigest: digest(input.goal),
        approvals: [],
        checkpoints: [],
        verification: [],
        evidence: [],
        criterionDecisions: [],
        contract: input.contract
          ? normalizeContract({
              ...input.contract,
              id: randomUUID(),
              taskId: "pending",
              goalVersion: 1,
              workspaceId: input.workspaceId,
              createdAt: now,
              updatedAt: now,
            })
          : undefined,
        mutationGeneration: 0,
        executionGuard: {
          autonomousSteps: 0,
          maxAutonomousSteps: MAX_AUTONOMOUS_STEPS,
          repeatedActionLimit: 3,
          actionDigests: {},
          cancelRequested: false,
        },
        budget: { ...DEFAULT_BUDGET, ...input.budget },
        subagents: [],
        createdAt: now,
        updatedAt: now,
      };
      if (task.contract) task.contract.taskId = task.id;
      this.tasks.set(task.id, task);
      this.persist(task, "task.started", { state: task.state });
      return structuredClone(task);
    });
  }

  get(taskId: string): AgentTask | undefined {
    const task = this.tasks.get(taskId) ?? this.journal.load(taskId);
    if (task) {
      const wasLegacy = !task.schemaVersion;
      normalizeTask(task);
      if (wasLegacy) this.journal.save(task);
      this.tasks.set(taskId, task);
    }
    return task ? structuredClone(task) : undefined;
  }

  async delete(taskId: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.journal.delete(taskId);
      this.tasks.delete(taskId);
    });
  }

  listResumable(workspaceId: string, sessionId?: string): AgentTask[] {
    return this.journal
      .list()
      .filter(
        (task) =>
          task.workspaceId === workspaceId &&
          (!sessionId || task.sessionId === sessionId) &&
          !TERMINAL_STATES.has(task.state),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((task) => structuredClone(normalizeTask(task)));
  }

  async mutate(
    taskId: string,
    eventType: string,
    eventData: Record<string, unknown>,
    update: (task: AgentTask) => void,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      update(task);
      task.updatedAt = Date.now();
      this.persist(task, eventType, eventData);
      return structuredClone(task);
    });
  }

  async transition(
    taskId: string,
    state: TaskState,
    reason?: string,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (state === "completed") {
        if (
          (task.subagents ?? []).some(
            (subagent) => subagent.status === "running",
          )
        )
          throw new Error(
            "Task cannot complete while an implementation subagent is running",
          );
        if (!hasPassedRequiredVerification(task)) {
          throw new Error(
            "Mutation task cannot complete without passed test, typecheck, lint, build, or diff-review evidence",
          );
        }
        if (!contractIsComplete(task))
          throw new Error(
            "Completion contract is missing fresh passed evidence for a required criterion",
          );
      }
      if (!TRANSITIONS[task.state].includes(state)) {
        throw new Error(`Invalid task transition: ${task.state} -> ${state}`);
      }
      task.state = state;
      task.updatedAt = Date.now();
      this.persist(task, "task.transitioned", { state, reason });
      return structuredClone(task);
    });
  }

  async recordApproval(input: {
    taskId: string;
    toolCallId: string;
    toolName: string;
    risk: ToolRisk;
    decision: "approved" | "denied";
    scope: string;
  }): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(input.taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      const receipt: ApprovalReceipt = {
        id: randomUUID(),
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        risk: input.risk,
        decision: input.decision,
        approvedAt: Date.now(),
        scopeDigest: digest(input.scope),
      };
      task.approvals.push(receipt);
      task.updatedAt = Date.now();
      this.persist(
        task,
        "approval.recorded",
        receipt as unknown as Record<string, unknown>,
      );
      return structuredClone(task);
    });
  }

  async recordVerification(
    taskId: string,
    result: Omit<VerificationResult, "id" | "createdAt">,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      const verification: VerificationResult = {
        ...result,
        mutationGeneration: task.mutationGeneration ?? 0,
        id: randomUUID(),
        createdAt: Date.now(),
      };
      task.verification.push(verification);
      task.updatedAt = Date.now();
      this.persist(
        task,
        "verification.recorded",
        verification as unknown as Record<string, unknown>,
      );
      return structuredClone(task);
    });
  }

  async setCompletionContract(
    taskId: string,
    contract: CompletionContractInput,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      task.contract = normalizeContract({
        ...contract,
        id: randomUUID(),
        taskId: task.id,
        goalVersion: task.goalVersion ?? 1,
        workspaceId: task.workspaceId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      task.updatedAt = Date.now();
      this.persist(task, "contract.recorded", {
        version: task.contract.version,
        scope: task.contract.scope,
        criterionCount: task.contract.criteria.length,
      });
      return structuredClone(task);
    });
  }

  async recordMutation(
    taskId: string,
    changedFiles: string[],
    snapshotDigest?: string,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      const files = [...new Set(changedFiles.map(canonicalScopePath))].sort();
      if (!files.length)
        throw new Error("A mutation must identify at least one changed file");
      const generation = (task.mutationGeneration ?? 0) + 1;
      task.mutationGeneration = generation;
      task.changedSurface = {
        generation,
        files,
        digest:
          snapshotDigest && /^[a-f0-9]{64}$/i.test(snapshotDigest)
            ? snapshotDigest
            : digest(files.join("\n")),
        capturedAt: Date.now(),
      };
      if (task.contract)
        task.contract.criteria = task.contract.criteria.map((criterion) =>
          criterion.status === "passed"
            ? { ...criterion, status: "stale", mutationGeneration: generation }
            : criterion,
        );
      task.updatedAt = Date.now();
      this.persist(task, "mutation.recorded", {
        generation,
        fileCount: files.length,
        surfaceDigest: task.changedSurface.digest,
      });
      return structuredClone(task);
    });
  }

  /** Rebinds a resumed task to the current workspace snapshot. A different
   * workspace is a hard failure; a newer revision invalidates passed evidence
   * because the journal cannot prove which files changed outside the task. */
  async revalidateWorkspace(
    taskId: string,
    workspaceId: string,
    workspaceRevision: number,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (task.workspaceId !== workspaceId)
        throw new Error(
          "Task workspace identity does not match current workspace",
        );
      if (TERMINAL_STATES.has(task.state)) return structuredClone(task);
      if (workspaceRevision !== task.workspaceRevision) {
        task.workspaceRevision = workspaceRevision;
        task.mutationGeneration = (task.mutationGeneration ?? 0) + 1;
        task.changedSurface = undefined;
        if (task.contract)
          task.contract.criteria = task.contract.criteria.map((criterion) =>
            criterion.status === "passed"
              ? {
                  ...criterion,
                  status: "stale",
                  mutationGeneration: task.mutationGeneration,
                }
              : criterion,
          );
        task.updatedAt = Date.now();
        this.persist(task, "workspace.revalidated", {
          workspaceRevision,
          mutationGeneration: task.mutationGeneration,
        });
      }
      return structuredClone(task);
    });
  }

  async recordEvidence(
    taskId: string,
    input: Omit<EvidenceReceipt, "id" | "createdAt" | "mutationGeneration"> & {
      mutationGeneration?: number;
    },
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      if (!task.contract)
        throw new Error(
          "Cannot record criterion evidence without a completion contract",
        );
      const criterion = task.contract.criteria.find(
        (item) => item.id === input.criterionId,
      );
      if (!criterion) throw new Error("Unknown completion criterion");
      const generation =
        input.mutationGeneration ?? task.mutationGeneration ?? 0;
      if (generation !== (task.mutationGeneration ?? 0))
        throw new Error(
          "Evidence is stale for the current mutation generation",
        );
      const status: Exclude<CriterionStatus, "pending" | "stale"> =
        input.status;
      const receipt: EvidenceReceipt = {
        ...input,
        id: randomUUID(),
        mutationGeneration: generation,
        createdAt: Date.now(),
        summary: assertSafeText(input.summary, "Evidence summary", 1000),
      };
      task.evidence ??= [];
      task.evidence.push(receipt);
      criterion.status = status;
      criterion.reason = receipt.summary;
      criterion.mutationGeneration = generation;
      task.contract.updatedAt = Date.now();
      task.updatedAt = Date.now();
      this.persist(task, "evidence.recorded", {
        criterionId: criterion.id,
        status,
        generation,
        sourceDigest: receipt.sourceDigest,
      });
      return structuredClone(task);
    });
  }

  async recordCriterionDecision(input: {
    taskId: string;
    criterionId: string;
    decision: "corrected" | "skipped";
    reason: string;
    statement?: string;
  }): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(input.taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      if (!task.contract)
        throw new Error(
          "Cannot decide a criterion without a completion contract",
        );
      const criterion = task.contract.criteria.find(
        (item) => item.id === input.criterionId,
      );
      if (!criterion) throw new Error("Unknown completion criterion");
      const reason = assertSafeText(
        input.reason,
        "Criterion decision reason",
        500,
      );
      if (input.decision === "corrected") {
        criterion.statement = assertSafeText(
          input.statement ?? "",
          "Corrected criterion statement",
          500,
        );
        criterion.provenance = "user_explicit";
        criterion.status = "pending";
      } else {
        criterion.status = "user_skipped";
      }
      criterion.reason = reason;
      const receipt: CriterionDecisionReceipt = {
        id: randomUUID(),
        criterionId: criterion.id,
        decision: input.decision,
        reason,
        createdAt: Date.now(),
      };
      task.criterionDecisions ??= [];
      task.criterionDecisions.push(receipt);
      task.contract.updatedAt = Date.now();
      task.updatedAt = Date.now();
      this.persist(task, "criterion.decision", {
        criterionId: criterion.id,
        decision: receipt.decision,
        reason,
      });
      return structuredClone(task);
    });
  }

  async consumeBudget(
    taskId: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number },
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      const next = {
        inputTokens: task.budget.inputTokens + Math.max(0, usage.inputTokens),
        outputTokens:
          task.budget.outputTokens + Math.max(0, usage.outputTokens),
        costUsd: task.budget.costUsd + Math.max(0, usage.costUsd ?? 0),
      };
      if (
        next.inputTokens > task.budget.maxInputTokens ||
        next.outputTokens > task.budget.maxOutputTokens ||
        next.costUsd > task.budget.maxCostUsd
      ) {
        throw new Error("Agent task budget exceeded");
      }
      Object.assign(task.budget, next);
      task.updatedAt = Date.now();
      this.persist(task, "budget.consumed", next);
      return structuredClone(task);
    });
  }

  async createSubagent(input: {
    taskId: string;
    role: ImplementationSubagentRole;
    objective: string;
    authority: SubagentAuthority;
    fileScope: string[];
    dependsOn?: string[];
    budget?: Partial<
      Pick<AgentTaskBudget, "maxInputTokens" | "maxOutputTokens" | "maxCostUsd">
    >;
  }): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(input.taskId);
      if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
      task.subagents ??= [];
      if (task.subagents.length >= MAX_IMPLEMENTATION_SUBAGENTS)
        throw new Error("Implementation subagent limit exceeded");
      const fileScope = [...new Set(input.fileScope.map(canonicalScopePath))];
      const dependsOn = [...new Set(input.dependsOn ?? [])];
      if (
        dependsOn.some(
          (dependencyId) =>
            !(task.subagents ?? []).some((item) => item.id === dependencyId),
        )
      )
        throw new Error(
          "Subagent dependency does not exist in the parent task",
        );
      if (input.authority.write && fileScope.length === 0)
        throw new Error(
          "Write-capable subagents require an explicit file scope",
        );
      const budget = { ...DEFAULT_BUDGET, ...input.budget };
      if (
        budget.maxInputTokens > task.budget.maxInputTokens ||
        budget.maxOutputTokens > task.budget.maxOutputTokens ||
        budget.maxCostUsd > task.budget.maxCostUsd
      )
        throw new Error("Subagent budget cannot exceed its parent task budget");
      const allocated = (task.subagents ?? []).reduce(
        (total, item) => ({
          inputTokens: total.inputTokens + item.budget.maxInputTokens,
          outputTokens: total.outputTokens + item.budget.maxOutputTokens,
          costUsd: total.costUsd + item.budget.maxCostUsd,
        }),
        { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      );
      if (
        allocated.inputTokens + budget.maxInputTokens >
          task.budget.maxInputTokens ||
        allocated.outputTokens + budget.maxOutputTokens >
          task.budget.maxOutputTokens ||
        allocated.costUsd + budget.maxCostUsd > task.budget.maxCostUsd
      )
        throw new Error(
          "Aggregate subagent budgets exceed the parent task budget",
        );
      const now = Date.now();
      const subagent: ImplementationSubagent = {
        id: randomUUID(),
        role: input.role,
        objectiveDigest: digest(input.objective),
        status: "queued",
        authority: { ...input.authority },
        fileScope,
        dependsOn,
        baseWorkspaceRevision: task.workspaceRevision,
        budget,
        createdAt: now,
        updatedAt: now,
      };
      task.subagents.push(subagent);
      task.updatedAt = now;
      this.persist(task, "subagent.created", {
        subagentId: subagent.id,
        role: subagent.role,
        authority: subagent.authority,
        fileScope: subagent.fileScope,
        dependsOn: subagent.dependsOn,
      });
      return structuredClone(subagent);
    });
  }

  async startSubagent(
    taskId: string,
    subagentId: string,
    workspaceRevision?: number,
  ): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      const subagent = this.requireSubagent(task, subagentId);
      if (subagent.status !== "queued")
        throw new Error("Subagent is not queued");
      const currentRevision = workspaceRevision ?? task.workspaceRevision;
      // The revision also moves on the agents' own edits (an opened file,
      // index progress), so it cannot tell outside changes apart; it is
      // recorded, not enforced. Workspace identity is checked per action.
      task.workspaceRevision = currentRevision;
      const incompleteDependency = subagent.dependsOn.find(
        (dependencyId) =>
          this.requireSubagent(task, dependencyId).status !== "completed",
      );
      if (incompleteDependency)
        throw new Error(
          `Subagent dependency ${incompleteDependency} is incomplete`,
        );
      if (subagent.authority.write) {
        for (const peer of task.subagents ?? []) {
          if (
            peer.id !== subagent.id &&
            peer.status === "running" &&
            peer.authority.write &&
            peer.fileScope.some((left) =>
              subagent.fileScope.some((right) => scopesOverlap(left, right)),
            )
          )
            throw new Error(
              `File scope is owned by running subagent ${peer.id}`,
            );
        }
      }
      subagent.status = "running";
      subagent.updatedAt = task.updatedAt = Date.now();
      this.persist(task, "subagent.started", { subagentId });
      return structuredClone(subagent);
    });
  }

  async consumeSubagentBudget(
    taskId: string,
    subagentId: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number },
  ): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      const subagent = this.requireSubagent(task, subagentId);
      if (subagent.status !== "running")
        throw new Error("Subagent is not running");
      const next = {
        inputTokens:
          subagent.budget.inputTokens + Math.max(0, usage.inputTokens),
        outputTokens:
          subagent.budget.outputTokens + Math.max(0, usage.outputTokens),
        costUsd: subagent.budget.costUsd + Math.max(0, usage.costUsd ?? 0),
      };
      if (
        next.inputTokens > subagent.budget.maxInputTokens ||
        next.outputTokens > subagent.budget.maxOutputTokens ||
        next.costUsd > subagent.budget.maxCostUsd
      )
        throw new Error("Subagent budget exceeded");
      const parentNext = {
        inputTokens: task.budget.inputTokens + Math.max(0, usage.inputTokens),
        outputTokens:
          task.budget.outputTokens + Math.max(0, usage.outputTokens),
        costUsd: task.budget.costUsd + Math.max(0, usage.costUsd ?? 0),
      };
      if (
        parentNext.inputTokens > task.budget.maxInputTokens ||
        parentNext.outputTokens > task.budget.maxOutputTokens ||
        parentNext.costUsd > task.budget.maxCostUsd
      )
        throw new Error("Parent task budget exceeded");
      Object.assign(subagent.budget, next);
      Object.assign(task.budget, parentNext);
      subagent.updatedAt = task.updatedAt = Date.now();
      this.persist(task, "subagent.budget.consumed", { subagentId, ...next });
      return structuredClone(subagent);
    });
  }

  authorizeSubagentAction(input: {
    taskId: string;
    subagentId: string;
    capability: keyof SubagentAuthority;
    resource?: string;
  }): boolean {
    const task = this.requireTask(input.taskId);
    const subagent = this.requireSubagent(task, input.subagentId);
    if (subagent.status !== "running")
      throw new Error("Subagent is not running");
    if (!subagent.authority[input.capability])
      throw new Error(`Subagent lacks ${input.capability} authority`);
    if (
      (input.capability === "read" || input.capability === "write") &&
      input.resource
    ) {
      const resource = canonicalScopePath(input.resource);
      if (!subagent.fileScope.some((scope) => scopesOverlap(resource, scope)))
        throw new Error("Subagent resource is outside its delegated scope");
    }
    return true;
  }

  authorizeSubagentTool(input: {
    taskId: string;
    subagentId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): boolean {
    const authorization = classifyDelegatedToolCall(input.toolName, input.args);
    return this.authorizeSubagentAction({
      taskId: input.taskId,
      subagentId: input.subagentId,
      ...authorization,
    });
  }

  async completeSubagent(input: {
    taskId: string;
    subagentId: string;
    summary: string;
    changedFiles: string[];
    verification: VerificationResult[];
    residualRisks?: string[];
    workspaceRevision?: number;
  }): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(input.taskId);
      const subagent = this.requireSubagent(task, input.subagentId);
      if (subagent.status !== "running")
        throw new Error("Subagent is not running");
      const currentRevision = input.workspaceRevision ?? task.workspaceRevision;
      // The revision also moves on the agents' own edits (an opened file,
      // index progress), so it cannot tell outside changes apart; it is
      // recorded, not enforced. Workspace identity is checked per action.
      task.workspaceRevision = currentRevision;
      const changedFiles = [
        ...new Set(input.changedFiles.map(canonicalScopePath)),
      ];
      if (!subagent.authority.write && changedFiles.length)
        throw new Error("Read-only subagent cannot hand off changed files");
      if (
        changedFiles.some(
          (file) =>
            !subagent.fileScope.some((scope) => scopesOverlap(file, scope)),
        )
      )
        throw new Error("Subagent changed a file outside its delegated scope");
      const unorderedConflict = (task.subagents ?? []).find(
        (peer) =>
          peer.id !== subagent.id &&
          peer.status === "completed" &&
          !subagent.dependsOn.includes(peer.id) &&
          (peer.handoff?.changedFiles ?? []).some((peerFile) =>
            changedFiles.some((file) => scopesOverlap(file, peerFile)),
          ),
      );
      if (unorderedConflict)
        throw new Error(
          `Handoff conflicts with completed subagent ${unorderedConflict.id} without an explicit dependency`,
        );
      if (
        changedFiles.length > 0 &&
        !input.verification.some(
          (item) => item.status === "passed" && item.kind !== "response",
        )
      )
        throw new Error(
          "Implementation handoff requires passed verification evidence",
        );
      subagent.handoff = {
        summary: input.summary.slice(0, 4000),
        changedFiles,
        verification: input.verification.map((item) => ({ ...item })),
        residualRisks: (input.residualRisks ?? [])
          .slice(0, 20)
          .map((risk) => risk.slice(0, 500)),
        completedAt: Date.now(),
      };
      subagent.status = "completed";
      subagent.updatedAt = task.updatedAt = Date.now();
      this.persist(task, "subagent.completed", {
        subagentId: subagent.id,
        changedFiles,
        verificationCount: input.verification.length,
        residualRiskCount: subagent.handoff.residualRisks.length,
      });
      return structuredClone(subagent);
    });
  }

  async failSubagent(
    taskId: string,
    subagentId: string,
    failureCode: string,
  ): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      const subagent = this.requireSubagent(task, subagentId);
      if (subagent.status !== "running" && subagent.status !== "queued")
        throw new Error("Subagent is not active");
      subagent.status = "failed";
      subagent.updatedAt = task.updatedAt = Date.now();
      this.persist(task, "subagent.failed", {
        subagentId,
        failureCode: digest(failureCode).slice(0, 16),
      });
      return structuredClone(subagent);
    });
  }

  async cancelSubagent(
    taskId: string,
    subagentId: string,
  ): Promise<ImplementationSubagent> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
      const subagent = this.requireSubagent(task, subagentId);
      if (subagent.status !== "running" && subagent.status !== "queued")
        throw new Error("Subagent is not active");
      subagent.status = "canceled";
      subagent.updatedAt = task.updatedAt = Date.now();
      this.persist(task, "subagent.canceled", { subagentId });
      return structuredClone(subagent);
    });
  }

  getSubagentMergeQueue(taskId: string): ImplementationSubagent[] {
    const task = this.requireTask(taskId);
    const completed = (task.subagents ?? []).filter(
      (item) => item.status === "completed" && Boolean(item.handoff),
    );
    const byId = new Map(completed.map((item) => [item.id, item]));
    const remaining = new Set(completed.map((item) => item.id));
    const ordered: ImplementationSubagent[] = [];
    while (remaining.size) {
      const ready = [...remaining]
        .map((id) => byId.get(id)!)
        .filter((item) =>
          item.dependsOn.every(
            (dependencyId) =>
              !byId.has(dependencyId) || !remaining.has(dependencyId),
          ),
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id),
        );
      if (!ready.length)
        throw new Error("Subagent handoff dependency cycle detected");
      for (const item of ready) {
        remaining.delete(item.id);
        ordered.push(item);
      }
    }
    return structuredClone(ordered);
  }

  private requireTask(taskId: string): AgentTask {
    const task = this.tasks.get(taskId) ?? this.journal.load(taskId);
    if (!task) throw new Error("Task not found");
    normalizeTask(task);
    for (const subagent of task.subagents ?? []) {
      subagent.dependsOn ??= [];
      subagent.baseWorkspaceRevision ??= task.workspaceRevision;
    }
    this.tasks.set(taskId, task);
    return task;
  }

  private requireSubagent(
    task: AgentTask,
    subagentId: string,
  ): ImplementationSubagent {
    const subagent = (task.subagents ?? []).find(
      (item) => item.id === subagentId,
    );
    if (!subagent) throw new Error("Subagent not found");
    return subagent;
  }

  private persist(
    task: AgentTask,
    type: string,
    data: Record<string, unknown>,
  ): void {
    this.journal.save(task);
    this.journal.append({
      sequence: ++this.sequence,
      taskId: task.id,
      type,
      createdAt: Date.now(),
      data,
    });
  }
}
