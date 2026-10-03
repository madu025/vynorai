import { describe, expect, it } from "vitest";

import { MAX_TODOS, parseTodoArgs } from "./updateTodoList";

describe("parseTodoArgs", () => {
  it("accepts a valid list and trims content", () => {
    expect(
      parseTodoArgs({
        todos: [
          { content: "  Add retry to fetchUser ", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
    ).toEqual([
      { content: "Add retry to fetchUser", status: "in_progress" },
      { content: "Run tests", status: "pending" },
    ]);
  });

  it("accepts the array sent as a JSON string", () => {
    expect(
      parseTodoArgs({ todos: '[{"content":"A","status":"completed"}]' }),
    ).toEqual([{ content: "A", status: "completed" }]);
  });

  it("rejects bad input with a message the model can act on", () => {
    expect(() => parseTodoArgs({})).toThrow("must be an array");
    expect(() =>
      parseTodoArgs({ todos: [{ content: "A", status: "done" }] }),
    ).toThrow("Todo 1 status must be one of pending, in_progress, completed");
    expect(() =>
      parseTodoArgs({ todos: [{ content: " ", status: "pending" }] }),
    ).toThrow("Todo 1 has no content");
    expect(() =>
      parseTodoArgs({
        todos: Array.from({ length: MAX_TODOS + 1 }, () => ({
          content: "x",
          status: "pending",
        })),
      }),
    ).toThrow(`${MAX_TODOS} items or fewer`);
  });
});
