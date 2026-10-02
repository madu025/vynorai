import { describe, expect, it } from "vitest";

import {
  INITIAL_SESSION_STATE,
  sessionSlice,
  setActiveImplementationSubagentId,
  setActiveTaskId,
} from "./sessionSlice";

describe("implementation delegation session identity", () => {
  it("cannot activate a subagent without an active parent task", () => {
    const state = sessionSlice.reducer(
      INITIAL_SESSION_STATE,
      setActiveImplementationSubagentId("subagent-1"),
    );
    expect(state.activeImplementationSubagentId).toBeUndefined();
  });

  it("clears the subagent identity when the parent task changes", () => {
    let state = sessionSlice.reducer(
      INITIAL_SESSION_STATE,
      setActiveTaskId("task-1"),
    );
    state = sessionSlice.reducer(
      state,
      setActiveImplementationSubagentId("subagent-1"),
    );
    expect(state.activeImplementationSubagentId).toBe("subagent-1");
    state = sessionSlice.reducer(state, setActiveTaskId("task-2"));
    expect(state.activeImplementationSubagentId).toBeUndefined();
  });
});
