import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

import { jobStartIndex } from "./agentProgress";
import { editedFiles } from "./sideReview";

export const COMPLETION_GATE_MARKER = "[completion-gate]";

/**
 * The model stopped with edits but no todo list for this job. It started
 * working without planning, so nothing tracks whether the job is complete.
 * Fires at most once; after that the model has a todo list and the todoGate
 * handles open items.
 *
 * Only fires when 2+ distinct files were edited — a single-file fix does not
 * need a formal plan, and forcing one adds an unnecessary round.
 *
 * Looked at over the whole job: after "Continue" the list written before the
 * pause is still the job's list, and no second plan is asked for.
 */
export function missingTodoGate(history: ChatHistoryItem[]): boolean {
  let gateCount = 0;
  let hasTodo = false;
  const calls: NonNullable<ChatHistoryItem["toolCallStates"]> = [];

  for (let i = jobStartIndex(history) + 1; i < history.length; i++) {
    const { message, isAutoPrompt } = history[i];

    if (
      isAutoPrompt &&
      typeof message.content === "string" &&
      message.content.startsWith(COMPLETION_GATE_MARKER)
    ) {
      gateCount++;
    }

    for (const call of history[i].toolCallStates ?? []) {
      if (call.status !== "done") continue;
      if (call.toolCall.function.name === BuiltInToolNames.UpdateTodoList)
        hasTodo = true;
      calls.push(call);
    }
  }

  // One file is one file however its path was written.
  const { files, unnamed } = editedFiles(calls);
  return !hasTodo && files.length + unnamed >= 2 && gateCount === 0;
}

export function completionGatePrompt(userRequest: string): string {
  const shown =
    userRequest.length > 600 ? userRequest.slice(0, 600) + "…" : userRequest;
  return `${COMPLETION_GATE_MARKER} You started working but did not create a todo list. Review the full scope of the request and call update_todo_list now with every deliverable, then continue working.

The request:
${shown}

Mark items you already completed; leave the rest open and keep going.`;
}
