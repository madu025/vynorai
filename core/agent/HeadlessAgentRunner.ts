import { AgentOrchestrator, type ProposedPlanStep } from "./AgentOrchestrator";
import { TaskRuntime } from "./TaskRuntime";
import type { AgentPlanStep, ToolRisk, VerificationResult } from "./types";

export interface HeadlessStepResult {
  ok: boolean;
  summary: string;
  workspaceRevision?: number;
  verification?: Omit<VerificationResult, "id" | "createdAt">;
  failureCode?: string;
}

export interface HeadlessAgentAdapter {
  plan(goal: string): Promise<ProposedPlanStep[]>;
  execute(step: AgentPlanStep): Promise<HeadlessStepResult>;
  onEvent?(event: string, data: Record<string, unknown>): Promise<void> | void;
}

/**
 * IDE-independent orchestration over the same durable runtime and approval
 * semantics used by interactive agents. The sandbox supplies tools through an
 * adapter; it does not maintain a second task state machine.
 */
export class HeadlessAgentRunner {
  constructor(
    private readonly runtime: TaskRuntime,
    private readonly adapter: HeadlessAgentAdapter,
  ) {}

  async run(input: {
    sessionId: string;
    workspaceId: string;
    goal: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  }) {
    let revision = 0;
    const task = await this.runtime.start({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      workspaceRevision: revision,
      goal: input.goal,
      budget: {
        maxInputTokens: input.maxInputTokens,
        maxOutputTokens: input.maxOutputTokens,
      },
    });
    const orchestrator = new AgentOrchestrator(this.runtime);
    const plan = await this.adapter.plan(input.goal);
    await orchestrator.createPlan(task.id, plan);
    await this.adapter.onEvent?.("plan.created", { steps: plan.length });

    while (true) {
      const next = orchestrator.next(task.id, input.workspaceId, revision);
      if (next.action === "complete") {
        const current = this.runtime.get(task.id)!;
        if (current.state !== "verifying")
          await this.runtime.transition(task.id, "verifying", "plan complete");
        return this.runtime.transition(task.id, "completed", "verified");
      }
      if (next.action === "blocked") {
        if (this.runtime.get(task.id)?.state !== "failed")
          await this.runtime.transition(task.id, "failed", next.reason);
        throw new Error(next.reason);
      }
      if (next.action === "canceled") {
        if (this.runtime.get(task.id)?.state !== "canceled")
          await this.runtime.transition(
            task.id,
            "canceled",
            "cancel requested",
          );
        return this.runtime.get(task.id)!;
      }
      if (next.action === "await_approval") {
        await this.runtime.recordApproval({
          taskId: task.id,
          toolCallId: `${task.id}:${next.step.id}`,
          toolName: next.step.kind,
          risk: next.step.risk as ToolRisk,
          decision: next.step.risk === "R3" ? "denied" : "approved",
          scope: input.workspaceId,
        });
        if (next.step.risk === "R3") {
          await this.runtime.transition(
            task.id,
            "failed",
            "HEADLESS_R3_DENIED",
          );
          throw new Error("HEADLESS_R3_DENIED");
        }
      }
      await orchestrator.startStep(
        task.id,
        next.step.id,
        next.action === "await_approval",
      );
      await this.adapter.onEvent?.("step.started", {
        id: next.step.id,
        summary: next.step.summary,
      });
      const result = await this.adapter.execute(next.step);
      if (result.workspaceRevision != null) revision = result.workspaceRevision;
      if (result.verification)
        await this.runtime.recordVerification(task.id, result.verification);
      if (result.ok)
        await orchestrator.completeStep(
          task.id,
          next.step.id,
          input.workspaceId,
        );
      else
        await orchestrator.failStep(
          task.id,
          next.step.id,
          result.failureCode || "HEADLESS_STEP_FAILED",
        );
      await this.adapter.onEvent?.("step.finished", {
        id: next.step.id,
        ok: result.ok,
        summary: result.summary,
      });
    }
  }
}
