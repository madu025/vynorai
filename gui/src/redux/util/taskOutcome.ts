import type { ChatHistoryItem } from "core";
import type { IIdeMessenger } from "../../context/IdeMessenger";
import { turnEdits } from "./sideReview";
import { unresolvedVerificationFailures } from "./verificationRepair";

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
    });
  } catch {
    // Reporting must never affect the chat.
  }
}
