import { createSelector } from "@reduxjs/toolkit";
import { BuiltInToolNames } from "core/tools/builtIn";
import { parseTodoArgs, TodoItem } from "core/tools/definitions/updateTodoList";
import { RootState } from "../store";

/**
 * The agent's current todo list: the arguments of the latest successful
 * `update_todo_list` call. Deriving it from history keeps it correct after
 * session reloads, rewinds and compaction without separate state.
 */
export const selectTodos = createSelector(
  [(state: RootState) => state.session.history],
  (history): TodoItem[] => {
    for (let i = history.length - 1; i >= 0; i--) {
      const calls = history[i].toolCallStates ?? [];
      for (let j = calls.length - 1; j >= 0; j--) {
        const call = calls[j];
        if (
          call.toolCall.function.name !== BuiltInToolNames.UpdateTodoList ||
          call.status !== "done"
        ) {
          continue;
        }
        try {
          return parseTodoArgs(call.parsedArgs);
        } catch {
          continue;
        }
      }
    }
    return [];
  },
);
