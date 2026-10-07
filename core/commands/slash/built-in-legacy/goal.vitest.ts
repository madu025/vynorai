import { describe, expect, it, vi } from "vitest";
import { GoalCommand } from "./goal";

describe("GoalCommand", () => {
  it("has correct command name and description", () => {
    expect(GoalCommand.name).toBe("goal");
    expect(GoalCommand.description).toContain("long-running");
  });

  it("yields helpful usage instructions when no goal argument is provided", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue([]),
    };
    const mockLlm = { streamChat: vi.fn() };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of GoalCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/goal",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") chunks.push(chunk);
    }

    const output = chunks.join("");
    expect(output).toContain("Autonomous Goal Mode");
    expect(output).toContain("Examples:");
    expect(mockLlm.streamChat).not.toHaveBeenCalled();
  });

  it("activates goal orchestrator and streams milestone breakdown", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
    };
    const mockLlm = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield {
          role: "assistant",
          content:
            "### Milestone 1: Setup Models\n### Milestone 2: Implement Stripe",
        };
      }),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of GoalCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/goal Build complete billing system with Stripe",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") chunks.push(chunk);
    }

    const output = chunks.join("");
    expect(output).toContain("Goal Orchestrator");
    expect(output).toContain("Build complete billing system with Stripe");
    expect(output).toContain("Milestone 1: Setup Models");
    expect(output).toContain("Goal Plan Formulated");
    expect(mockLlm.streamChat).toHaveBeenCalled();
  });
});
