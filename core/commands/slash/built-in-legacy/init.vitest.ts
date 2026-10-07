import { describe, expect, it, vi } from "vitest";

import { InitCommand } from "./init";

describe("InitCommand", () => {
  it("has correct command name and description", () => {
    expect(InitCommand.name).toBe("init");
    expect(InitCommand.description).toContain("AGENTS.md");
  });

  it("yields a warning if no workspace directory is found", async () => {
    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue([]),
    };
    const mockLlm = {
      streamChat: vi.fn(),
    };
    const abortController = new AbortController();

    const chunks: string[] = [];
    for await (const chunk of InitCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/init",
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
    expect(mockLlm.streamChat).not.toHaveBeenCalled();
  });

  it("gathers manifests, streams LLM output, and writes AGENTS.md to workspace root", async () => {
    const workspacePath = "file:///workspace/test-repo";
    const writtenFiles = new Map<string, string>();

    const mockIde = {
      getWorkspaceDirs: vi.fn().mockResolvedValue([workspacePath]),
      listDir: vi.fn().mockResolvedValue([
        [`${workspacePath}/src`, 2],
        [`${workspacePath}/package.json`, 1],
      ]),
      fileExists: vi.fn().mockImplementation(async (uri: string) => {
        return uri.endsWith("package.json");
      }),
      readFile: vi.fn().mockImplementation(async (uri: string) => {
        if (uri.endsWith("package.json")) {
          return JSON.stringify({
            name: "test-app",
            scripts: { build: "tsc", test: "vitest run" },
          });
        }
        return "";
      }),
      writeFile: vi
        .fn()
        .mockImplementation(async (path: string, content: string) => {
          writtenFiles.set(path, content);
        }),
    };

    const generatedMarkdown = `# Project Memory & Agent Guidelines

## 1. Overview & Architecture
Test application for VynorAI.

## 2. Essential Commands
- Build: \`npm run build\`
- Test: \`npm test\`

## 3. Verification & Testing Rules
Always verify code changes before completing.`;

    const mockLlm = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield { role: "assistant", content: "```markdown\n" };
        yield { role: "assistant", content: generatedMarkdown };
        yield { role: "assistant", content: "\n```" };
      }),
    };

    const abortController = new AbortController();
    const chunks: string[] = [];

    for await (const chunk of InitCommand.run({
      ide: mockIde as any,
      llm: mockLlm as any,
      input: "/init",
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

    const outputText = chunks.join("");
    expect(outputText).toContain("Analyzing workspace architecture");
    expect(outputText).toContain("AGENTS.md** successfully created and saved");

    // Verify writeFile was called with AGENTS.md path
    const agentsPath = `${workspacePath}/AGENTS.md`;
    expect(writtenFiles.has(agentsPath)).toBe(true);
    const savedContent = writtenFiles.get(agentsPath);
    expect(savedContent).toContain("# Project Memory & Agent Guidelines");
    expect(savedContent).toContain("Essential Commands");
    expect(savedContent?.startsWith("```")).toBe(false);
  });
});
