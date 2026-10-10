import {
  SlashCommand,
  SlashCommandDescription,
  SlashCommandWithSource,
} from "../../..";
import GenerateTerminalCommand from "./cmd";
import HttpSlashCommand from "./http";
import InitCommand from "./init";
import OnboardSlashCommand from "./onboard";
import ShareSlashCommand from "./share";
import SwarmCommand from "./swarm";
import GoalCommand from "./goal";
import { AGENT_PROMPT_COMMANDS } from "../agentPromptCommands";
import { PanelSlashCommands } from "./panelCommands";
import { MemoryCommand, StatusCommand } from "./status";

const LegacyBuiltInSlashCommands: SlashCommand[] = [
  // ── VynorAI Exclusive Commands (listed first) ──────────────────────────
  InitCommand,
  StatusCommand,
  MemoryCommand,
  ...PanelSlashCommands,
  GoalCommand,
  SwarmCommand,
  // ── Continue.dev Base Commands ─────────────────────────────────────────
  GenerateTerminalCommand,
  ShareSlashCommand,
  HttpSlashCommand,
  OnboardSlashCommand,
];

export function getLegacyBuiltInSlashCommandFromDescription(
  desc: SlashCommandDescription,
): SlashCommandWithSource | undefined {
  const prompt = AGENT_PROMPT_COMMANDS.find((c) => c.name === desc.name);
  if (prompt) {
    return {
      name: prompt.name,
      description: desc.description ?? prompt.description,
      prompt: prompt.prompt,
      params: desc.params,
      source: "built-in-legacy",
    } as SlashCommandWithSource;
  }
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
