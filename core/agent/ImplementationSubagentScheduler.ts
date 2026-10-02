import type { VerificationResult } from "./types";
import { TaskRuntime } from "./TaskRuntime";
import type { ImplementationSubagent } from "./types";

export interface ImplementationTurnResult {
  summary: string;
  changedFiles: string[];
  verification: VerificationResult[];
  residualRisks?: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export type ImplementationTurnRunner = (
  subagent: ImplementationSubagent,
  signal: AbortSignal,
) => Promise<ImplementationTurnResult>;

export interface SchedulerResult {
  completed: string[];
  failed: string[];
  blocked: string[];
}

/**
 * Executes dependency-ready subagent model turns with bounded concurrency.
 * The injected runner owns model transport only; all durable lifecycle,
 * budgets, stale-workspace checks and handoff validation remain in TaskRuntime.
 */
export class ImplementationSubagentScheduler {
  constructor(
    private readonly runtime: TaskRuntime,
    private readonly runTurn: ImplementationTurnRunner,
    private readonly maxConcurrency = 3,
  ) {
    if (
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency < 1 ||
      maxConcurrency > 5
    )
      throw new Error("Subagent scheduler concurrency must be between 1 and 5");
  }

  async run(
    taskId: string,
    workspaceRevision: number,
    signal: AbortSignal,
  ): Promise<SchedulerResult> {
    const completed: string[] = [];
    const failed: string[] = [];
    const attempted = new Set<string>();

    while (!signal.aborted) {
      const task = this.runtime.get(taskId);
      if (!task) throw new Error("Task not found");
      const ready = (task.subagents ?? [])
        .filter(
          (item) =>
            item.status === "queued" &&
            !attempted.has(item.id) &&
            item.dependsOn.every(
              (dependencyId) =>
                task.subagents?.find((peer) => peer.id === dependencyId)
                  ?.status === "completed",
            ),
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id),
        )
        .slice(0, this.maxConcurrency);
      if (!ready.length) break;
      await Promise.all(
        ready.map(async (candidate) => {
          attempted.add(candidate.id);
          try {
            const started = await this.runtime.startSubagent(
              taskId,
              candidate.id,
              workspaceRevision,
            );
            const result = await this.runTurn(started, signal);
            if (signal.aborted) throw new Error("SUBAGENT_CANCELED");
            await this.runtime.consumeSubagentBudget(
              taskId,
              candidate.id,
              result.usage,
            );
            await this.runtime.completeSubagent({
              taskId,
              subagentId: candidate.id,
              summary: result.summary,
              changedFiles: result.changedFiles,
              verification: result.verification,
              residualRisks: result.residualRisks,
              workspaceRevision,
            });
            completed.push(candidate.id);
          } catch (error) {
            if (!signal.aborted) failed.push(candidate.id);
            try {
              if (signal.aborted)
                await this.runtime.cancelSubagent(taskId, candidate.id);
              else
                await this.runtime.failSubagent(
                  taskId,
                  candidate.id,
                  error instanceof Error ? error.message : String(error),
                );
            } catch {
              // A terminal/canceled parent may already have finalized the child.
            }
          }
        }),
      );
    }

    const finalTask = this.runtime.get(taskId);
    const blocked = (finalTask?.subagents ?? [])
      .filter(
        (item) =>
          item.status === "queued" &&
          item.dependsOn.some(
            (dependencyId) =>
              finalTask?.subagents?.find((peer) => peer.id === dependencyId)
                ?.status !== "completed",
          ),
      )
      .map((item) => item.id);
    return { completed, failed, blocked };
  }
}
