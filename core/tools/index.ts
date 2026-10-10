import { ConfigDependentToolParams, Tool } from "..";
import { isRecommendedAgentModel } from "../llm/toolSupport";
import * as toolDefinitions from "./definitions";

// Every tool's schema rides on every request, so the list stays lean:
// read_currently_open_file (read_file covers it) and the rule tools (off by
// default) were removed.
// I'm writing these as functions because we've messed up 3 TIMES by pushing to const, causing duplicate tool definitions on subsequent config loads.
export const getBaseToolDefinitions = () => [
  toolDefinitions.readFileTool,
  toolDefinitions.createNewFileTool,
  toolDefinitions.runTerminalCommandTool,
  toolDefinitions.globSearchTool,
  toolDefinitions.viewDiffTool,
  toolDefinitions.lsTool,
  toolDefinitions.fetchUrlContentTool,
  // Persistent, live browser (replaces the one-shot browser_qa report).
  toolDefinitions.browserTool,
  toolDefinitions.updateTodoListTool,
  toolDefinitions.getDiagnosticsTool,
];

export const getConfigDependentToolDefinitions = async (
  params: ConfigDependentToolParams,
): Promise<Tool[]> => {
  const { modelName, enableExperimentalTools, indexingEnabled, isRemote } =
    params;
  const tools: Tool[] = [];

  tools.push(await toolDefinitions.readSkillTool(params));

  // Lists the user's custom agents (.claude/agents, .vynorai/agents), so it
  // is built per config load.
  tools.push(await toolDefinitions.runSubagentTool(params));

  tools.push(toolDefinitions.searchWebTool);

  // Token savers, always on: a signature-level code map (built by the startup
  // and on-save indexer) and line-range reads instead of whole files.
  tools.push(
    toolDefinitions.viewRepoMapTool,
    toolDefinitions.readFileRangeTool,
  );

  if (enableExperimentalTools) {
    tools.push(toolDefinitions.viewSubdirectoryTool);
  }

  // Semantic search is only worth its schema tokens when an index exists to
  // answer it; with indexing off it would return nothing.
  if (enableExperimentalTools || indexingEnabled) {
    tools.push(toolDefinitions.codebaseTool);
  }

  if (modelName && isRecommendedAgentModel(modelName)) {
    tools.push(toolDefinitions.multiEditTool);
  } else {
    tools.push(toolDefinitions.editFileTool);
    tools.push(toolDefinitions.singleFindAndReplaceTool);
  }

  // missing support for remote os calls: https://github.com/microsoft/vscode/issues/252269
  if (!isRemote) {
    tools.push(toolDefinitions.grepSearchTool);
    // These read and write the local disk directly.
    tools.push(toolDefinitions.applyDiffTool, toolDefinitions.renameSymbolTool);
  }

  return tools;
};

export function serializeTool(tool: Tool) {
  const { preprocessArgs, evaluateToolCallPolicy, ...rest } = tool;
  return rest;
}
