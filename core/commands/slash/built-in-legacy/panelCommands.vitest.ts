import { describe, expect, it } from "vitest";
import type { SlashCommandWithSource } from "../../../index.js";
import { addPanelSlashCommands, HelpCommand } from "./panelCommands";

describe("panel slash commands", () => {
  it("are added once and never replace a command the user defined", () => {
    const custom: SlashCommandWithSource = {
      name: "plan",
      description: "my own plan",
      source: "json-custom-command",
    };
    const commands = [custom];
    addPanelSlashCommands(commands);
    addPanelSlashCommands(commands);
    expect(commands.map((c) => c.name).sort()).toEqual([
      "clear",
      "compact",
      "cost",
      "help",
      "model",
      "plan",
      "resume",
      "rewind",
    ]);
    expect(commands.find((c) => c.name === "plan")).toBe(custom);
  });

  it("/help lists the loaded commands with their descriptions", async () => {
    const out: string[] = [];
    for await (const chunk of HelpCommand.run({
      config: {
        slashCommands: [
          {
            name: "status",
            description: "Show status",
            source: "built-in-legacy",
          },
          { name: "help", description: "self", source: "built-in-legacy" },
        ],
      },
    } as any)) {
      out.push(chunk ?? "");
    }
    const text = out.join("");
    expect(text).toContain("`/status`: Show status");
    expect(text).not.toContain("`/help`");
  });
});
