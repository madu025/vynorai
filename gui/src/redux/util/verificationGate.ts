import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import type { VerificationCommandCandidate } from "core/workspace/types";

import { editedFiles, isFinishedEdit } from "./sideReview";
import { classifyVerificationCommand, commandOf } from "./verificationEvidence";
import { verificationFailed } from "./verificationRepair";

export const VERIFICATION_GATE_MARKER = "[verification-gate]";

/** How often one prompt may be asked to check its edits. */
export const MAX_VERIFICATION_GATES = 3;

/**
 * Files edited since the latest real user prompt with no test, type check,
 * lint or build passing after the last edit. Returns undefined when the edits
 * are verified, there are none, the model was already asked about these edits
 * (it may decline in one line when no check applies), or the limit is
 * reached.
 *
 * The question is always "was there a check after the last edit". An earlier
 * automatic prompt of another kind (a repair prompt early in a long turn)
 * used to switch the gate off for every later edit of that turn.
 *
 * What a check is comes from classifyVerificationCommand, the same as for the
 * repair gate: with a list of its own this gate took `ls tests` and
 * `mkdir build` for checks, and was satisfied by runs (`node --test`) the
 * repair gate did not know, so a failing one got no repair prompt. A check
 * that failed verifies nothing; it is the repair gate's to follow up.
 */
export function unverifiedEdits(
  history: ChatHistoryItem[],
): { files: string[] } | undefined {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user" && !history[i].isAutoPrompt) {
      start = i + 1;
      break;
    }
  }

  // The edit calls not yet covered by a check.
  let edits: NonNullable<ChatHistoryItem["toolCallStates"]> = [];
  let verifiedSinceLastEdit = false;
  let askedSinceLastEdit = false;
  let gates = 0;
  for (const item of history.slice(start)) {
    const content = item.message.content;
    if (
      item.isAutoPrompt &&
      typeof content === "string" &&
      content.startsWith(VERIFICATION_GATE_MARKER)
    ) {
      gates++;
      askedSinceLastEdit = true;
    }
    for (const call of item.toolCallStates ?? []) {
      if (call.status !== "done") continue;
      if (isFinishedEdit(call)) {
        edits.push(call);
        verifiedSinceLastEdit = false;
        askedSinceLastEdit = false;
      } else if (
        call.toolCall.function.name === BuiltInToolNames.RunTerminalCommand &&
        classifyVerificationCommand(commandOf(call) ?? "") &&
        !verificationFailed(call)
      ) {
        verifiedSinceLastEdit = true;
        // What is left to verify starts again after a check.
        edits = [];
      }
    }
  }
  // One file is one file however its path was written.
  const { files, unnamed } = editedFiles(edits);
  if (unnamed > 0) files.push("a file");
  return files.length > 0 &&
    !verifiedSinceLastEdit &&
    !askedSinceLastEdit &&
    gates < MAX_VERIFICATION_GATES
    ? { files }
    : undefined;
}

export function verificationGatePrompt(
  files: string[],
  candidates: VerificationCommandCandidate[],
): string {
  const shown = files.slice(0, 5).join(", ");
  const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
  const commands = [...new Set(candidates.map((c) => c.command))].slice(0, 4);
  const detected = commands.length
    ? ` Detected checks: ${commands.map((c) => `\`${c}\``).join(", ")}.`
    : "";
  return `${VERIFICATION_GATE_MARKER} Before finishing: you changed ${shown}${more} but no test, type check, lint or build has passed since the last edit.${detected} Run the smallest relevant check now. If it fails, fix the cause and re-run. If no check applies to this change, say why in one line and finish.`;
}
