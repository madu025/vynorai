import { createHash, randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";

import { Mutex } from "async-mutex";

import { TaskJournal } from "./TaskJournal";
import { classifyDelegatedToolCall } from "./SubagentToolPolicy";
import { hasPassedRequiredVerification } from "./verification";
import type {
  AgentTask,
  AgentTaskBudget,
  ApprovalReceipt,
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
/**
 * Runaway-loop safety net per task. The user-facing pause is the GUI's tool
 * round budget ("Continue" starts a new task), so this is rarely reached.
 */
export const MAX_AUTONOMOUS_STEPS = 200;

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

export class TaskRuntime {
  private readonly mutex = new Mutex();
  private readonly journal: TaskJournal;
  private readonly tasks = new Map<string, AgentTask>();
  private sequence: number;

  constructor(
    directory = path.join(
      process.env.VYNORAI_GLOBAL_DIR || path.join(os.homedir(), ".vynorai"),
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
    budget?: Partial<
      Pick<AgentTaskBudget, "maxInputTokens" | "maxOutputTokens" | "maxCostUsd">
    >;
  }): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const now = Date.now();
      const task: AgentTask = {
        id: randomUUID(),
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workspaceRevision: input.workspaceRevision,
        state: "gathering",
        goalDigest: digest(input.goal),
        approvals: [],
        checkpoints: [],
        verification: [],
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
      this.tasks.set(task.id, task);
      this.persist(task, "task.started", { state: task.state });
      return structuredClone(task);
    });
  }

  get(taskId: string): AgentTask | undefined {
    const task = this.tasks.get(taskId) ?? this.journal.load(taskId);
    if (task) this.tasks.set(taskId, task);
    return task ? structuredClone(task) : undefined;
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
      .map((task) => structuredClone(task));
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
    task.executionGuard ??= {
      autonomousSteps: 0,
      maxAutonomousSteps: MAX_AUTONOMOUS_STEPS,
      repeatedActionLimit: 3,
      actionDigests: {},
      cancelRequested: false,
    };
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
