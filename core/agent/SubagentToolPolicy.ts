import { BuiltInToolNames } from "../tools/builtIn";
import type { SubagentAuthority } from "./types";

export interface DelegatedToolAuthorization {
  capability: keyof SubagentAuthority;
  resource?: string;
}

const SCOPED_FILE_READS = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadFileRange,
]);

const SCOPED_FILE_WRITES = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

const WORKSPACE_WIDE_READS = new Set<string>([
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.GrepSearch,
  BuiltInToolNames.FileGlobSearch,
  BuiltInToolNames.ViewDiff,
  BuiltInToolNames.LSTool,
  BuiltInToolNames.CodebaseTool,
  BuiltInToolNames.ViewRepoMap,
]);

const NETWORK_TOOLS = new Set<string>([
  BuiltInToolNames.SearchWeb,
  BuiltInToolNames.FetchUrlContent,
  BuiltInToolNames.BrowserQa,
]);

function requiredPath(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Delegated tool requires a valid ${key}`);
  return value;
}

/**
 * Fail-closed mapping from a tool invocation to its delegated capability.
 * Unknown tools and shell commands are intentionally rejected: MCP tools may
 * combine network, process and filesystem effects, while shell commands cannot
 * yet be constrained to a subagent file scope by the host sandbox.
 */
export function classifyDelegatedToolCall(
  toolName: string,
  args: Record<string, unknown>,
): DelegatedToolAuthorization {
  if (SCOPED_FILE_READS.has(toolName))
    return { capability: "read", resource: requiredPath(args, "filepath") };
  if (SCOPED_FILE_WRITES.has(toolName))
    return { capability: "write", resource: requiredPath(args, "filepath") };
  if (toolName === BuiltInToolNames.ViewSubdirectory)
    return {
      capability: "read",
      resource: requiredPath(args, "directory_path"),
    };
  if (WORKSPACE_WIDE_READS.has(toolName))
    return { capability: "read", resource: "." };
  if (NETWORK_TOOLS.has(toolName)) return { capability: "network" };
  if (toolName === BuiltInToolNames.RunTerminalCommand)
    throw new Error(
      "Delegated terminal execution is blocked until the sandbox enforces the subagent file scope",
    );
  throw new Error(`Tool ${toolName} is not approved for delegated execution`);
}
