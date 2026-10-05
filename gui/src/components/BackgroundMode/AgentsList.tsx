import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";

interface AgentsListProps {
  isCreatingAgent?: boolean;
}

interface BackgroundTask {
  id: string;
  status: string;
  createdAt?: string;
  queuePosition?: number | null;
  patchAvailable?: boolean;
  failureReason?: string;
  proof?: {
    summary?: string;
    verification?: Array<{ command: string; classification: string }>;
    risks?: Array<{ severity: string; summary: string }>;
    billing?: { netChargedCredits?: number; refundCredits?: number };
  };
}

const terminal = new Set(["completed", "failed", "canceled", "purged"]);

export function AgentsList({ isCreatingAgent = false }: AgentsListProps) {
  const messenger = useContext(IdeMessengerContext);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const refresh = async () => {
    const response = await messenger.request("background/list", undefined);
    if (response.status === "error") throw new Error(response.error);
    setTasks(response.content.tasks as unknown as BackgroundTask[]);
    setError(undefined);
  };

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(String(reason.message || reason)),
    );
    const timer = setInterval(
      () =>
        void refresh().catch((reason) =>
          setError(String(reason.message || reason)),
        ),
      tasks.some((task) => !terminal.has(task.status)) ? 5_000 : 20_000,
    );
    return () => clearInterval(timer);
  }, [isCreatingAgent, tasks.some((task) => !terminal.has(task.status))]);

  const act = async (taskId: string, action: "cancel" | "review") => {
    setBusy(taskId);
    try {
      const response = await messenger.request(
        action === "cancel" ? "background/cancel" : "background/review",
        { taskId },
        120_000,
      );
      if (response.status === "error") throw new Error(response.error);
      await refresh();
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(undefined);
    }
  };

  if (error && tasks.length === 0)
    return (
      <div className="text-error px-2 py-4 text-center text-xs">{error}</div>
    );
  if (!tasks.length && !isCreatingAgent)
    return (
      <div className="text-description-muted px-2 py-4 text-center text-sm">
        No background tasks yet. Select Background mode, describe the change,
        and press Send.
      </div>
    );

  return (
    <div className="flex flex-col gap-2 px-2 pb-4">
      {error && <div className="text-error text-xs">{error}</div>}
      {tasks.map((task) => {
        const checks = task.proof?.verification || [];
        const passed = checks.filter(
          (item) => item.classification === "passed",
        ).length;
        return (
          <div
            key={task.id}
            className="border-command-border bg-vsc-input-background rounded-md border border-solid p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">
                  {task.proof?.summary ||
                    `Background task ${task.id.slice(0, 8)}`}
                </div>
                <div className="text-description-muted mt-1 text-[10px]">
                  {task.status.replace(/_/g, " ")}
                  {task.queuePosition ? ` · queue #${task.queuePosition}` : ""}
                  {checks.length
                    ? ` · ${passed}/${checks.length} checks passed`
                    : ""}
                </div>
              </div>
              <div className="flex gap-1">
                {!terminal.has(task.status) && (
                  <button
                    type="button"
                    disabled={busy === task.id}
                    onClick={() => void act(task.id, "cancel")}
                    className="border-command-border text-description hover:text-foreground cursor-pointer rounded border border-solid bg-transparent px-2 py-1 text-[10px] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
                {task.patchAvailable && (
                  <button
                    type="button"
                    disabled={busy === task.id}
                    onClick={() => void act(task.id, "review")}
                    className="bg-button text-button-foreground cursor-pointer rounded border-0 px-2 py-1 text-[10px] disabled:opacity-50"
                  >
                    Review Changes
                  </button>
                )}
              </div>
            </div>
            {(task.failureReason || task.proof?.risks?.length) && (
              <div className="text-description mt-2 text-[10px]">
                {task.failureReason || task.proof?.risks?.[0]?.summary}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
