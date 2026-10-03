/**
 * Lifecycle hooks: user-defined shell commands that run at fixed points of a
 * turn. Semantics follow the Claude Code convention so existing hook scripts
 * work unchanged: exit 0 = allow (stdout may add context), exit 2 = block
 * (stderr is the reason), any other exit = non-blocking warning.
 */
export type HookEvent =
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop";

export const HOOK_EVENTS: HookEvent[] = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
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
