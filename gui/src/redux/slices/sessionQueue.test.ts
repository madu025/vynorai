import reducer, {
  enqueueInput,
  removeQueuedInput,
} from "./sessionSlice";

const editorState = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "next" }] }],
};

test("bounds queued prompts and preserves FIFO order", () => {
  let state = reducer(undefined, { type: "init" });
  for (let index = 0; index < 12; index++) {
    state = reducer(
      state,
      enqueueInput({
        id: `${index}`,
        editorState,
        modifiers: { useCodebase: false, noContext: false },
        createdAt: index,
      }),
    );
  }

  expect(state.queuedInputs).toHaveLength(10);
  expect(state.queuedInputs?.[0].id).toBe("2");
  expect(state.queuedInputs?.at(-1)?.id).toBe("11");
});

test("removes only the selected queued prompt", () => {
  let state = reducer(undefined, { type: "init" });
  for (const id of ["first", "second"]) {
    state = reducer(
      state,
      enqueueInput({
        id,
        editorState,
        modifiers: { useCodebase: false, noContext: false },
        createdAt: 1,
      }),
    );
  }

  state = reducer(state, removeQueuedInput("first"));
  expect(state.queuedInputs?.map((item) => item.id)).toEqual(["second"]);
});
