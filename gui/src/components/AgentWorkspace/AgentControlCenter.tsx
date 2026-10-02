import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CommandLineIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
  PlayIcon,
  StopIcon,
} from "@heroicons/react/24/outline";
import type { JSONContent } from "@tiptap/react";
import type { AgentTask, AgentPlanStepState } from "core/agent/types";
import type { VerificationCommandCandidate } from "core/workspace/types";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  setActiveTaskId,
  setActiveTaskState,
} from "../../redux/slices/sessionSlice";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";

const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);

function resumePrompt(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Continue the interrupted task. Re-read the current workspace state, follow the persisted plan, and verify the result before finishing.",
          },
        ],
      },
    ],
  };
}

function stateTone(state: AgentPlanStepState): string {
  if (state === "succeeded") return "bg-success";
  if (state === "failed" || state === "blocked") return "bg-error";
  if (["running", "verifying"].includes(state)) return "bg-accent";
  if (state === "awaiting_approval") return "bg-warning";
  return "bg-description-muted";
}

export function AgentControlCenter() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const mode = useAppSelector((state) => state.session.mode);
  const sessionId = useAppSelector((state) => state.session.id);
  const activeTaskId = useAppSelector((state) => state.session.activeTaskId);
  const activeTaskState = useAppSelector(
    (state) => state.session.activeTaskState,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const workspaceRevision = useAppSelector(
    (state) => state.workspace.snapshot?.revision,
  );
  const [task, setTask] = useState<AgentTask>();
  const [resumable, setResumable] = useState<AgentTask[]>([]);
  const [verification, setVerification] = useState<
    VerificationCommandCandidate[]
  >([]);
  const [expanded, setExpanded] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string>();
  const [error, setError] = useState<string>();
  const [taskCheckpointCount, setTaskCheckpointCount] = useState(0);

  const refreshTask = useCallback(async () => {
    if (!activeTaskId) {
      setTask(undefined);
      return;
    }
    const taskResult = await ideMessenger.request("agent/task/get", {
      taskId: activeTaskId,
    });
    if (taskResult.status === "success") setTask(taskResult.content);
  }, [activeTaskId, ideMessenger]);

  const refreshSupportingData = useCallback(async () => {
    const [resumableResult, verificationResult, checkpointResult] =
      await Promise.all([
        ideMessenger.request("agent/task/listResumable", { sessionId }),
        ideMessenger.request("workspace/getVerificationPlan", undefined),
        ideMessenger.request("checkpoints/list", undefined),
      ]);
    if (resumableResult.status === "success") {
      setResumable(
        resumableResult.content.filter((item) => item.id !== activeTaskId),
      );
    }
    if (verificationResult.status === "success") {
      setVerification(verificationResult.content);
    }
    if (checkpointResult.status === "success") {
      setTaskCheckpointCount(
        checkpointResult.content.filter(
          (checkpoint) => checkpoint.taskId === activeTaskId,
        ).length,
      );
    }
  }, [activeTaskId, ideMessenger, sessionId]);

  useEffect(() => {
    if (mode !== "agent") return;
    void refreshTask();
    if (!activeTaskId || TERMINAL_STATES.has(activeTaskState ?? "")) return;
    const interval = setInterval(() => void refreshTask(), 2_000);
    return () => clearInterval(interval);
  }, [mode, refreshTask, activeTaskId, activeTaskState]);

  useEffect(() => {
    if (mode === "agent") void refreshSupportingData();
  }, [mode, refreshSupportingData, workspaceRevision]);

  const visibleTask = task?.id === activeTaskId ? task : undefined;
  const isActive = visibleTask && !TERMINAL_STATES.has(visibleTask.state);
  const progress = useMemo(() => {
    const steps = visibleTask?.plan?.steps ?? [];
    if (!steps.length) return 0;
    return Math.round(
      (steps.filter((step) => step.state === "succeeded").length /
        steps.length) *
        100,
    );
  }, [visibleTask]);

  const resume = async (taskId: string) => {
    if (isStreaming || busyTaskId) return;
    setBusyTaskId(taskId);
    setError(undefined);
    try {
      const result = await ideMessenger.request("agent/task/resume", {
        taskId,
      });
      if (result.status === "error") throw new Error(result.error);
      dispatch(setActiveTaskId(taskId));
      dispatch(setActiveTaskState(result.content.state));
      setTask(result.content);
      await dispatch(
        streamResponseThunk({
          editorState: resumePrompt(),
          modifiers: { useCodebase: true, noContext: false },
          resumeTaskId: taskId,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not resume task",
      );
    } finally {
      setBusyTaskId(undefined);
      void refreshTask();
      void refreshSupportingData();
    }
  };

  const cancel = async () => {
    if (!visibleTask) return;
    if (isStreaming) {
      await dispatch(cancelStream());
      return;
    }
    const result = await ideMessenger.request("agent/task/cancel", {
      taskId: visibleTask.id,
      reason: "Canceled from Agent Control Center",
    });
    if (result.status === "success") {
      setTask(result.content);
      dispatch(setActiveTaskState(result.content.state));
    } else {
      setError(result.error);
    }
  };

  const restoreTask = async () => {
    if (!visibleTask || isStreaming || busyTaskId) return;
    setBusyTaskId(visibleTask.id);
    setError(undefined);
    try {
      const result = await ideMessenger.request("checkpoints/restoreTask", {
        taskId: visibleTask.id,
      });
      if (result.status === "error") throw new Error(result.error);
      if (!result.content.restored) {
        throw new Error(result.content.reason ?? "Task restore was canceled");
      }
      await ideMessenger.request("workspace/invalidate", {
        reason: "Agent task restored",
      });
      setTaskCheckpointCount(0);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not restore task",
      );
    } finally {
      setBusyTaskId(undefined);
    }
  };

  if (mode !== "agent") return null;
  if (!visibleTask && resumable.length === 0 && verification.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Agent Control Center"
      className="border-command-border bg-editor mx-2 mb-1 min-w-0 rounded-lg border border-solid"
    >
      <div className="flex min-w-0 items-center px-1 py-1">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-1.5 py-1 text-left"
          aria-expanded={expanded}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              visibleTask?.state === "failed"
                ? "bg-error"
                : visibleTask?.state === "awaiting_approval"
                  ? "bg-warning"
                  : isActive
                    ? "bg-accent"
                    : "bg-success"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold">
              Agent Control Center
            </span>
            <span className="text-description-muted block truncate text-[9px]">
              {visibleTask
                ? `${visibleTask.state.replace("_", " ")} · ${progress}% · ${visibleTask.executionGuard.autonomousSteps}/${visibleTask.executionGuard.maxAutonomousSteps} actions`
                : `${resumable.length} interrupted task${resumable.length === 1 ? "" : "s"} available`}
            </span>
          </span>
          <ChevronDownIcon
            className={`text-description h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {isActive && (
          <button
            type="button"
            aria-label="Cancel agent task"
            title="Cancel task"
            onClick={(event) => {
              void cancel();
            }}
            className="text-description hover:text-error cursor-pointer border-0 bg-transparent p-1"
          >
            <StopIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-command-border border-0 border-t border-solid px-2.5 py-2">
          {visibleTask?.plan && (
            <div className="space-y-1" role="list" aria-label="Agent plan">
              {visibleTask.plan.steps.map((step) => (
                <div
                  key={step.id}
                  role="listitem"
                  className="bg-lightgray/5 flex min-w-0 items-center gap-2 rounded px-2 py-1.5"
                >
                  {step.state === "succeeded" ? (
                    <CheckCircleIcon className="text-success h-3.5 w-3.5 shrink-0" />
                  ) : step.state === "failed" || step.state === "blocked" ? (
                    <ExclamationTriangleIcon className="text-error h-3.5 w-3.5 shrink-0" />
                  ) : step.state === "awaiting_approval" ? (
                    <PauseCircleIcon className="text-warning h-3.5 w-3.5 shrink-0" />
                  ) : step.state === "running" || step.state === "verifying" ? (
                    <ArrowPathIcon className="text-accent h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${stateTone(step.state)}`}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[10px]">
                    {step.summary}
                  </span>
                  <span className="text-description-muted shrink-0 text-[8px] uppercase">
                    {step.state.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {visibleTask && isActive && !isStreaming && (
            <button
              type="button"
              disabled={Boolean(busyTaskId)}
              onClick={() => void resume(visibleTask.id)}
              className="bg-accent/20 text-foreground hover:bg-accent/30 mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border-0 px-2 py-1.5 text-[10px] disabled:cursor-default disabled:opacity-50"
            >
              {busyTaskId === visibleTask.id ? (
                <ArrowPathIcon className="h-3 w-3 animate-spin" />
              ) : (
                <PlayIcon className="h-3 w-3" />
              )}
              Resume autonomous run
            </button>
          )}

          {visibleTask && taskCheckpointCount > 0 && (
            <button
              type="button"
              disabled={isStreaming || Boolean(busyTaskId)}
              onClick={() => void restoreTask()}
              className="text-warning hover:bg-warning/10 mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-solid border-current bg-transparent px-2 py-1.5 text-[10px] disabled:cursor-default disabled:opacity-50"
              title="Restore every file changed by this agent task to its pre-task state"
            >
              <ArrowUturnLeftIcon className="h-3 w-3" />
              Restore task changes ({taskCheckpointCount} checkpoint
              {taskCheckpointCount === 1 ? "" : "s"})
            </button>
          )}

          {resumable.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-description-muted text-[9px] font-medium uppercase tracking-wide">
                Interrupted runs
              </div>
              {resumable.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="bg-lightgray/5 flex min-w-0 items-center gap-2 rounded px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[10px]">
                    {item.plan?.steps.find(
                      (step) => !["succeeded", "canceled"].includes(step.state),
                    )?.summary ?? "Interrupted agent task"}
                  </span>
                  <button
                    type="button"
                    disabled={isStreaming || Boolean(busyTaskId)}
                    onClick={() => void resume(item.id)}
                    className="text-accent hover:bg-accent/10 cursor-pointer rounded border-0 bg-transparent px-1.5 py-1 text-[9px] disabled:cursor-default disabled:opacity-50"
                  >
                    Resume
                  </button>
                </div>
              ))}
            </div>
          )}

          {verification.length > 0 && (
            <div className="mt-2">
              <div className="text-description-muted mb-1 flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide">
                <CommandLineIcon className="h-3 w-3" />
                Suggested verification · approval required
              </div>
              <div className="flex min-w-0 flex-wrap gap-1">
                {verification.slice(0, 6).map((candidate) => (
                  <code
                    key={candidate.id}
                    title={`${candidate.rootName} · ${candidate.source}`}
                    className="bg-lightgray/10 text-description max-w-full truncate rounded px-1.5 py-1 text-[9px]"
                  >
                    {candidate.command}
                  </code>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="text-error mt-2 text-[9px]" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
