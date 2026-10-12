import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

export const COMPLETION_GATE_MARKER = "[completion-gate]";

const EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

/**
 * The model stopped with edits but no todo list for this prompt. It started
 * working without planning, so nothing tracks whether the job is complete.
 * Fires at most once; after that the model has a todo list and the todoGate
 * handles open items.
 *
 * Only fires when 2+ distinct files were edited — a single-file fix does not
 * need a formal plan, and forcing one adds an unnecessary round.
 */
export function missingTodoGate(history: ChatHistoryItem[]): boolean {
  let start = 0;
  let gateCount = 0;
  let hasTodo = false;
  const editedFiles = new Set<string>();

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user" && !history[i].isAutoPrompt) {
      start = i + 1;
      break;
    }
  }

  for (let i = start; i < history.length; i++) {
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
      const name = call.toolCall.function.name;
      if (name === BuiltInToolNames.UpdateTodoList) hasTodo = true;
      if (EDIT_TOOLS.has(name)) {
        const filepath = (call.parsedArgs as { filepath?: unknown })?.filepath;
        editedFiles.add(typeof filepath === "string" ? filepath : `anon-${i}`);
      }
    }
  }

  return !hasTodo && editedFiles.size >= 2 && gateCount === 0;
}

export function completionGatePrompt(userRequest: string): string {
  const shown =
    userRequest.length > 600 ? userRequest.slice(0, 600) + "…" : userRequest;
  return `${COMPLETION_GATE_MARKER} You started working but did not create a todo list. Review the full scope of the request and call update_todo_list now with every deliverable, then continue working.

The request:
${shown}

Mark items you already completed; leave the rest open and keep going.`;
}
