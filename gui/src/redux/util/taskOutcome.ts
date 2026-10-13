import type { ChatHistoryItem } from "core";
import type { IIdeMessenger } from "../../context/IdeMessenger";
import { PAUSE_MARKER } from "./agentProgress";
import { turnEdits } from "./sideReview";
import { STREAM_RECOVERY_MARKER } from "./streamRecovery";
import {
  unresolvedVerificationFailures,
  VERIFICATION_REPAIR_MARKER,
} from "./verificationRepair";
import type { TaskScope } from "./taskScope";

export type TaskOutcomeKind =
  | "completed"
  | "completed_unverified"
  | "stopped"
  | "budget"
  | "credit_cap"
  | "error"
  | "rewound";

export interface TaskOutcomeInfo {
  outcome: TaskOutcomeKind;
  mode?: string;
  rounds?: number;
  credits?: number | null;
  edited?: boolean;
  verified?: boolean;
  /** Why a paused task paused ("stalled", "same_failure", ...). */
  reason?: string;
  /** Verification-repair prompts sent in this prompt. */
  repairs?: number;
  /** Other automatic prompts (todo, completion, verification, pre-mortem). */
  gates?: number;
  /** Semantic scope class only; no user request content is reported. */
  scope?: TaskScope;
}

/**
 * How often the harness sent the agent back in the current prompt. A network
 * recovery is not a gate and is not counted.
 */
export function autoPromptCounts(history: ChatHistoryItem[]): {
  repairs: number;
  gates: number;
} {
  let repairs = 0;
  let gates = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role !== "user") continue;
    if (!isAutoPrompt) break;
    const content = typeof message.content === "string" ? message.content : "";
    if (content.startsWith(STREAM_RECOVERY_MARKER)) continue;
    if (content.startsWith(PAUSE_MARKER)) continue;
    if (content.startsWith(VERIFICATION_REPAIR_MARKER)) repairs++;
    else gates++;
  }
  return { repairs, gates };
}

/**
 * A task that ended with an answer: "completed" when nothing was edited or
 * every check passed, "completed_unverified" when files changed and a check
 * is still failing.
 */
export function finishedOutcome(history: ChatHistoryItem[]): {
  outcome: "completed" | "completed_unverified";
  edited: boolean;
  verified: boolean;
} {
  const edited = turnEdits(history).files.length > 0;
  const verified = unresolvedVerificationFailures(history).length === 0;
  return {
    outcome: edited && !verified ? "completed_unverified" : "completed",
    edited,
    verified,
  };
}

/**
 * Opt-in (the same switch as error reports). Sends counts and flags only: no
 * prompt, path, file name or code. Best effort; never throws.
 */
export function reportTaskOutcome(
  ideMessenger: Pick<IIdeMessenger, "post">,
  enabled: boolean | undefined,
  info: TaskOutcomeInfo,
): void {
  if (enabled !== true) return;
  try {
    ideMessenger.post("vynor/taskOutcome", {
      outcome: info.outcome,
      mode: info.mode,
      rounds: info.rounds,
      credits:
        typeof info.credits === "number" ? Math.round(info.credits) : null,
      edited: info.edited,
      verified: info.verified,
      reason: info.reason,
      repairs: info.repairs,
      gates: info.gates,
      scope: info.scope,
    });
  } catch {
    // Reporting must never affect the chat.
  }
}
