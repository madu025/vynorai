import { ChatHistoryItem, ContextItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

import { classifyVerificationCommand } from "./verificationEvidence";

export const VERIFICATION_REPAIR_MARKER = "[verification-repair]";
const MAX_REPAIR_ATTEMPTS = 2;

function commandOf(args: unknown): string | undefined {
  const command = (args as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : undefined;
}

function failedOutput(output: ContextItem[] | undefined): boolean {
  return Boolean(
    output?.some((item) =>
      /(?:command failed|timed out|exit code [1-9]\d*|\bfailed\b)/i.test(
        `${item.status ?? ""}\n${item.description ?? ""}\n${item.content ?? ""}`,
      ),
    ),
  );
}

function verificationFailed(call: {
  status?: string;
  output?: ContextItem[];
}): boolean {
  return call.status === "errored" || failedOutput(call.output);
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

/**
 * Returns verification commands that failed and were not later rerun
 * successfully in the current user turn. Completion must never be journaled
 * as verified while this list is non-empty.
 */
export function unresolvedVerificationFailures(
  history: ChatHistoryItem[],
): string[] {
  let start = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.message.role === "user" && !item.isAutoPrompt) {
      start = index + 1;
      break;
    }
  }

  const latestStatus = new Map<string, boolean>();
  for (const item of history.slice(start)) {
    for (const call of item.toolCallStates ?? []) {
      const command = commandOf(call.processedArgs ?? call.parsedArgs);
      if (
        call.toolCall.function.name !== BuiltInToolNames.RunTerminalCommand ||
        !command ||
        !classifyVerificationCommand(command)
      ) {
        continue;
      }
      latestStatus.set(command, verificationFailed(call));
    }
  }
  return [...latestStatus].flatMap(([command, failed]) =>
    failed ? [command] : [],
  );
}

/**
 * Returns a bounded repair action when the latest relevant verification command
 * failed. A model may otherwise answer in prose immediately after a failing
 * test and falsely imply that the coding task is complete.
 */
export function pendingVerificationRepair(
  history: ChatHistoryItem[],
): VerificationRepair | undefined {
  let start = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    if (item.message.role === "user" && !item.isAutoPrompt) {
      start = index + 1;
      break;
    }
  }

  const turn = history.slice(start);
  const repairPrompts = turn.filter(
    (item) =>
      item.isAutoPrompt &&
      typeof item.message.content === "string" &&
      item.message.content.startsWith(VERIFICATION_REPAIR_MARKER),
  ).length;
  const checks = turn.flatMap((item) =>
    (item.toolCallStates ?? []).map((call) => ({
      call,
      command: commandOf(call.processedArgs ?? call.parsedArgs),
    })),
  );
  const failed = checks.filter(
    ({ call, command }) =>
      call.toolCall.function.name === BuiltInToolNames.RunTerminalCommand &&
      Boolean(command && classifyVerificationCommand(command)) &&
      verificationFailed(call),
  );
  const latest = failed.at(-1);
  if (!latest?.command) return undefined;

  // One automatic prompt per failure. The last prompt tells the model to stop
  // only after the repair budget is exhausted, so it cannot spin forever.
  if (repairPrompts >= failed.length) return undefined;
  return {
    command: latest.command,
    output: outputExcerpt(latest.call.output),
    attempt: failed.length,
    limitReached: failed.length >= MAX_REPAIR_ATTEMPTS,
  };
}

export function verificationRepairPrompt(repair: VerificationRepair): string {
  const evidence = repair.output
    ? `\nFailure evidence (tail):\n\`\`\`\n${repair.output}\n\`\`\``
    : "";
  if (repair.limitReached) {
    return `${VERIFICATION_REPAIR_MARKER} The verification command \`${repair.command}\` has failed ${repair.attempt} times. Do not claim this task is complete and do not repeat the command unchanged. Give a concise blocker report: failed command, observed error, files already changed, and the safest next action requiring the user's decision.${evidence}`;
  }
  return `${VERIFICATION_REPAIR_MARKER} Verification failed after your changes. Inspect the evidence, make one minimal repair, then re-run the same command \`${repair.command}\`. Do not claim completion until it passes. This is repair attempt ${repair.attempt} of ${MAX_REPAIR_ATTEMPTS}.${evidence}`;
}
