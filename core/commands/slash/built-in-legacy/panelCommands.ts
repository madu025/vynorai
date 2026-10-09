import type { SlashCommand, SlashCommandWithSource } from "../../../index.js";

/**
 * `/clear`, `/compact` and `/plan` act on the chat panel, which handles them
 * before a message is sent (gui/src/util/panelCommands.ts). The stubs exist so
 * the slash menu lists them; they only run if a client without that handling
 * sends them to the core.
 */
function panelOnly(name: string, description: string): SlashCommand {
  return {
    name,
    description,
    run: async function* () {
      yield `\`/${name}\` runs in the VynorAI chat panel. Type it in the panel's input box.`;
    },
  };
}

export const ClearCommand = panelOnly(
  "clear",
  "Start a new conversation (the current one stays in History)",
);
export const CompactCommand = panelOnly(
  "compact",
  "Summarize the conversation to free up context; add text to focus the summary",
);
export const PlanCommand = panelOnly(
  "plan",
  "Switch to Plan mode; add a task to start planning it",
);

/** `/help`: the commands available in this session, from the loaded config. */
export const HelpCommand: SlashCommand = {
  name: "help",
  description: "List the slash commands and how to use them",
  run: async function* ({ config }) {
    const commands = (config.slashCommands ?? [])
      .filter((command) => command.name !== "help")
      .sort((a, b) => a.name.localeCompare(b.name));
    yield [
      "**VynorAI commands**",
      "",
      ...commands.map((command) =>
        `- \`/${command.name}\`: ${command.description ?? ""}`.trimEnd(),
      ),
      "",
      "Type `/` in the input box to open this list. `@` adds files, folders and other context.",
    ].join("\n");
  },
};

/** Registered by doLoadConfig next to /status and /memory. */
export function addPanelSlashCommands(
  slashCommands: SlashCommandWithSource[],
): void {
  for (const builtIn of [
    HelpCommand,
    ClearCommand,
    CompactCommand,
    PlanCommand,
  ]) {
    if (!slashCommands.some((cmd) => cmd.name === builtIn.name)) {
      slashCommands.push({
        name: builtIn.name,
        description: builtIn.description,
        source: "built-in-legacy",
        run: builtIn.run,
      });
    }
  }
}
