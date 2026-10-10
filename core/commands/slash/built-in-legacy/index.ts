import {
  SlashCommand,
  SlashCommandDescription,
  SlashCommandWithSource,
} from "../../..";
import GenerateTerminalCommand from "./cmd";
import CommitMessageCommand from "./commit";
import HttpSlashCommand from "./http";
import InitCommand from "./init";
import OnboardSlashCommand from "./onboard";
import ReviewCommand from "./review";
import ShareSlashCommand from "./share";
import SwarmCommand from "./swarm";
import GoalCommand from "./goal";
import { PanelSlashCommands } from "./panelCommands";
import { MemoryCommand, StatusCommand } from "./status";
import {
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
  CommitCommand,
  ErrorsCommand,
  ArchitectCommand,
} from "./vynorai-commands";

const LegacyBuiltInSlashCommands: SlashCommand[] = [
  // ── VynorAI Exclusive Commands (listed first) ──────────────────────────
  InitCommand,
  StatusCommand,
  MemoryCommand,
  ...PanelSlashCommands,
  GoalCommand,
  SwarmCommand,
  ReviewCommand,
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
  // ── Continue.dev Base Commands ─────────────────────────────────────────
  CommitMessageCommand,
  GenerateTerminalCommand,
  ShareSlashCommand,
  HttpSlashCommand,
  OnboardSlashCommand,
];

export function getLegacyBuiltInSlashCommandFromDescription(
  desc: SlashCommandDescription,
): SlashCommandWithSource | undefined {
  const cmd = LegacyBuiltInSlashCommands.find((cmd) => cmd.name === desc.name);
  if (!cmd) {
    return undefined;
  }
  return {
    ...cmd,
    params: desc.params,
    description: desc.description ?? cmd.description,
    source: "built-in-legacy",
  };
}

/**
 * Commands every config gets, whichever loader built it. The YAML loader (the
 * default) never resolves legacy names, so without this /goal, /fix, /explain
 * and the rest were only reachable from a hand-written config.json.
 * /swarm is left out on purpose: it creates worktrees and PRs and has not been
 * verified in the IDE. A name the user or another source already defined wins.
 */
const DEFAULT_LEGACY_COMMANDS: SlashCommand[] = [
  GoalCommand,
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  ReviewCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
  CommitCommand,
  ErrorsCommand,
  ArchitectCommand,
  GenerateTerminalCommand,
];

export function addDefaultLegacySlashCommands(
  slashCommands: SlashCommandWithSource[],
): void {
  for (const builtIn of DEFAULT_LEGACY_COMMANDS) {
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
