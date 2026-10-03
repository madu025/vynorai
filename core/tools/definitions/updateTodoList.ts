import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];
export interface TodoItem {
  content: string;
  status: TodoStatus;
}
export const MAX_TODOS = 30;
const MAX_TODO_LENGTH = 200;

/** Validates `update_todo_list` arguments; throws a message the model can act on. */
export function parseTodoArgs(args: unknown): TodoItem[] {
  let todos = (args as { todos?: unknown } | undefined)?.todos;
  // Some models send the array as a JSON string.
  if (typeof todos === "string") {
    try {
      todos = JSON.parse(todos);
    } catch {
      throw new Error("`todos` must be an array of {content, status}");
    }
  }
  if (!Array.isArray(todos)) {
    throw new Error("`todos` must be an array of {content, status}");
  }
  if (todos.length > MAX_TODOS) {
    throw new Error(`Keep the todo list to ${MAX_TODOS} items or fewer`);
  }
  return todos.map((item, index) => {
    const content =
      typeof item?.content === "string" ? item.content.trim() : "";
    if (!content) throw new Error(`Todo ${index + 1} has no content`);
    if (!TODO_STATUSES.includes(item.status)) {
      throw new Error(
        `Todo ${index + 1} status must be one of ${TODO_STATUSES.join(", ")}`,
      );
    }
    return {
      content: content.slice(0, MAX_TODO_LENGTH),
      status: item.status as TodoStatus,
    };
  });
}

export const updateTodoListTool: Tool = {
  type: "function",
  displayTitle: "Update Todo List",
  wouldLikeTo: "update the todo list",
  isCurrently: "updating the todo list",
  hasAlready: "updated the todo list",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.UpdateTodoList,
    description: `Track progress on multi-step work. The user sees this list live.
Use it when a task needs 3 or more distinct steps or touches several files. Skip it for single, simple changes and for questions.
- Send the whole list every time; it replaces the previous one.
- Write each item as a concrete action ("Add retry to fetchUser in api/user.ts"), not a vague goal.
- Keep exactly one item in_progress while working. Mark an item completed right after finishing it, not in batches.
- Only mark an item completed when it is fully done and verified; if tests fail or work is partial, keep it in_progress and add an item for the blocker.
- Add items when you discover new required work; remove items that are no longer relevant.`,
    parameters: {
      type: "object",
      required: ["todos"],
      properties: {
        todos: {
          type: "array",
          description: "The complete, ordered todo list",
          items: {
            type: "object",
            required: ["content", "status"],
            properties: {
              content: {
                type: "string",
                description: "Concrete action, imperative form",
              },
              status: {
                type: "string",
                enum: [...TODO_STATUSES],
              },
            },
          },
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To track multi-step work (3+ steps), use the ${BuiltInToolNames.UpdateTodoList} tool with the complete list each time. Keep one item in_progress and mark items completed as soon as they are done and verified.`,
    exampleArgs: [
      [
        "todos",
        '[{"content":"Add input validation to createUser","status":"in_progress"},{"content":"Run the user service tests","status":"pending"}]',
      ],
    ],
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "ListBulletIcon",
};
