import type { ContextItem } from "core";
import type { HookPayload, HookRunResult } from "core/hooks/types";
import type { IIdeMessenger } from "../../context/IdeMessenger";

const NO_HOOKS: HookRunResult = { blocked: false, warnings: [], ran: 0 };
const TOOL_OUTPUT_LIMIT = 8_000;
// Core caps an individual hook at 120 seconds. Keep a small protocol margin,
// then fail open so a dead extension host cannot leave the chat streaming.
export const HOOK_REQUEST_TIMEOUT_MS = 125_000;

/**
 * Run lifecycle hooks in core. A hook runner failure never blocks the user's
 * work (same as a hook that crashes: a warning, not a block); hook warnings
 * are surfaced as a toast so a broken hook is not silently ignored.
 */
export async function runHooks(
  ideMessenger: IIdeMessenger,
  payload: HookPayload,
): Promise<HookRunResult> {
  let result = NO_HOOKS;
  try {
    const response = await ideMessenger.request(
      "hooks/run",
      payload,
      HOOK_REQUEST_TIMEOUT_MS,
    );
    if (response.status === "success") result = response.content;
  } catch {
    return NO_HOOKS;
  }
  if (result.warnings.length) {
    void ideMessenger.ide.showToast("warning", result.warnings.join("\n"));
  }
  return result;
}

/** Text of a tool result for PostToolUse hooks (truncated). */
export function toolOutputText(output: ContextItem[] | undefined): string {
  return (output ?? [])
    .map((item) => item.content)
    .join("\n\n")
    .slice(0, TOOL_OUTPUT_LIMIT);
}
