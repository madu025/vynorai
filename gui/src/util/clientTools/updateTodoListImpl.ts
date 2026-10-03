import { parseTodoArgs } from "core/tools/definitions/updateTodoList";
import { ClientToolImpl } from "./callClientTool";

/**
 * The list itself is read back from this tool call's arguments in history
 * (selectTodos), so it survives reloads and rewinds without extra state.
 */
export const updateTodoListImpl: ClientToolImpl = async (args) => {
  const todos = parseTodoArgs(args);
  const done = todos.filter((todo) => todo.status === "completed").length;
  const current = todos.find((todo) => todo.status === "in_progress");
  const inProgress = todos.filter((todo) => todo.status === "in_progress");
  const notes = [
    `Todo list updated: ${done}/${todos.length} completed.`,
    current ? `In progress: ${current.content}` : "",
    inProgress.length > 1
      ? "Note: keep only one item in_progress at a time."
      : "",
    todos.length > 0 && done === todos.length
      ? "All items are completed; finish with a short summary of what was verified."
      : "",
  ].filter(Boolean);
  return {
    respondImmediately: true,
    output: [
      {
        name: "Todo list",
        description: `${done}/${todos.length} completed`,
        content: notes.join("\n"),
        icon: "list",
        hidden: true,
      },
    ],
  };
};
