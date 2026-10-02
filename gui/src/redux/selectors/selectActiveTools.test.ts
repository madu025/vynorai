import type { Tool } from "core";
import { describe, expect, test } from "vitest";
import { selectActiveTools } from "./selectActiveTools";

function tool(name: string, readonly: boolean): Tool {
  return {
    function: { name, description: name, parameters: {} },
    group: "built-in",
    readonly,
  } as Tool;
}

function state(mode: "chat" | "plan" | "agent") {
  return {
    session: { mode },
    config: {
      config: { tools: [tool("read_file", true), tool("write_file", false)] },
    },
    ui: { toolSettings: {}, toolGroupSettings: {} },
  } as any;
}

describe("selectActiveTools", () => {
  test("exposes only read-only inspection tools in chat mode", () => {
    expect(
      selectActiveTools(state("chat")).map((item) => item.function.name),
    ).toEqual(["read_file"]);
  });

  test("keeps mutating tools available in agent mode", () => {
    expect(selectActiveTools(state("agent"))).toHaveLength(2);
  });
});
