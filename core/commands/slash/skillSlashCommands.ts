import type { Skill, SlashCommandWithSource } from "../..";

/**
 * One slash command per skill (`/<skill-name>`), like Claude Code. The command
 * does not paste the skill into the chat: it asks the agent to read it with
 * read_skill, so the skill's trust label and declared permissions still apply.
 * A name that is already a command is left alone.
 */
export function skillSlashCommands(
  skills: Skill[],
  takenNames: Iterable<string>,
): SlashCommandWithSource[] {
  const taken = new Set([...takenNames].map((name) => name.toLowerCase()));
  const commands: SlashCommandWithSource[] = [];
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    commands.push({
      name: skill.name,
      description: skill.description.slice(0, 200),
      prompt: `Use the skill "${skill.name}" for this task: read it with the read_skill tool first, then follow it.`,
      source: "invokable-rule",
      sourceFile: skill.path,
    });
  }
  return commands;
}
