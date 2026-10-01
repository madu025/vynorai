import { BuiltInToolNames } from "../tools/builtIn";
import type { ToolRisk } from "./types";

const READ_ONLY = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadFileRange,
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.GrepSearch,
  BuiltInToolNames.FileGlobSearch,
  BuiltInToolNames.ViewDiff,
  BuiltInToolNames.LSTool,
  BuiltInToolNames.CodebaseTool,
  BuiltInToolNames.ViewRepoMap,
  BuiltInToolNames.ViewSubdirectory,
]);

const WORKSPACE_WRITES = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

export function classifyToolRisk(toolName: string): ToolRisk {
  if (READ_ONLY.has(toolName)) return "R0";
  if (WORKSPACE_WRITES.has(toolName)) return "R2";
  if (
    toolName === BuiltInToolNames.RunTerminalCommand ||
    toolName === BuiltInToolNames.CreateRuleBlock
  ) {
    return "R3";
  }
  return "R1";
}
