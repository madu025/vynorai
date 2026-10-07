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
import {
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
} from "./vynorai-commands";

const LegacyBuiltInSlashCommands: SlashCommand[] = [
  // ── VynorAI Exclusive Commands (listed first) ──────────────────────────
  InitCommand,
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
