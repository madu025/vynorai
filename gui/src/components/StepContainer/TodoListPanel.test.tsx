import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import { selectTodos } from "../../redux/selectors/selectTodos";
import { updateTodoListImpl } from "../../util/clientTools/updateTodoListImpl";
import { createMockStore } from "../../util/test/mockStore";
import { TodoListPanel } from "./TodoListPanel";

function todoCall(id: string, todos: unknown, status = "done") {
  return {
    toolCallId: id,
    status,
    parsedArgs: { todos },
    toolCall: {
      id,
      type: "function",
      function: {
        name: "update_todo_list",
        arguments: JSON.stringify({ todos }),
      },
    },
  };
}

function storeWith(toolCallStates: unknown[], isStreaming = true) {
  const store = createMockStore();
  const root = store.getState() as any;
  return createMockStore({
    ...root,
    session: {
      ...root.session,
      isStreaming,
      history: [
        {
          message: { id: "u1", role: "user", content: "refactor auth" },
          contextItems: [],
        },
        {
          message: { id: "a1", role: "assistant", content: "" },
          contextItems: [],
          toolCallStates,
        },
      ],
    },
  });
}

const twoSteps = [
  { content: "Extract token parsing", status: "completed" },
  { content: "Update callers", status: "in_progress" },
];

describe("selectTodos", () => {
  it("uses the latest successful update and ignores failed ones", () => {
    const store = storeWith([
      todoCall("t1", twoSteps),
      todoCall(
        "t2",
        [{ content: "Never shown", status: "pending" }],
        "errored",
      ),
    ]);
    expect(selectTodos(store.getState() as any)).toEqual(twoSteps);
  });
});

describe("TodoListPanel", () => {
  it("shows progress and items while the agent works", () => {
    render(
      <Provider store={storeWith([todoCall("t1", twoSteps)])}>
        <TodoListPanel />
      </Provider>,
    );
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("Update callers")).toBeTruthy();
  });

  it("hides once every item is completed and the turn ended", () => {
    const allDone = twoSteps.map((todo) => ({ ...todo, status: "completed" }));
    render(
      <Provider store={storeWith([todoCall("t1", allDone)], false)}>
        <TodoListPanel />
      </Provider>,
    );
    expect(screen.queryByTestId("todo-list-panel")).toBeNull();
  });
});

describe("updateTodoListImpl", () => {
  it("summarizes progress for the model", async () => {
    const result = await updateTodoListImpl(
      { todos: twoSteps },
      "t1",
      {} as any,
    );
    expect(result.output?.[0].content).toContain("1/2 completed");
    expect(result.output?.[0].content).toContain("In progress: Update callers");
  });

  it("rejects invalid statuses", async () => {
    await expect(
      updateTodoListImpl(
        { todos: [{ content: "A", status: "doing" }] },
        "t1",
        {} as any,
      ),
    ).rejects.toThrow("status must be one of");
  });
});
