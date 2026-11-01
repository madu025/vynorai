/**
 * Lifecycle hooks: user-defined shell commands that run at fixed points of a
 * turn. Semantics follow the Claude Code convention so existing hook scripts
 * work unchanged: exit 0 = allow (stdout may add context), exit 2 = block
 * (stderr is the reason), any other exit = non-blocking warning.
 * SessionStart, PreCompact and SubagentStop cannot block: exit 2 is a warning.
 */
export type HookEvent =
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionStart"
  | "PreCompact"
  | "SubagentStop";

export const HOOK_EVENTS: HookEvent[] = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionStart",
  "PreCompact",
  "SubagentStop",
];

/**
 * Events whose exit code 2 never blocks anything: the action (starting a
 * session, compacting, finishing a subagent) always proceeds and the hook's
 * stderr is only reported as a warning.
 */
export const NON_BLOCKING_HOOK_EVENTS: readonly HookEvent[] = [
  "SessionStart",
  "PreCompact",
  "SubagentStop",
];

/** JSON sent to the hook on stdin. */
export interface HookPayload {
  event: HookEvent;
  sessionId?: string;
  /** UserPromptSubmit */
  prompt?: string;
  /** PreToolUse / PostToolUse */
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** PostToolUse: the tool's text output (truncated) */
  toolOutput?: string;
  toolError?: string;
  /** PreCompact: what started the compaction. */
  trigger?: "manual" | "auto";
  /** PreCompact: optional focus text from `/compact <instructions>`. */
  instructions?: string;
  /** SubagentStop: the subagent's tool-call id and kind ("explore" or a custom agent name). */
  subagentId?: string;
  subagentType?: string;
}

export interface HookRunResult {
  /** A hook exited with code 2. */
  blocked: boolean;
  /** stderr of the blocking hook. */
  reason?: string;
  /** stdout of successful hooks (UserPromptSubmit / PostToolUse feedback). */
  context?: string;
  /** Hooks that failed without blocking (non-zero exit, timeout, spawn error). */
  warnings: string[];
  /** Number of hook commands that ran. */
  ran: number;
}
