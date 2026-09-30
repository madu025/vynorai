import {
  SlashCommand,
  SlashCommandDescription,
  SlashCommandWithSource,
} from "../../..";
import GenerateTerminalCommand from "./cmd";
import CommitMessageCommand from "./commit";
import HttpSlashCommand from "./http";
import OnboardSlashCommand from "./onboard";
import ReviewMessageCommand from "./review";
import ShareSlashCommand from "./share";
import {
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  ReviewCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
} from "./vynorai-commands";

const LegacyBuiltInSlashCommands: SlashCommand[] = [
  // ── VynorAI Exclusive Commands (listed first) ──────────────────────────
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  ReviewCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
  // ── Continue.dev Base Commands ─────────────────────────────────────────
  CommitMessageCommand,
  GenerateTerminalCommand,
  ShareSlashCommand,
  HttpSlashCommand,
  OnboardSlashCommand,
  ReviewMessageCommand,
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
