import { ChatHistoryItem, ContextItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

import {
  classifyVerificationCommand,
  commandFailed,
  commandOf,
} from "./verificationEvidence";

export const VERIFICATION_REPAIR_MARKER = "[verification-repair]";
const MAX_REPAIR_ATTEMPTS = 2;

export function verificationFailed(call: {
  status?: string;
  output?: ContextItem[];
}): boolean {
  return call.status === "errored" || commandFailed(call.output);
}

function outputExcerpt(output: ContextItem[] | undefined): string {
  return (output ?? [])
    .map((item) => `${item.description ?? ""}\n${item.content ?? ""}`.trim())
    .filter(Boolean)
    .join("\n")
    .slice(-1200);
}

export interface VerificationRepair {
  command: string;
  output: string;
  attempt: number;
  limitReached: boolean;
}

interface FailingCheck {
  /** History index where the current run of failures began. */
  since: number;
  /** History index of the latest failing run. */
  index: number;
  output: ContextItem[] | undefined;
}

/**
 * Checks (test, type check, lint, build) of the current prompt whose latest
 * run failed. A check that failed, was fixed and passed again is not in it.
 */
function failingChecks(history: ChatHistoryItem[]): Map<string, FailingCheck> {
  let start = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.message.role === "user" && !item.isAutoPrompt) {
      start = index + 1;
      break;
    }
  }

  const failing = new Map<string, FailingCheck>();
  for (let index = start; index < history.length; index++) {
    for (const call of history[index].toolCallStates ?? []) {
      const command = commandOf(call);
      if (
        call.toolCall.function.name !== BuiltInToolNames.RunTerminalCommand ||
        !command ||
        !classifyVerificationCommand(command)
      ) {
        continue;
      }
      if (!verificationFailed(call)) {
        failing.delete(command);
        continue;
      }
      failing.set(command, {
        since: failing.get(command)?.since ?? index,
        index,
        output: call.output,
      });
    }
  }
  return failing;
}

/**
 * Returns verification commands that failed and were not later rerun
 * successfully in the current user turn. Completion must never be journaled
 * as verified while this list is non-empty.
 */
export function unresolvedVerificationFailures(
  history: ChatHistoryItem[],
): string[] {
  return [...failingChecks(history).keys()];
}

/**
 * Returns a repair action when a check of the current prompt is still failing
 * and the model stopped without repairing it. A model may otherwise answer in
 * prose right after a failing test and imply that the task is complete.
 *
 * Only a check whose latest run failed counts: a build with six failures that
 * were all fixed used to get six "do not claim this is complete" prompts after
 * its tests had passed. One prompt is sent per new failure, so a text reply
 * to a prompt does not bring another. After MAX_REPAIR_ATTEMPTS prompts for
 * the same failing check the next one asks for a blocker report and is the
 * last.
 *
 * Every failing check gets its prompts, the most recent failure first. Only
 * the most recent one used to be looked at, so once it had its prompt an
 * older check that was still failing was never asked about.
 */
export function pendingVerificationRepair(
  history: ChatHistoryItem[],
): VerificationRepair | undefined {
  const newestFirst = [...failingChecks(history)].sort(
    (a, b) => b[1].index - a[1].index,
  );
  for (const [command, latest] of newestFirst) {
    const quoted = `\`${command}\``;
    const prompts: number[] = [];
    for (let index = latest.since; index < history.length; index++) {
      const item = history[index];
      if (
        item.isAutoPrompt &&
        typeof item.message.content === "string" &&
        item.message.content.startsWith(VERIFICATION_REPAIR_MARKER) &&
        item.message.content.includes(quoted)
      )
        prompts.push(index);
    }
    // Already asked about this failure, or the blocker report was requested.
    if (prompts.length > 0 && prompts.at(-1)! > latest.index) continue;
    if (prompts.length > MAX_REPAIR_ATTEMPTS) continue;
    return {
      command,
      output: outputExcerpt(latest.output),
      attempt: prompts.length + 1,
      limitReached: prompts.length >= MAX_REPAIR_ATTEMPTS,
    };
  }
  return undefined;
}

export function verificationRepairPrompt(repair: VerificationRepair): string {
  const evidence = repair.output
    ? `\nFailure evidence (tail):\n\`\`\`\n${repair.output}\n\`\`\``
    : "";
  if (repair.limitReached) {
    return `${VERIFICATION_REPAIR_MARKER} The verification command \`${repair.command}\` is still failing after ${MAX_REPAIR_ATTEMPTS} repair attempts. Do not claim this task is complete and do not repeat the command unchanged. Give a concise blocker report: failed command, observed error, files already changed, and the safest next action requiring the user's decision.${evidence}`;
  }
  return `${VERIFICATION_REPAIR_MARKER} Verification failed after your changes. Inspect the evidence, make one minimal repair, then re-run the same command \`${repair.command}\`. Do not claim completion until it passes. This is repair attempt ${repair.attempt} of ${MAX_REPAIR_ATTEMPTS}.${evidence}`;
}
