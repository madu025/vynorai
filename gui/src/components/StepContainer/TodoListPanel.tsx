import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useAppSelector } from "../../redux/hooks";
import { selectTodos } from "../../redux/selectors/selectTodos";

const MARK = { completed: "☒", in_progress: "◼", pending: "☐" } as const;

/**
 * The agent's live todo list (from `update_todo_list`). Visible while the
 * agent works or while items remain, so a paused task shows what is left.
 */
export function TodoListPanel() {
  const todos = useAppSelector(selectTodos);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [open, setOpen] = useState(true);

  const done = todos.filter((todo) => todo.status === "completed").length;
  if (todos.length === 0 || (!isStreaming && done === todos.length)) {
    return null;
  }

  return (
    <div
      className="border-command-border bg-editor mx-2 mb-1 rounded-md border border-solid px-2 py-1 text-[11px]"
      data-testid="todo-list-panel"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-description flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px]"
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3" />
        ) : (
          <ChevronRightIcon className="h-3 w-3" />
        )}
        <span className="font-semibold">Todos</span>
        <span className="text-description-muted">
          {done}/{todos.length}
        </span>
      </button>
      {open && (
        <ul className="m-0 mt-1 max-h-40 list-none overflow-y-auto p-0">
          {todos.map((todo, index) => (
            <li
              key={`${index}-${todo.content}`}
              className={`flex min-w-0 gap-1.5 py-[1px] ${
                todo.status === "completed"
                  ? "text-description-muted line-through"
                  : todo.status === "in_progress"
                    ? "text-foreground font-semibold"
                    : "text-description"
              }`}
            >
              <span aria-label={todo.status} className="shrink-0">
                {MARK[todo.status]}
              </span>
              <span className="min-w-0 break-words">{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
