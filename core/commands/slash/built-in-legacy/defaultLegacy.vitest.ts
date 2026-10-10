import { describe, expect, it } from "vitest";
import { SlashCommandWithSource } from "../../..";
import { addDefaultLegacySlashCommands } from ".";

describe("addDefaultLegacySlashCommands", () => {
  it("adds the VynorAI commands, but never /swarm", () => {
    const list: SlashCommandWithSource[] = [];
    addDefaultLegacySlashCommands(list);
    const names = list.map((c) => c.name);
    for (const n of ["goal", "fix", "explain", "test", "review", "commit"]) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("swarm");
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps a command the user already defined and is idempotent", () => {
    const mine: SlashCommandWithSource = {
      name: "fix",
      description: "mine",
      source: "yaml-prompt-block",
      run: async function* () {},
    };
    const list = [mine];
    addDefaultLegacySlashCommands(list);
    const count = list.length;
    addDefaultLegacySlashCommands(list);
    expect(list.length).toBe(count);
    expect(list.find((c) => c.name === "fix")).toBe(mine);
  });
});
