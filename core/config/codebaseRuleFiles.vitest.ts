import { describe, expect, it } from "vitest";

import { isNestedAgentInstructionFile } from "../llm/rules/constants";
import {
  isCodebaseRuleSourceFile,
  isColocatedRulesFile,
} from "./loadLocalAssistants";

describe("codebase rule source files", () => {
  it("tracks rules.md and agent files, but deletion stays limited to rules.md", () => {
    expect(isCodebaseRuleSourceFile("file:///w/a/rules.md")).toBe(true);
    expect(isCodebaseRuleSourceFile("file:///w/a/AGENTS.md")).toBe(true);
    expect(isCodebaseRuleSourceFile("file:///w/a/AGENT.md")).toBe(true);
    expect(isCodebaseRuleSourceFile("file:///w/a/CLAUDE.md")).toBe(true);
    expect(isCodebaseRuleSourceFile("file:///w/a/README.md")).toBe(false);

    // config/deleteRule must not start allowing deletion of arbitrary agent files
    expect(isColocatedRulesFile("file:///w/a/rules.md")).toBe(true);
    expect(isColocatedRulesFile("file:///w/a/AGENTS.md")).toBe(false);
  });

  it("treats only agent files below the root as nested", () => {
    expect(isNestedAgentInstructionFile("AGENTS.md", "AGENTS.md")).toBe(false);
    expect(isNestedAgentInstructionFile("CLAUDE.md", "pkg/CLAUDE.md")).toBe(
      true,
    );
    expect(isNestedAgentInstructionFile("rules.md", "pkg/rules.md")).toBe(
      false,
    );
    expect(isNestedAgentInstructionFile("notes.md", "pkg/notes.md")).toBe(
      false,
    );
  });
});
