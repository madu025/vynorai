import { createHash, randomUUID } from "crypto";
import * as path from "path";

import { Mutex } from "async-mutex";

import { getContinueGlobalPath } from "../util/paths";
import { TaskJournal } from "./TaskJournal";
import type {
  AgentTask,
  AgentTaskBudget,
  ApprovalReceipt,
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class TaskRuntime {
  private readonly mutex = new Mutex();
  private readonly journal: TaskJournal;
  private readonly tasks = new Map<string, AgentTask>();
  private sequence = 0;

  constructor(directory = path.join(getContinueGlobalPath(), "agent-tasks")) {
    this.journal = new TaskJournal(directory);
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
        budget: { ...DEFAULT_BUDGET, ...input.budget },
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

  async transition(
    taskId: string,
    state: TaskState,
    reason?: string,
  ): Promise<AgentTask> {
    return this.mutex.runExclusive(async () => {
      const task = this.requireTask(taskId);
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

  private requireTask(taskId: string): AgentTask {
    const task = this.tasks.get(taskId) ?? this.journal.load(taskId);
    if (!task) throw new Error("Task not found");
    this.tasks.set(taskId, task);
    return task;
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
