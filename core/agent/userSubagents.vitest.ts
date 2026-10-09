import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "../tools/builtIn";
import {
  buildUserSubagentSystemMessage,
  parseSubagentFile,
} from "./userSubagents";

const file = (frontmatter: string, body = "You review code.") =>
  `---\n${frontmatter}\n---\n${body}\n`;

describe("parseSubagentFile", () => {
  it("reads name, description, prompt and Claude-style tool names", () => {
    const agent = parseSubagentFile(
      file(
        "name: sec-reviewer\ndescription: Reviews auth code\ntools: Read, Grep, Glob",
      ),
      ".claude/agents/sec.md",
      "workspace",
    );
    expect("error" in agent).toBe(false);
    if ("error" in agent) return;
    expect(agent.name).toBe("sec-reviewer");
    expect(agent.prompt).toBe("You review code.");
    expect(agent.tools).toEqual(
      expect.arrayContaining([
        BuiltInToolNames.ReadFile,
        BuiltInToolNames.GrepSearch,
        BuiltInToolNames.FileGlobSearch,
      ]),
    );
    expect(agent.tools).not.toContain(BuiltInToolNames.LSTool);
    expect(agent.ignoredTools).toEqual([]);
  });

  it("never grants editing or command tools, whatever the file asks for", () => {
    const agent = parseSubagentFile(
      file("name: rogue\ndescription: tries\ntools: [Bash, Edit, Write, Read]"),
      "x.md",
      "workspace",
    );
    if ("error" in agent) throw new Error(agent.error);
    expect(agent.ignoredTools.sort()).toEqual(["Bash", "Edit", "Write"]);
    expect(agent.tools).not.toContain(BuiltInToolNames.RunTerminalCommand);
    expect(agent.tools).not.toContain(BuiltInToolNames.EditExistingFile);
    expect(agent.tools).toContain(BuiltInToolNames.ReadFile);
  });

  it("falls back to the read-only set when only forbidden tools are requested", () => {
    const agent = parseSubagentFile(
      file("name: only-bash\ndescription: d\ntools: Bash"),
      "x.md",
      "user",
    );
    if ("error" in agent) throw new Error(agent.error);
    expect(agent.tools.length).toBeGreaterThan(0);
    expect(agent.tools).not.toContain(BuiltInToolNames.RunTerminalCommand);
  });

  it("rejects bad names, missing description and empty prompts", () => {
    expect(
      parseSubagentFile(file("name: Bad Name\ndescription: d"), "a.md", "user"),
    ).toHaveProperty("error");
    expect(
      parseSubagentFile(file("name: ok-name"), "b.md", "user"),
    ).toHaveProperty("error");
    expect(
      parseSubagentFile(file("name: ok\ndescription: d", ""), "c.md", "user"),
    ).toHaveProperty("error");
  });
});

describe("buildUserSubagentSystemMessage", () => {
  it("keeps the user's prompt and adds the read-only rules", () => {
    const agent = parseSubagentFile(
      file("name: a\ndescription: d", "Look for N+1 queries."),
      "a.md",
      "user",
    );
    if ("error" in agent) throw new Error(agent.error);
    const message = buildUserSubagentSystemMessage(agent);
    expect(message).toContain("Look for N+1 queries.");
    expect(message).toContain("cannot edit files, run commands");
  });
});
