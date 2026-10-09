import { describe, expect, it } from "vitest";
import type { Skill } from "../..";
import { skillSlashCommands } from "./skillSlashCommands";

const skill = (name: string, description = "does a thing"): Skill => ({
  name,
  description,
  path: `.claude/skills/${name}/SKILL.md`,
  content: "SECRET BODY",
  files: [],
  permissions: [],
  trust: "workspace-untrusted",
  digest: "x",
});

describe("skillSlashCommands", () => {
  it("makes one command per skill that asks the agent to read the skill", () => {
    const [command] = skillSlashCommands([skill("vynor-release")], []);
    expect(command.name).toBe("vynor-release");
    expect(command.prompt).toContain("read_skill");
    expect(command.prompt).toContain("vynor-release");
    // the skill body is never pasted into the chat
    expect(command.prompt).not.toContain("SECRET BODY");
    expect(command.sourceFile).toContain("SKILL.md");
  });

  it("never replaces an existing command, whatever its letter case", () => {
    const commands = skillSlashCommands(
      [skill("Status"), skill("deploy"), skill("deploy")],
      ["status"],
    );
    expect(commands.map((c) => c.name)).toEqual(["deploy"]);
  });
});
