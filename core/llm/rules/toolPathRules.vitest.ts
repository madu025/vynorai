import { describe, expect, it } from "vitest";

import { RuleWithSource } from "../..";
import { getApplicableRules } from "./getSystemMessageWithRules";

const backendRule: RuleWithSource = {
  name: "backend-zod",
  rule: "Validate every request body with zod.",
  source: "rules-block",
  globs: "backend/**/*.ts",
  sourceFile: "file:///repo/.vynorai/rules/backend.md",
};

describe("rules scoped to files the agent touched through tools", () => {
  it("applies a glob rule when a tool read or edited a matching file", () => {
    expect(getApplicableRules(undefined, [backendRule], [])).toEqual([]);
    expect(
      getApplicableRules(undefined, [backendRule], [], {}, [
        "backend/src/routes/auth.ts",
      ]).map((r) => r.name),
    ).toEqual(["backend-zod"]);
    expect(
      getApplicableRules(undefined, [backendRule], [], {}, ["gui/src/App.tsx"]),
    ).toEqual([]);
  });

  it("treats rules in .vynorai/ like .continue/ (root level, glob-scoped)", () => {
    const global = { ...backendRule, name: "global", globs: undefined };
    expect(
      getApplicableRules(undefined, [global], []).map((r) => r.name),
    ).toEqual(["global"]);
  });
});
