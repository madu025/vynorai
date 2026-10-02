import { describe, expect, it } from "vitest";

import { BuiltInToolNames } from "../tools/builtIn";
import { classifyDelegatedToolCall } from "./SubagentToolPolicy";

describe("delegated tool policy", () => {
  it("maps file reads and writes to explicit resources", () => {
    expect(
      classifyDelegatedToolCall(BuiltInToolNames.ReadFile, {
        filepath: "core/agent/types.ts",
      }),
    ).toEqual({ capability: "read", resource: "core/agent/types.ts" });
    expect(
      classifyDelegatedToolCall(BuiltInToolNames.MultiEdit, {
        filepath: "gui/src/App.tsx",
      }),
    ).toEqual({ capability: "write", resource: "gui/src/App.tsx" });
  });

  it("requires whole-workspace scope for implicit repository reads", () => {
    expect(
      classifyDelegatedToolCall(BuiltInToolNames.GrepSearch, { query: "x" }),
    ).toEqual({ capability: "read", resource: "." });
  });

  it("maps browser and web operations to network authority", () => {
    expect(
      classifyDelegatedToolCall(BuiltInToolNames.BrowserQa, {
        url: "http://localhost:3000",
      }),
    ).toEqual({ capability: "network" });
  });

  it("fails closed for terminal and unknown/MCP tools", () => {
    expect(() =>
      classifyDelegatedToolCall(BuiltInToolNames.RunTerminalCommand, {
        command: "npm test",
      }),
    ).toThrow("blocked until the sandbox enforces");
    expect(() => classifyDelegatedToolCall("mcp_arbitrary", {})).toThrow(
      "not approved",
    );
  });
});
