import { describe, expect, it } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { streamUpdate } from "../../redux/slices/sessionSlice";

// Real reducers, no mocks: the proxy's "served model" note must end up on the
// assistant message the user sees, not get lost with the empty first chunk.
describe("served model metadata", () => {
  it("is kept on the assistant message when the first chunk carries no text", () => {
    const root = getEmptyRootState();
    const store = createMockStore({
      session: {
        ...root.session,
        isStreaming: true,
        history: [
          {
            message: { role: "user", content: "hi", id: "u1" },
            contextItems: [],
          },
        ] as any,
      },
    });
    store.dispatch(
      streamUpdate([
        {
          role: "assistant",
          content: "",
          metadata: {
            vynorServed: { model: "deepseek/deepseek-v4-pro", tier: "heavy" },
          },
        } as any,
      ]),
    );
    store.dispatch(
      streamUpdate([{ role: "assistant", content: "Hello there." } as any]),
    );
    const history = (store.getState() as any).session.history;
    const last = history[history.length - 1].message;
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Hello there.");
    expect(last.metadata.vynorServed).toEqual({
      model: "deepseek/deepseek-v4-pro",
      tier: "heavy",
    });
  });
});
