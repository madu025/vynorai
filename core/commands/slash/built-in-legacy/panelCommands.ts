import { loadUserSubagents } from "../../../agent/userSubagents.js";
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

export const ResumeCommand = panelOnly(
  "resume",
  "Open the history of earlier conversations",
);
export const RewindCommand = panelOnly(
  "rewind",
  "Undo the last prompt: restore the files it changed and remove it from the chat",
);
export const ModelCommand = panelOnly(
  "model",
  "Show the chat models, or switch with /model <name>",
);
export const CostCommand = panelOnly(
  "cost",
  "Show the credits used by this chat and this month",
);

export const PermissionsCommand = panelOnly(
  "permissions",
  "Show or change when the agent asks before editing or running commands",
);

/** `/agents`: the custom subagents the agent can start, and files that failed to load. */
export const AgentsCommand: SlashCommand = {
  name: "agents",
  description: "List the custom subagents (.claude/agents, .vynorai/agents)",
  run: async function* ({ ide }) {
    const { agents, errors } = await loadUserSubagents(ide);
    const lines = ["**Custom agents**", ""];
    if (agents.length === 0) {
      lines.push(
        "None found. Add a markdown file such as `.claude/agents/reviewer.md` or `.vynorai/agents/reviewer.md`:",
        "",
        "```",
        "---",
        "name: reviewer",
        "description: Reviews code for bugs. Use after a change.",
        "tools: Read, Grep, Glob",
        "---",
        "Your instructions for this agent...",
        "```",
      );
    }
    for (const agent of agents) {
      const ignored = agent.ignoredTools.length
        ? ` (read-only: ${agent.ignoredTools.join(", ")} not available)`
        : "";
      lines.push(
        `- \`${agent.name}\` (${agent.scope}, \`${agent.path}\`): ${agent.description}${ignored}`,
      );
    }
    if (errors.length) {
      lines.push("", "Not loaded:", ...errors.map((error) => `- ${error}`));
    }
    lines.push(
      "",
      "Custom agents are read-only: they can search and read the project, not edit files or run commands. Changes to these files reach the agent's tool list on the next config reload (reload the window).",
    );
    yield lines.join("\n");
  },
};

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

/** Every command in this file; the one list both registration paths use. */
export const PanelSlashCommands: SlashCommand[] = [
  HelpCommand,
  ClearCommand,
  CompactCommand,
  PlanCommand,
  ResumeCommand,
  RewindCommand,
  ModelCommand,
  CostCommand,
  PermissionsCommand,
  AgentsCommand,
];

/** Registered by doLoadConfig next to /status and /memory. */
export function addPanelSlashCommands(
  slashCommands: SlashCommandWithSource[],
): void {
  for (const builtIn of PanelSlashCommands) {
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
