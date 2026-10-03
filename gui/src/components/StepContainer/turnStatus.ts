import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";

export type TurnPhase =
  | "working"
  | "context"
  | "thinking"
  | "writing"
  | "tool"
  | "approval";

export interface TurnStatus {
  phase: TurnPhase;
  /** What is actually happening, e.g. "Editing src/auth.ts". */
  label: string;
  /** Rough count of streamed tokens this turn (chars / 4). */
  tokens: number;
}

const EXPLORE_TOOLS = new Set([
  "read_file",
  "read_file_range",
  "read_currently_open_file",
  "ls",
  "file_glob_search",
  "grep_search",
  "view_repo_map",
  "view_subdirectory",
  "codebase",
  "view_diff",
]);
const EDIT_TOOLS = new Set([
  "edit_existing_file",
  "single_find_and_replace",
  "multi_edit",
  "create_new_file",
]);

function toolLabel(
  name: string,
  args: Record<string, unknown> | undefined,
): string {
  const target = typeof args?.filepath === "string" ? ` ${args.filepath}` : "";
  if (EDIT_TOOLS.has(name)) return `Editing${target}`;
  if (EXPLORE_TOOLS.has(name))
    return target ? `Reading${target}` : "Exploring the project";
  if (name === "run_terminal_command") return "Running a command";
  if (name === "search_web" || name === "fetch_url_content")
    return "Searching the web";
  return "Using tools";
}

/** Items produced since the latest user message (the turn in progress). */
export function currentTurn(history: ChatHistoryItem[]): ChatHistoryItem[] {
  let start = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") break;
    start = i;
  }
  return history.slice(start);
}

/** True when any part of the turn ending at `index` streamed reasoning. */
export function turnUsedThinking(
  history: ChatHistoryItem[],
  index: number,
): boolean {
  for (let i = index; i >= 0; i--) {
    const item = history[i];
    if (item.message.role === "user") return false;
    if (
      item.message.role === "thinking" &&
      renderChatMessage(item.message).trim()
    )
      return true;
    if (item.reasoning?.text?.trim()) return true;
  }
  return false;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Derive the live status line from real session state only: stream flag,
 * reasoning stream, streamed content and tool-call states. Returns null when
 * nothing is running and nothing is waiting on the user.
 */
export function deriveTurnStatus(
  history: ChatHistoryItem[],
  isStreaming: boolean,
): TurnStatus | null {
  const turn = currentTurn(history);
  const last = turn[turn.length - 1];

  let chars = 0;
  for (const item of turn) {
    chars += item.reasoning?.text?.length ?? 0;
    chars += renderChatMessage(item.message).length;
    for (const state of item.toolCallStates ?? []) {
      chars += state.toolCall.function.arguments?.length ?? 0;
    }
  }
  const tokens = Math.ceil(chars / 4);

  const pending = last?.toolCallStates?.find((s) => s.status === "generated");
  if (pending) {
    return { phase: "approval", label: "Waiting for your approval", tokens };
  }
  if (!isStreaming) return null;

  const calling = last?.toolCallStates?.find((s) => s.status === "calling");
  if (calling) {
    return {
      phase: "tool",
      label: toolLabel(calling.toolCall.function.name, calling.parsedArgs),
      tokens,
    };
  }
  if (last?.toolCallStates?.some((s) => s.status === "generating")) {
    return { phase: "tool", label: "Preparing a tool call", tokens };
  }
  if (last?.isGatheringContext) {
    return { phase: "context", label: "Gathering context", tokens };
  }
  const streamingThought =
    last?.message.role === "thinking" &&
    renderChatMessage(last.message).trim() !== "";
  if (last?.reasoning?.active || streamingThought) {
    return { phase: "thinking", label: "Thinking", tokens };
  }
  if (
    last?.message.role === "assistant" &&
    renderChatMessage(last.message).trim()
  ) {
    return { phase: "writing", label: "Writing", tokens };
  }
  // Request sent: routing + waiting for the first token. Not "thinking".
  return { phase: "working", label: "Working", tokens };
}
