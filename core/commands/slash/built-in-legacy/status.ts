import type {
  RuleWithSource,
  SlashCommand,
  SlashCommandWithSource,
} from "../../../index.js";
import { GlobalContext } from "../../../util/GlobalContext.js";
import { findUriInDirs, getUriPathBasename } from "../../../util/uri.js";
import { resolveActiveWorkspaceDir } from "../../../workspace/activeRoot.js";

/** Path shown to the user: workspace-relative, never an absolute local path. */
function displayPath(sourceFile: string | undefined, dirs: string[]): string {
  if (!sourceFile) return "(built in)";
  const { relativePathOrBasename, foundInDir } = findUriInDirs(
    sourceFile,
    dirs,
  );
  return foundInDir
    ? relativePathOrBasename
    : `${getUriPathBasename(sourceFile)} (global)`;
}

/**
 * Why indexing is off. A "disableIndexing" saved in the shared settings
 * (Settings > Indexing, or a value migrated from an old config.json) overrides
 * config.yaml and config.json, so editing those files does not turn it back on.
 */
function indexOffReason(): string {
  try {
    if (new GlobalContext().getSharedConfig().disableIndexing) {
      return " (turned off in the shared settings: Settings > Indexing, or sharedConfig.disableIndexing in index/globalContext.json in the VynorAI folder; config.yaml and config.json do not override it)";
    }
  } catch {
    // unreadable settings: no extra detail
  }
  return " (config sets disableIndexing)";
}

const SOURCE_LABELS: Array<[RuleWithSource["source"], string]> = [
  ["agentFile", "Project instruction files (always applied)"],
  [
    "colocated-markdown",
    "Directory-scoped rules (nested AGENTS.md, CLAUDE.md, rules.md)",
  ],
  ["rules-block", "Rule files (.vynorai/rules, .continue/rules)"],
  [".continuerules", ".continuerules"],
];

/**
 * `/status`: where the agent is working and what it has loaded. Deterministic
 * and local: no model call, no absolute paths in the output.
 */
export const StatusCommand: SlashCommand = {
  name: "status",
  description: "Show the active project, model, index and loaded instructions",
  run: async function* ({ ide, config, activeWorkspaceDir }) {
    const dirs = (await ide.getWorkspaceDirs()) ?? [];
    if (dirs.length === 0) {
      yield "**VynorAI status**\n\n- Workspace: no folder is open. Open a project folder first.";
      return;
    }

    const activeDir = await resolveActiveWorkspaceDir(ide, activeWorkspaceDir);
    const nameOf = (dir: string) => getUriPathBasename(dir) || "workspace";
    const branch = activeDir
      ? await ide.getBranch(activeDir).catch(() => "")
      : "";
    const trusted = ide.isWorkspaceTrusted
      ? await ide.isWorkspaceTrusted().catch(() => false)
      : undefined;
    const model = config.selectedModelByRole?.chat;
    const rules = config.rules ?? [];
    const instructionFiles = rules.filter(
      (rule) =>
        rule.source === "agentFile" || rule.source === "colocated-markdown",
    ).length;

    const lines = [
      "**VynorAI status**",
      "",
      `- Active project: **${activeDir ? nameOf(activeDir) : "none"}**${branch ? ` (branch \`${branch}\`)` : ""}`,
    ];
    if (dirs.length > 1) {
      lines.push(`- Open roots: ${dirs.map((dir) => nameOf(dir)).join(", ")}`);
    }
    if (trusted !== undefined) {
      lines.push(
        `- Workspace trust: ${trusted ? "trusted" : "restricted (edits and commands are blocked)"}`,
      );
    }
    lines.push(
      `- Chat model: ${model?.title ?? model?.model ?? "not selected"}`,
      `- Codebase index: ${config.disableIndexing ? `disabled${indexOffReason()}` : "enabled"}`,
      `- Instruction files loaded: ${instructionFiles} (run /memory to list them)`,
    );
    yield lines.join("\n");
  },
};

/** `/memory`: which instruction and rule files are in effect, with sizes. */
export const MemoryCommand: SlashCommand = {
  name: "memory",
  description: "List the instruction files and rules the agent has loaded",
  run: async function* ({ ide, config }) {
    const dirs = (await ide.getWorkspaceDirs()) ?? [];
    const rules = (config.rules ?? []).filter((rule) => rule.sourceFile);

    if (rules.length === 0) {
      yield "**Loaded instructions**\n\nNo AGENTS.md, CLAUDE.md or rule files are loaded. Run /init to create one for this project.";
      return;
    }

    const lines = ["**Loaded instructions**"];
    for (const [source, label] of SOURCE_LABELS) {
      const group = rules.filter((rule) => rule.source === source);
      if (group.length === 0) continue;
      lines.push("", `**${label}**`);
      for (const rule of group) {
        const scope = rule.globs
          ? ` (applies to ${[rule.globs].flat().join(", ")})`
          : "";
        lines.push(
          `- \`${displayPath(rule.sourceFile, dirs)}\`${scope}, ${rule.rule.length} characters`,
        );
      }
    }
    lines.push(
      "",
      "Edit these files to change how the agent works in this project.",
    );
    yield lines.join("\n");
  },
};

/** Registered by doLoadConfig, the same way as /init. */
export const statusSlashCommand: SlashCommandWithSource = {
  name: StatusCommand.name,
  description: StatusCommand.description,
  source: "built-in-legacy",
  run: StatusCommand.run,
};

export const memorySlashCommand: SlashCommandWithSource = {
  name: MemoryCommand.name,
  description: MemoryCommand.description,
  source: "built-in-legacy",
  run: MemoryCommand.run,
};

/**
 * Adds /status and /memory unless the user's own config already defines a
 * command with that name.
 */
export function addInfoSlashCommands(
  slashCommands: SlashCommandWithSource[],
): void {
  for (const builtIn of [statusSlashCommand, memorySlashCommand]) {
    if (!slashCommands.some((cmd) => cmd.name === builtIn.name)) {
      slashCommands.push(builtIn);
    }
  }
}
