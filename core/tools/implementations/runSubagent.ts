import type { ContextItem, Tool, ToolCall, ToolExtras } from "../..";
import {
  runExploreSubagent,
  SubagentToolResult,
} from "../../agent/exploreSubagent";
import { getStringArg } from "../parseArgs";

const SUBAGENT_TIMEOUT_MS = 5 * 60_000;
const running = new Map<string, AbortController>();

/** Stops every running subagent (the user pressed Stop). */
export function abortRunningSubagents(): void {
  for (const controller of running.values()) controller.abort();
  running.clear();
}

export async function runSubagentImpl(
  args: unknown,
  extras: ToolExtras,
  callTool: (
    tool: Tool,
    toolCall: ToolCall,
    extras: ToolExtras,
  ) => Promise<SubagentToolResult>,
): Promise<ContextItem[]> {
  const description = getStringArg(args, "description").slice(0, 80);
  const prompt = getStringArg(args, "prompt");
  const id = extras.toolCallId ?? `subagent-${Date.now()}-${Math.random()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBAGENT_TIMEOUT_MS);
  running.set(id, controller);

  const progress: string[] = [];
  const reportProgress = (line: string) => {
    progress.push(line);
    if (!extras.toolCallId) return;
    extras.onPartialOutput?.({
      toolCallId: extras.toolCallId,
      contextItems: [
        {
          name: description,
          description: `Subagent · ${progress.length} tool calls`,
          content: progress.slice(-6).join("\n"),
        },
      ],
    });
  };

  try {
    const result = await runExploreSubagent({
      task: prompt,
      llm: extras.config.selectedModelByRole.subagent ?? extras.llm,
      tools: extras.config.tools,
      signal: controller.signal,
      onProgress: reportProgress,
      callTool: (tool, toolCall) =>
        callTool(tool, toolCall, {
          ...extras,
          tool,
          toolCallId: undefined,
          onPartialOutput: undefined,
        }),
    });
    return [
      {
        name: description,
        description: `Subagent report · ${result.toolCalls} tool calls`,
        content: result.report,
      },
    ];
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        progress.length
          ? `Subagent stopped after ${progress.length} tool calls before reporting.`
          : "Subagent stopped before starting.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    running.delete(id);
  }
}
