import { describe, expect, it, vi } from "vitest";
import { SwarmCommand } from "./swarm";

describe("SwarmCommand", () => {
  it("has correct command name and description", () => {
    expect(SwarmCommand.name).toBe("swarm");
    expect(SwarmCommand.description).toContain("maintenance swarm");
  });

  it("yields a warning if no workspace directory is found", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue([]),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: {} as any,
      input: "/swarm",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    }

    expect(chunks.join("")).toContain("No active workspace directory found");
  });

  it("checks for existing briefings when invoked with status flag", async () => {
    const today = new Date().toISOString().split("T")[0];
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      readFile: vi.fn().mockImplementation(async (uri: string) => {
        if (uri.includes(`briefing-${today}.md`)) {
          return "# Existing Morning Briefing\nAll systems operational.";
        }
        throw new Error("File not found");
      }),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: {} as any,
      input: "/swarm status",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    }

    const output = chunks.join("");
    expect(output).toContain("Checking latest maintenance briefing reports");
    expect(output).toContain("Existing Morning Briefing");
    expect(output).toContain("All systems operational");
  });

  it("executes proactive maintenance cycle and generates morning briefing", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      readFile: vi.fn().mockImplementation(async (uri: string) => {
        if (uri.endsWith("package.json")) {
          return JSON.stringify({
            name: "sample-repo",
            dependencies: { lodash: "4.17.20" },
          });
        }
        throw new Error("File not found");
      }),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: {} as any,
      input: "/swarm run",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    }

    const output = chunks.join("");
    expect(output).toContain("Autonomous Maintenance Swarm");
    expect(output).toContain("package.json");
    expect(output).toContain("Git worktree isolation engine initialized");
    expect(output).toContain("VynorAI Self-Driving Maintenance Briefing");
    expect(output).toContain("Pull Requests Ready for Review");
  });

  it("yields git repository required message if workspace is not a git repo", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///tmp/non-git-dir"]),
      readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: {} as any,
      input: "/swarm run",
      history: [],
      contextItems: [],
      params: { skipGitCheckForTesting: false },
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    }

    const output = chunks.join("");
    expect(output).toContain("Git Repository Required");
    expect(output).toContain("git init");
  });

  it("enforces Pro subscription gate when unauthenticated or free tier", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of SwarmCommand.run({
      ide: mockIde as any,
      llm: { apiKey: "" } as any,
      input: "/swarm",
      history: [],
      contextItems: [],
      params: { testAuthGate: true },
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController,
    } as any)) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
      }
    }

    const output = chunks.join("");
    expect(output).toContain("VynorAI Pro Feature Required");
    expect(output).toContain("**Pro** and **Ultra** plan subscribers");
  });
});
