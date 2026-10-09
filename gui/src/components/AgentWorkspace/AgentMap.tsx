import { ChevronDownIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { ChatHistoryItem, ToolStatus } from "core";
import { useMemo, useState } from "react";
import { useAppSelector } from "../../redux/hooks";

export interface SubagentEntry {
  id: string;
  label: string;
  agent?: string;
  status: ToolStatus;
  detail?: string;
}

const SUBAGENT_TOOL = "run_subagent";

/** Every subagent the agent started in this chat, oldest first. */
export function collectSubagents(history: ChatHistoryItem[]): SubagentEntry[] {
  const entries: SubagentEntry[] = [];
  for (const item of history) {
    for (const state of item.toolCallStates ?? []) {
      if (state.toolCall.function.name !== SUBAGENT_TOOL) continue;
      const args = state.parsedArgs ?? {};
      entries.push({
        id: state.toolCallId,
        label: String(args.description ?? "Subagent").slice(0, 80),
        agent:
          typeof args.agent === "string" && args.agent ? args.agent : undefined,
        status: state.status,
        detail: state.output?.[0]?.description,
      });
    }
  }
  return entries;
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  generating: "starting",
  generated: "waiting for approval",
  calling: "working",
  done: "done",
  errored: "failed",
  canceled: "stopped",
};

function dotClass(status: ToolStatus): string {
  if (status === "done") return "bg-success";
  if (status === "errored") return "bg-error";
  if (status === "calling" || status === "generating") return "bg-accent";
  return "bg-description-muted";
}

/**
 * "Agents" strip above the input: lists the subagents started in this chat
 * with what each is doing, so parallel research is visible at a glance.
 * Hidden until the agent has started one.
 */
export function AgentMap() {
  const history = useAppSelector((state) => state.session.history);
  const entries = useMemo(() => collectSubagents(history), [history]);
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;

  const working = entries.filter(
    (entry) => entry.status === "calling" || entry.status === "generating",
  ).length;

  return (
    <div
      data-testid="agent-map"
      className="border-border bg-input mx-2 mb-1 rounded-md border border-solid text-xs"
    >
      <button
        type="button"
        className="text-description flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2 py-1"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <UserGroupIcon className="h-3 w-3" />
        <span>
          {entries.length} {entries.length === 1 ? "agent" : "agents"}
          {working > 0 ? ` · ${working} working` : ""}
        </span>
        <ChevronDownIcon
          className={`ml-auto h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <ul className="m-0 max-h-32 list-none space-y-0.5 overflow-y-auto px-2 pb-1.5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="text-foreground flex items-center gap-1.5"
              title={entry.detail}
            >
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass(entry.status)}`}
              />
              <span className="truncate">
                {entry.agent ? `${entry.agent}: ` : ""}
                {entry.label}
              </span>
              <span className="text-description-muted ml-auto flex-shrink-0">
                {STATUS_LABEL[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
