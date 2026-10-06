import { describe, expect, it, vi } from "vitest";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { createMockStore } from "../../util/test/mockStore";
import { saveCurrentSession } from "./session";

describe("session title persistence", () => {
  it("persists the generated title for a completed new session", async () => {
    const base = createMockStore().getState() as any;
    const generatedTitle = "Fix workspace recovery";
    const store = createMockStore({
      ...base,
      config: {
        ...base.config,
        config: {
          ...base.config.config,
          selectedModelByRole: {
            ...base.config.config.selectedModelByRole,
            chat: { title: "VynorAI Auto" },
          },
        },
      },
      session: {
        ...base.session,
        id: "session-title-test",
        title: NEW_SESSION_TITLE,
        history: [
          {
            message: { role: "assistant", content: "Completed response" },
            contextItems: [],
          },
        ],
      },
    });
    store.mockIdeMessenger.responses["chatDescriber/describe"] = generatedTitle;
    const requestSpy = vi.spyOn(store.mockIdeMessenger, "request");

    await (store.dispatch as any)(
      saveCurrentSession({ openNewSession: false, generateTitle: true }),
    );

    const saveCall = requestSpy.mock.calls.find(
      ([messageType]) => messageType === "history/save",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        sessionId: "session-title-test",
        title: generatedTitle,
      }),
    );
  });
});
