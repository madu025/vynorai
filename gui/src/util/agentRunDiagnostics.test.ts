import { describe, expect, it } from "vitest";
import { diagnoseAgentRun } from "./agentRunDiagnostics";

describe("diagnoseAgentRun", () => {
  it("flags repeated exploration and a nearly exhausted task cap", () => {
    expect(
      diagnoseAgentRun(
        { read_file: 10, grep_search: 4, multi_edit: 2 },
        90,
        100,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "repeated_tool_use" }),
        expect.objectContaining({ code: "exploration_heavy" }),
        expect.objectContaining({ code: "credit_cap_near" }),
      ]),
    );
  });

  it("does not flag a short, focused run", () => {
    expect(diagnoseAgentRun({ read_file: 2, multi_edit: 1 }, 20, 100)).toEqual(
      [],
    );
  });
});
