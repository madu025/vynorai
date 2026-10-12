import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { parseTodoArgs, TodoItem } from "core/tools/definitions/updateTodoList";

import { jobStartIndex } from "./agentProgress";
import { isFinishedEdit } from "./sideReview";

export const TODO_GATE_MARKER = "[todo-gate]";

/**
 * How often one prompt may be sent back to its own todo list. A build task
 * ended with 0 of 9 todos closed and parts missing; one reminder is not always
 * enough for a long list, and without a limit a model that never closes its
 * list would loop.
 */
export const MAX_TODO_GATES = 3;

/**
 * The agent's own todo items that are still open when it stops, taken from
 * the latest todo list of the current job. Undefined when the job has no
 * list, nothing is open, the limit of reminders is reached, or the last
 * reminder was answered without working on the list.
 *
 * The list is looked up over the whole job, so a list written before a pause
 * still counts after "Continue". The reminders are counted per prompt:
 * Continue starts them again, like the other counts.
 */
export function openTodoGate(
  history: ChatHistoryItem[],
): { open: TodoItem[]; total: number } | undefined {
  let promptStart = 0;
  let gates = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role !== "user") continue;
    if (!isAutoPrompt) {
      promptStart = i + 1;
      break;
    }
    const content = typeof message.content === "string" ? message.content : "";
    if (content.startsWith(TODO_GATE_MARKER)) gates++;
  }
  if (gates >= MAX_TODO_GATES) return undefined;
  // The model answered the last reminder in words: it has said why the items
  // stay open, and the same reminder again would get the same answer. Only
  // work on the list brings another: the list was updated, or a file was
  // edited. A read or a check made later for another prompt (the pre-mortem,
  // the verification gate) is not work on the list.
  if (gates > 0) {
    let acted = false;
    for (let i = history.length - 1; i >= promptStart; i--) {
      const { message, isAutoPrompt } = history[i];
      const content =
        typeof message.content === "string" ? message.content : "";
      if (isAutoPrompt && content.startsWith(TODO_GATE_MARKER)) break;
      if (
        (history[i].toolCallStates ?? []).some(
          (call) =>
            call.toolCall.function.name === BuiltInToolNames.UpdateTodoList ||
            isFinishedEdit(call),
        )
      )
        acted = true;
    }
    if (!acted) return undefined;
  }

  const start = jobStartIndex(history) + 1;
  for (let i = history.length - 1; i >= start; i--) {
    const calls = history[i].toolCallStates ?? [];
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j];
      if (
        call.toolCall.function.name !== BuiltInToolNames.UpdateTodoList ||
        call.status !== "done"
      ) {
        continue;
      }
      let todos: TodoItem[];
      try {
        todos = parseTodoArgs(call.parsedArgs);
      } catch {
        continue;
      }
      const open = todos.filter((t) => t.status !== "completed");
      return open.length > 0 ? { open, total: todos.length } : undefined;
    }
  }
  return undefined;
}

export function todoGatePrompt(open: TodoItem[], total: number): string {
  const shown = open
    .slice(0, 8)
    .map((t) => `- ${t.content}`)
    .join("\n");
  const more = open.length > 8 ? `\n- and ${open.length - 8} more` : "";
  return `${TODO_GATE_MARKER} You stopped, but ${open.length} of the ${total} items on your todo list are still open:
${shown}${more}

Carry on now and finish them; the task is not done until they are. Mark each item completed with update_todo_list when it is really done. If an item is already done, mark it. If one cannot be done, say exactly why instead of leaving it open.`;
}
