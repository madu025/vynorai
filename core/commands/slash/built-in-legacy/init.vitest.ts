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

  async function runInit(ide: any, extra: Record<string, unknown> = {}) {
    const mockLlm = {
      streamChat: vi.fn().mockImplementation(async function* () {
        yield { role: "assistant", content: "# Guide\n\nBody." };
      }),
    };
    const chunks: string[] = [];
    for await (const chunk of InitCommand.run({
      ide,
      llm: mockLlm as any,
      input: "/init",
      history: [],
      contextItems: [],
      params: undefined,
      addContextItem: vi.fn(),
      selectedCode: [],
      abortController: new AbortController(),
      ...extra,
    } as any)) {
      if (typeof chunk === "string") chunks.push(chunk);
    }
    return {
      text: chunks.join(""),
      prompt: mockLlm.streamChat.mock.calls[0]?.[0]?.[0]?.content as string,
    };
  }

  function multiRootIde(files: Record<string, string>, currentPath?: string) {
    const written = new Map<string, string>();
    return {
      written,
      ide: {
        getWorkspaceDirs: vi
          .fn()
          .mockResolvedValue(["file:///w/alpha", "file:///w/beta"]),
        getCurrentFile: vi
          .fn()
          .mockResolvedValue(
            currentPath
              ? { isUntitled: false, path: currentPath, contents: "" }
              : undefined,
          ),
        listDir: vi.fn().mockResolvedValue([]),
        fileExists: vi.fn().mockImplementation(async (u: string) => u in files),
        readFile: vi
          .fn()
          .mockImplementation(async (u: string) => files[u] ?? ""),
        writeFile: vi.fn().mockImplementation(async (u: string, c: string) => {
          written.set(u, c);
        }),
      },
    };
  }

  it("writes to the root of the open file in a multi-root workspace", async () => {
    const { ide, written } = multiRootIde({}, "file:///w/beta/src/b.ts");
    const { text } = await runInit(ide);
    expect(text).toContain("Project root: **beta**");
    expect([...written.keys()]).toEqual(["file:///w/beta/AGENTS.md"]);
  });

  it("honours the root the user pinned", async () => {
    const { ide, written } = multiRootIde({}, "file:///w/beta/src/b.ts");
    await runInit(ide, { activeWorkspaceDir: "file:///w/alpha" });
    expect([...written.keys()]).toEqual(["file:///w/alpha/AGENTS.md"]);
  });

  it("updates an existing CLAUDE.md in place instead of adding AGENTS.md", async () => {
    const { ide, written } = multiRootIde(
      { "file:///w/alpha/CLAUDE.md": "# Existing conventions" },
      "file:///w/alpha/a.ts",
    );
    const { text, prompt } = await runInit(ide);
    expect([...written.keys()]).toEqual(["file:///w/alpha/CLAUDE.md"]);
    expect(prompt).toContain("Existing conventions");
    expect(prompt).toContain("CLAUDE.md project memory guide");
    expect(text).toContain("**CLAUDE.md** successfully created");
  });
});
