import { describe, expect, it, vi } from "vitest";
import { ReviewCommand } from "./review";

describe("ReviewCommand", () => {
  it("has correct command name and description", () => {
    expect(ReviewCommand.name).toBe("review");
    expect(ReviewCommand.description).toContain("git diff");
  });

  it("yields a helpful guidance message when no diff or file is detected", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      getDiff: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    };
    const mockLlm = {
      streamChat: vi.fn(),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of ReviewCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/review",
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
    expect(output).toContain("No code changes detected to review");
    expect(mockLlm.streamChat).not.toHaveBeenCalled();
  });

  it("extracts working git diff and streams senior staff review findings", async () => {
    const sampleDiff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,4 @@
+const token = req.query.token; // Insecure GET token`;

    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      getDiff: vi.fn().mockResolvedValue([sampleDiff]),
      readFile: vi.fn(),
    };

    const mockLlm = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield {
          role: "assistant",
          content:
            "### Review Findings\n[CRITICAL] Insecure GET token query parameter",
        };
      }),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of ReviewCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/review",
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
    expect(output).toContain("Deep Code Review");
    expect(output).toContain("Working Git Changes");
    expect(output).toContain("Insecure GET token query parameter");
    expect(mockLlm.streamChat).toHaveBeenCalledTimes(1);
  });

  it("reviews a specific file when a path argument is provided", async () => {
    const fileContent =
      "export function dangerousExec(cmd: string) { eval(cmd); }";

    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace/repo"]),
      getDiff: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(fileContent),
    };

    const mockLlm = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield {
          role: "assistant",
          content: "[CRITICAL] eval() usage found in dangerousExec",
        };
      }),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of ReviewCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/review src/exec.ts",
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
    expect(output).toContain("File: `src/exec.ts`");
    expect(output).toContain("eval() usage found");
    expect(mockIde.readFile).toHaveBeenCalled();
  });
});
