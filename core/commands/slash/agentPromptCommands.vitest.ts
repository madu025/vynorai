import { describe, expect, it } from "vitest";
import { SlashCommandWithSource } from "../..";
import {
  AGENT_PROMPT_COMMANDS,
  addAgentPromptSlashCommands,
} from "./agentPromptCommands";
import { getLegacyBuiltInSlashCommandFromDescription } from "./built-in-legacy";

describe("agent prompt slash commands", () => {
  it("registers each task shortcut once, as a prompt (agent turn, tools kept)", () => {
    const list: SlashCommandWithSource[] = [];
    addAgentPromptSlashCommands(list);
    const names = list.map((c) => c.name);
    for (const n of [
      "fix",
      "explain",
      "test",
      "refactor",
      "docs",
      "review",
      "security",
      "optimize",
      "scaffold",
      "commit",
    ]) {
      expect(names).toContain(n);
    }
    expect(new Set(names).size).toBe(names.length);
    expect(list.every((c) => Boolean(c.prompt) && !("run" in c && c.run))).toBe(
      true,
    );
    // not a duplicate of plan/goal/architect/errors/swarm
    for (const n of ["errors", "architect", "goal", "swarm", "plan"]) {
      expect(names).not.toContain(n);
    }
  });

  it("prompts are template-safe (no handlebars braces) and tell the agent to verify", () => {
    for (const c of AGENT_PROMPT_COMMANDS) {
      expect(c.prompt).not.toMatch(/\{\{|\}\}/);
    }
    const fix = AGENT_PROMPT_COMMANDS.find((c) => c.name === "fix")!;
    expect(fix.prompt).toContain("get_diagnostics");
  });

  it("keeps a command the user already defined and is idempotent", () => {
    const mine: SlashCommandWithSource = {
      name: "fix",
      description: "mine",
      source: "yaml-prompt-block",
      prompt: "mine",
    };
    const list = [mine];
    addAgentPromptSlashCommands(list);
    const count = list.length;
    addAgentPromptSlashCommands(list);
    expect(list.length).toBe(count);
    expect(list.find((c) => c.name === "fix")).toBe(mine);
  });

  it("a config.json that names /review still resolves to the same prompt", () => {
    const cmd = getLegacyBuiltInSlashCommandFromDescription({
      name: "review",
      description: "",
    } as any);
    expect(cmd?.prompt).toContain("git diff");
  });
});
