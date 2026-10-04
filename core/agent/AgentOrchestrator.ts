import { createHash } from "crypto";

import { TaskRuntime } from "./TaskRuntime";
import { redactSecrets } from "./redactSecrets";
import { classifyToolRisk } from "./toolRisk";
import type {
  AgentPlanStep,
  AgentPlanStepKind,
  AgentTask,
  ToolRisk,
} from "./types";

const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const STEP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_PLAN_STEPS = 32;

export interface ProposedPlanStep {
  id: string;
  summary: string;
  kind: AgentPlanStepKind;
  risk: ToolRisk;
  dependsOn?: string[];
  maxAttempts?: number;
  verificationRequired?: boolean;
}

export type AgentNextAction =
  | { action: "execute"; step: AgentPlanStep }
  | { action: "await_approval"; step: AgentPlanStep }
  | { action: "complete" }
  | { action: "blocked"; reason: string }
  | { action: "canceled" };

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeSummary(value: string): string {
  return redactSecrets(value)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);
}

function toolNameOf(signature: string): string {
  try {
    const parsed = JSON.parse(signature) as { tool?: unknown };
    return typeof parsed.tool === "string" ? parsed.tool : "";
  } catch {
    return "";
  }
}

function validateDag(steps: ProposedPlanStep[]): void {
  if (steps.length === 0 || steps.length > MAX_PLAN_STEPS) {
    throw new Error(`Agent plan must contain 1-${MAX_PLAN_STEPS} steps`);
  }
  const ids = new Set<string>();
  for (const step of steps) {
    if (!STEP_ID_PATTERN.test(step.id) || ids.has(step.id)) {
      throw new Error(`Invalid or duplicate agent plan step: ${step.id}`);
    }
    ids.add(step.id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new Error("Agent plan contains a dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency) || dependency === id) {
        throw new Error(`Invalid dependency ${dependency} for step ${id}`);
      }
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

export class AgentOrchestrator {
  constructor(private readonly runtime: TaskRuntime) {}

  async createPlan(
    taskId: string,
    steps: ProposedPlanStep[],
  ): Promise<AgentTask> {
    validateDag(steps);
    const now = Date.now();
    return this.runtime.mutate(
      taskId,
      "plan.created",
      { stepCount: steps.length },
      (task) => {
        this.assertActive(task);
        if (task.plan) throw new Error("Agent task already has a plan");
        task.plan = {
          version: 1,
          createdAt: now,
          updatedAt: now,
          steps: steps.map((step) => ({
            id: step.id,
            summary: safeSummary(step.summary) || "Agent step",
            kind: step.kind,
            risk: step.risk,
            dependsOn: [...(step.dependsOn ?? [])],
            state: "pending",
            attempts: 0,
            maxAttempts: Math.min(3, Math.max(1, step.maxAttempts ?? 2)),
            verificationRequired:
              step.verificationRequired ?? step.risk !== "R0",
            createdAt: now,
            updatedAt: now,
          })),
        };
        task.state = "planning";
      },
    );
  }

  next(
    taskId: string,
    workspaceId: string,
    workspaceRevision: number,
  ): AgentNextAction {
    const task = this.requireTask(taskId);
    if (task.executionGuard.cancelRequested || task.state === "canceled")
      return { action: "canceled" };
    // Revision moves on the agent's own edits; only another workspace blocks.
    if (task.workspaceId !== workspaceId) {
      return {
        action: "blocked",
        reason: "Workspace changed since this task was planned",
      };
    }
    if (!task.plan)
      return { action: "blocked", reason: "Agent task has no execution plan" };
    const failed = task.plan.steps.find(
      (step) => step.state === "failed" || step.state === "blocked",
    );
    if (failed)
      return { action: "blocked", reason: `Plan blocked at ${failed.id}` };
    const remaining = task.plan.steps.filter(
      (step) => !["succeeded", "canceled"].includes(step.state),
    );
    if (remaining.length === 0) return { action: "complete" };
    const step = remaining.find(
      (candidate) =>
        candidate.state === "pending" &&
        candidate.dependsOn.every(
          (id) =>
            task.plan?.steps.find((item) => item.id === id)?.state ===
            "succeeded",
        ),
    );
    if (!step) return { action: "blocked", reason: "No runnable plan step" };
    if (["R2", "R3"].includes(step.risk))
      return { action: "await_approval", step };
    return { action: "execute", step };
  }

  async startStep(
    taskId: string,
    stepId: string,
    approved = false,
  ): Promise<AgentTask> {
    return this.runtime.mutate(
      taskId,
      "plan.step.started",
      { stepId },
      (task) => {
        this.assertActive(task);
        const step = this.requireStep(task, stepId);
        if (step.state !== "pending" && step.state !== "awaiting_approval")
          throw new Error("Plan step is not runnable");
        if (["R2", "R3"].includes(step.risk) && !approved) {
          step.state = "awaiting_approval";
          task.state = "awaiting_approval";
          step.updatedAt = Date.now();
          return;
        }
        if (
          !step.dependsOn.every(
            (id) =>
              task.plan?.steps.find((item) => item.id === id)?.state ===
              "succeeded",
          )
        ) {
          throw new Error("Plan step dependencies are incomplete");
        }
        step.state = "running";
        step.attempts += 1;
        step.updatedAt = Date.now();
        task.state = "executing";
      },
    );
  }

  async completeStep(
    taskId: string,
    stepId: string,
    scope?: string,
  ): Promise<AgentTask> {
    return this.runtime.mutate(
      taskId,
      "plan.step.completed",
      { stepId },
      (task) => {
        const step = this.requireStep(task, stepId);
        if (step.state !== "running" && step.state !== "verifying")
          throw new Error("Plan step is not active");
        step.state = "succeeded";
        step.scopeDigest = scope ? digest(scope) : step.scopeDigest;
        step.updatedAt = Date.now();
        task.plan!.updatedAt = step.updatedAt;
        task.state = task.plan!.steps.every(
          (item) => item.state === "succeeded",
        )
          ? "verifying"
          : "planning";
      },
    );
  }

  async failStep(
    taskId: string,
    stepId: string,
    failureCode: string,
  ): Promise<AgentTask> {
    return this.runtime.mutate(
      taskId,
      "plan.step.failed",
      { stepId, failureCode: safeSummary(failureCode) },
      (task) => {
        const step = this.requireStep(task, stepId);
        if (step.state !== "running" && step.state !== "verifying")
          throw new Error("Plan step is not active");
        step.failureCode = safeSummary(failureCode);
        step.updatedAt = Date.now();
        if (step.attempts < step.maxAttempts) {
          step.state = "pending";
          task.state = "planning";
          return;
        }
        step.state = "failed";
        for (const dependent of task.plan!.steps) {
          if (
            dependent.dependsOn.includes(step.id) &&
            dependent.state === "pending"
          )
            dependent.state = "blocked";
        }
        task.state = "failed";
      },
    );
  }

  async authorizeAction(
    taskId: string,
    workspaceId: string,
    workspaceRevision: number,
    signature: string,
  ): Promise<AgentTask> {
    return this.runtime.mutate(taskId, "execution.authorized", {}, (task) => {
      this.assertActive(task);
      // Only a different workspace (other folders) stops the task. The
      // revision also moves when the agent's own edit opens a file or the
      // index progresses, which blocked every tool after the first edit.
      if (task.workspaceId !== workspaceId)
        throw new Error("Workspace changed since task start");
      task.workspaceRevision = workspaceRevision;
      if (task.executionGuard.cancelRequested)
        throw new Error("Agent task was canceled");
      if (
        task.executionGuard.autonomousSteps >=
        task.executionGuard.maxAutonomousSteps
      )
        throw new Error("Autonomous step limit reached");
      const actionDigest = digest(signature);
      const repeats =
        (task.executionGuard.actionDigests[actionDigest] ?? 0) + 1;
      if (repeats > task.executionGuard.repeatedActionLimit)
        throw new Error("Repeated tool action limit reached");
      // A file edit changes what reads, tests and builds return, so repeats
      // only count since the last edit: edit → `npm test` → edit → `npm test`
      // is a fix loop, not a stuck loop.
      if (classifyToolRisk(toolNameOf(signature)) === "R2") {
        task.executionGuard.actionDigests = {};
      } else {
        task.executionGuard.actionDigests[actionDigest] = repeats;
      }
      task.executionGuard.autonomousSteps += 1;
    });
  }

  async cancel(
    taskId: string,
    reason = "User canceled task",
  ): Promise<AgentTask> {
    return this.runtime.mutate(
      taskId,
      "task.cancel.requested",
      { reason: safeSummary(reason) },
      (task) => {
        if (TERMINAL_STATES.has(task.state)) return;
        task.executionGuard.cancelRequested = true;
        task.state = "canceled";
        for (const step of task.plan?.steps ?? []) {
          if (!["succeeded", "failed", "blocked"].includes(step.state))
            step.state = "canceled";
        }
        for (const subagent of task.subagents ?? []) {
          if (subagent.status === "queued" || subagent.status === "running") {
            subagent.status = "canceled";
            subagent.updatedAt = Date.now();
          }
        }
      },
    );
  }

  async resume(
    taskId: string,
    workspaceId: string,
    workspaceRevision: number,
  ): Promise<AgentTask> {
    return this.runtime.mutate(taskId, "task.resumed", {}, (task) => {
      this.assertActive(task);
      // Same rule as authorizeAction: only another workspace blocks a resume.
      if (task.workspaceId !== workspaceId)
        throw new Error("Cannot resume in a different workspace");
      task.workspaceRevision = workspaceRevision;
      for (const step of task.plan?.steps ?? []) {
        if (["running", "verifying", "awaiting_approval"].includes(step.state))
          step.state = "pending";
      }
      for (const subagent of task.subagents ?? []) {
        if (subagent.status === "running") {
          subagent.status = "queued";
          subagent.updatedAt = Date.now();
        }
      }
      task.state = task.plan ? "planning" : "gathering";
    });
  }

  private requireTask(taskId: string): AgentTask {
    const task = this.runtime.get(taskId);
    if (!task) throw new Error("Task not found");
    return task;
  }

  private requireStep(task: AgentTask, stepId: string): AgentPlanStep {
    const step = task.plan?.steps.find((item) => item.id === stepId);
    if (!step) throw new Error("Agent plan step not found");
    return step;
  }

  private assertActive(task: AgentTask): void {
    if (TERMINAL_STATES.has(task.state)) throw new Error("Task is terminal");
  }
}
