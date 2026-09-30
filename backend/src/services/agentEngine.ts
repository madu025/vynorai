/**
 * VynorAI Autonomous Agent Engine
 * Enables multi-turn tool calling, autonomous planning, and self-healing code execution.
 */

export interface AgentTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

/**
 * Standard Suite of Autonomous Coding Tools for VynorAI
 */
export const VYNORAI_AGENT_TOOLS: AgentTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read contents of a file within the workspace. Use this to inspect code before modifying.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file from workspace root" },
          startLine: { type: "number", description: "Optional starting line number (1-indexed)" },
          endLine: { type: "number", description: "Optional ending line number (1-indexed)" },
        },
        required: ["filePath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Make a precise find-and-replace edit to an existing file with exact matching oldContent.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file" },
          oldContent: { type: "string", description: "The exact snippet of code to be replaced" },
          newContent: { type: "string", description: "The replacement code snippet" },
        },
        required: ["filePath", "oldContent", "newContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or completely overwrite an existing file with the provided content.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "The complete content to write into the file" },
        },
        required: ["filePath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a terminal command (e.g. npm test, git status, tsc) to verify changes or compile errors.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The exact shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders within a workspace directory.",
      parameters: {
        type: "object",
        properties: {
          dirPath: { type: "string", description: "Relative directory path (e.g. '.' or 'src')" },
        },
        required: ["dirPath"],
      },
    },
  },
];

/**
 * System prompt that activates the Autonomous Agent behavior
 */
export const VYNORAI_AGENT_SYSTEM_PROMPT = `You are VynorAI, an expert elite autonomous AI software engineer.
You do not just write snippets; you solve complex engineering tasks end-to-end.

Core Principles:
1. Always explore and understand existing code before making edits (use read_file or list_directory).
2. Make minimal, surgical edits that preserve existing comments, styles, and architecture.
3. Validate your edits by running tests or type-checks (use run_command) whenever applicable.
4. If a command or build fails, read the error message carefully and fix the problem autonomously (Self-Healing).
5. Never hallucinate API signatures or file paths. Always verify against source.`;
