import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleStackIcon,
  PlusIcon,
  ArrowUturnLeftIcon,
  CpuChipIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useContext, useEffect, useState } from "react";
import { renderChatMessage } from "core/util/messageContent";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  ExpertCouncilDepth,
  setExpertCouncilDepth,
  setProjectMemories,
} from "../../redux/slices/sessionSlice";
import {
  normalizeProjectMemory,
  parseProjectMemories,
  projectMemoryStorageKey,
  validateProjectMemory,
} from "../../util/projectMemory";
import { inferExpertRoles } from "../../util/expertRouting";
import { getLocalStorage } from "../../util/localStorage";

const stages = ["Discover", "Plan", "Build", "Security", "QA"] as const;

type CheckpointSummary = {
  id: string;
  fileUri: string;
  fileName: string;
  createdAt: number;
  label: string;
  taskId?: string;
};

export function ExpertTeamPanel() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const enabled = useAppSelector((state) => state.session.expertTeamEnabled);
  const history = useAppSelector((state) => state.session.history);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const memories = useAppSelector(
    (state) => state.session.projectMemories ?? [],
  );
  const subagentRuns = useAppSelector(
    (state) => state.session.subagentRuns ?? [],
  );
  const councilDepth = useAppSelector(
    (state) => state.session.expertCouncilDepth ?? "smart",
  );
  const subagentModel = useAppSelector(
    (state) => state.config.config.selectedModelByRole.subagent,
  );
  const [memoryKey, setMemoryKey] = useState<string>();
  const [showMemories, setShowMemories] = useState(false);
  const [draft, setDraft] = useState("");
  const [memoryError, setMemoryError] = useState<string>();
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [checkpointStatus, setCheckpointStatus] = useState<string>();
  const supportsCheckpoints = getLocalStorage("ide") === "vscode";

  const refreshCheckpoints = async () => {
    if (!supportsCheckpoints) return;
    const result = await ideMessenger.request("checkpoints/list", undefined);
    if (result.status === "success") {
      setCheckpoints(result.content);
    } else {
      setCheckpointStatus(result.error);
    }
  };

  useEffect(() => {
    let active = true;
    void ideMessenger.ide.getWorkspaceDirs().then((workspaceDirs) => {
      if (!active) return;
      const key = projectMemoryStorageKey(workspaceDirs);
      setMemoryKey(key);
      dispatch(
        setProjectMemories(parseProjectMemories(localStorage.getItem(key))),
      );
    });
    return () => {
      active = false;
    };
  }, [dispatch, ideMessenger.ide]);

  useEffect(() => {
    if (memoryKey) {
      localStorage.setItem(memoryKey, JSON.stringify(memories));
    }
  }, [memories, memoryKey]);

  if (!enabled) return null;

  const hasToolCalls = history.some((item) => item.toolCallStates?.length);
  const activeStage =
    history.length === 0 ? 0 : hasToolCalls ? 2 : isStreaming ? 1 : 4;
  const latestUserRequest = [...history]
    .reverse()
    .find((item) => item.message.role === "user");
  const expertRoles = inferExpertRoles(
    latestUserRequest ? renderChatMessage(latestUserRequest.message) : "",
  );

  const addMemory = () => {
    const error = validateProjectMemory(draft, memories.length);
    if (error) {
      setMemoryError(error);
      return;
    }
    const text = normalizeProjectMemory(draft);
    if (
      memories.some(
        (memory) => memory.text.toLowerCase() === text.toLowerCase(),
      )
    ) {
      setMemoryError("That project memory already exists.");
      return;
    }
    dispatch(
      setProjectMemories([
        ...memories,
        {
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
          text,
          createdAt: Date.now(),
        },
      ]),
    );
    setDraft("");
    setMemoryError(undefined);
  };

  return (
    <section
      aria-label="Vynor Expert Team workflow"
      className="border-command-border bg-editor mx-2 mt-2 min-w-0 rounded-lg border border-solid px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserGroupIcon className="text-accent h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">
              Vynor Expert Team
            </div>
            <div className="text-description-muted truncate text-[10px]">
              Project-aware specialist review passes
            </div>
          </div>
        </div>
        <div className="text-description-muted flex flex-wrap items-center gap-1 text-[10px]">
          {expertRoles.map((role) => (
            <span
              key={role}
              className="bg-lightgray/10 flex items-center gap-1 rounded-full px-1.5 py-0.5"
            >
              {role === "Security" && (
                <ShieldCheckIcon className="h-2.5 w-2.5" />
              )}
              {role}
            </span>
          ))}
          <button
            type="button"
            className="text-description hover:bg-lightgray/15 ml-1 flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5"
            onClick={() => setShowMemories((value) => !value)}
            aria-expanded={showMemories}
          >
            <CircleStackIcon className="h-2.5 w-2.5" />
            Memory {memories.length}
            <ChevronDownIcon
              className={`h-2.5 w-2.5 transition-transform ${showMemories ? "rotate-180" : ""}`}
            />
          </button>
          {supportsCheckpoints && (
            <button
              type="button"
              className="text-description hover:bg-lightgray/15 flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5"
              onClick={() => {
                setShowCheckpoints((value) => !value);
                void refreshCheckpoints();
              }}
              aria-expanded={showCheckpoints}
            >
              <ArrowUturnLeftIcon className="h-2.5 w-2.5" />
              Checkpoints {checkpoints.length}
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-5 gap-1" role="list">
        {stages.map((stage, index) => {
          const complete = index < activeStage;
          const active = index === activeStage;
          return (
            <div
              key={stage}
              role="listitem"
              aria-current={active ? "step" : undefined}
              className={`flex min-w-0 items-center justify-center gap-1 rounded px-1 py-1 text-[9px] sm:text-[10px] ${
                active
                  ? "bg-accent/20 text-foreground"
                  : complete
                    ? "text-description"
                    : "text-description-muted bg-lightgray/5"
              }`}
            >
              {complete && (
                <CheckCircleIcon className="hidden h-2.5 w-2.5 sm:block" />
              )}
              <span className="truncate">{stage}</span>
            </div>
          );
        })}
      </div>
      <div className="border-command-border mt-2 border-0 border-t border-solid pt-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="text-description flex min-w-0 items-center gap-1 text-[10px]">
            <CpuChipIcon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              Isolated council ·{" "}
              {subagentModel?.title ?? "subagent model not configured"}
            </span>
          </div>
          {subagentRuns.some((run) =>
            ["researching", "synthesizing"].includes(run.status),
          ) && (
            <span className="text-description-muted text-[9px]">
              Stop cancels all
            </span>
          )}
        </div>
        <div
          className="mt-1.5 flex items-center gap-1"
          role="group"
          aria-label="Expert council depth"
        >
          {(["off", "smart", "deep"] as ExpertCouncilDepth[]).map((depth) => (
            <button
              key={depth}
              type="button"
              aria-pressed={councilDepth === depth}
              disabled={isStreaming}
              onClick={() => dispatch(setExpertCouncilDepth(depth))}
              className={`cursor-pointer rounded border-0 px-2 py-0.5 text-[9px] capitalize disabled:cursor-default disabled:opacity-50 ${
                councilDepth === depth
                  ? "bg-accent/25 text-foreground"
                  : "bg-lightgray/5 text-description"
              }`}
              title={
                depth === "off"
                  ? "No specialist model calls"
                  : depth === "smart"
                    ? "Up to three specialists plus Lead Reviewer synthesis"
                    : "Up to five parallel specialists plus Lead Reviewer synthesis"
              }
            >
              {depth}
            </button>
          ))}
          <span className="text-description-muted ml-1 text-[9px]">
            {councilDepth === "off"
              ? "0 extra calls"
              : councilDepth === "smart"
                ? "≤4 review calls"
                : "≤6 review calls"}
          </span>
        </div>
        {subagentRuns.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {subagentRuns.map((run) => (
              <details
                key={run.id}
                className="bg-lightgray/5 min-w-0 rounded px-2 py-1 text-[10px]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                      run.status === "completed"
                        ? "bg-green-500"
                        : run.status === "failed"
                          ? "bg-red-500"
                          : run.status === "canceled"
                            ? "bg-gray-500"
                            : "animate-pulse bg-yellow-500"
                    }`}
                  />
                  <span className="font-medium">{run.role}</span>
                  <span className="text-description-muted ml-auto capitalize">
                    {run.status}
                  </span>
                </summary>
                {(run.summary || run.error || run.findings?.length) && (
                  <div className="text-description mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap border-0 border-t border-solid border-white/5 pt-1">
                    {run.summary ?? run.error}
                    {!!run.findings?.length && (
                      <div className="mt-1 font-medium">
                        {run.findings.length} structured finding
                        {run.findings.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </div>
      {showMemories && (
        <div className="border-command-border mt-2 border-0 border-t border-solid pt-2">
          <div className="text-description-muted mb-1.5 text-[10px]">
            Approved facts are stored locally for this workspace and reused only
            in Expert Team mode. Never add credentials.
          </div>
          <div className="flex min-w-0 gap-1">
            <input
              value={draft}
              maxLength={2_000}
              onChange={(event) => {
                setDraft(event.target.value);
                setMemoryError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") addMemory();
              }}
              placeholder="e.g. Billing writes require transaction tests"
              aria-label="New project memory"
              className="border-command-border bg-vsc-input-background text-foreground min-w-0 flex-1 rounded border border-solid px-2 py-1 text-[11px] outline-none"
            />
            <button
              type="button"
              onClick={addMemory}
              disabled={!draft.trim()}
              className="bg-accent/20 text-foreground hover:bg-accent/30 flex cursor-pointer items-center gap-1 rounded border-0 px-2 py-1 text-[10px] disabled:cursor-default disabled:opacity-50"
            >
              <PlusIcon className="h-3 w-3" /> Add
            </button>
          </div>
          {memoryError && (
            <div role="alert" className="text-error mt-1 text-[10px]">
              {memoryError}
            </div>
          )}
          {memories.length > 0 && (
            <ul className="m-0 mt-1.5 max-h-28 list-none space-y-1 overflow-y-auto p-0">
              {memories.map((memory) => (
                <li
                  key={memory.id}
                  className="bg-lightgray/5 flex min-w-0 items-start gap-1 rounded px-2 py-1 text-[10px]"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {memory.text}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete memory: ${memory.text}`}
                    onClick={() =>
                      dispatch(
                        setProjectMemories(
                          memories.filter((item) => item.id !== memory.id),
                        ),
                      )
                    }
                    className="text-description-muted hover:text-error flex-shrink-0 cursor-pointer border-0 bg-transparent p-0.5"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showCheckpoints && supportsCheckpoints && (
        <div className="border-command-border mt-2 border-0 border-t border-solid pt-2">
          <div className="text-description-muted mb-1.5 text-[10px]">
            Local snapshots are created before agent file edits. Restore warns
            before overwriting newer changes.
          </div>
          {checkpointStatus && (
            <div className="text-description mb-1 text-[10px]">
              {checkpointStatus}
            </div>
          )}
          {checkpoints.length === 0 ? (
            <div className="text-description-muted text-[10px]">
              No agent checkpoints yet.
            </div>
          ) : (
            <ul className="m-0 max-h-32 list-none space-y-1 overflow-y-auto p-0">
              {checkpoints.map((checkpoint) => (
                <li
                  key={checkpoint.id}
                  className="bg-lightgray/5 flex min-w-0 items-center gap-2 rounded px-2 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px]">
                      {checkpoint.fileName}
                    </div>
                    <div className="text-description-muted text-[9px]">
                      {checkpoint.label} ·{" "}
                      {new Date(checkpoint.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-description hover:bg-lightgray/15 cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-[10px]"
                    onClick={async () => {
                      const result = await ideMessenger.request(
                        "checkpoints/restore",
                        { id: checkpoint.id },
                      );
                      if (result.status === "error") {
                        setCheckpointStatus(result.error);
                        return;
                      }
                      setCheckpointStatus(
                        result.content.restored
                          ? `Restored ${checkpoint.fileName}`
                          : (result.content.reason ?? "Restore canceled."),
                      );
                      await refreshCheckpoints();
                    }}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
