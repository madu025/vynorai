import type { JSONContent } from "@tiptap/core";
import { processEditorContent } from "../components/mainInput/TipTapEditor/utils/processEditorContent";
import { editorText } from "./editorText";

/**
 * Slash commands that act on the chat panel itself (new session, compaction,
 * plan mode) instead of asking the model. They are typed in the composer like
 * any other command, so the menu lists them (core registers a stub for each)
 * and the panel handles them before anything is sent.
 */
export type PanelCommandName = "clear" | "compact" | "plan";

export interface PanelCommand {
  name: PanelCommandName;
  arg: string;
}

const PANEL_COMMAND = /^\/(clear|compact|plan)(?:\s+(.*))?$/i;

export function parsePanelCommand(text: string): PanelCommand | undefined {
  const match = PANEL_COMMAND.exec(text.trim());
  if (!match) return undefined;
  return {
    name: match[1].toLowerCase() as PanelCommandName,
    arg: (match[2] ?? "").trim(),
  };
}

/**
 * The command typed in the composer. Picking a command from the slash menu
 * puts it in a prompt block (its name) with the rest of the line as text, so
 * both forms are read here.
 */
export function panelCommandFromEditor(
  editorState: JSONContent,
): PanelCommand | undefined {
  const { slashCommandName, parts } = processEditorContent(editorState);
  if (!slashCommandName) return parsePanelCommand(editorText(editorState));
  const rest = parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
  return parsePanelCommand(`/${slashCommandName} ${rest}`);
}
