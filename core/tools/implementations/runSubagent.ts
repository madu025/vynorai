import type { ContextItem, Tool, ToolCall, ToolExtras } from "../..";
import {
  runExploreSubagent,
  SubagentToolResult,
} from "../../agent/exploreSubagent";
import {
  buildUserSubagentSystemMessage,
  loadUserSubagents,
} from "../../agent/userSubagents";
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
  const agentName =
    args && typeof args === "object" && "agent" in args
      ? String((args as { agent?: unknown }).agent ?? "").trim()
      : "";
  let agentOptions:
    | { systemMessage: string; allowedTools: Set<string> }
    | undefined;
  let agentLabel: string | undefined;
  if (agentName) {
    const { agents } = await loadUserSubagents(extras.ide);
    const agent = agents.find((candidate) => candidate.name === agentName);
    if (!agent) {
      throw new Error(
        `No custom agent named "${agentName}". Available: ${agents.map((a) => a.name).join(", ") || "none"}. Omit "agent" to use the general explore subagent.`,
      );
    }
    agentOptions = {
      systemMessage: buildUserSubagentSystemMessage(agent),
      allowedTools: new Set(agent.tools),
    };
    agentLabel = agent.name;
  }
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
      ...agentOptions,
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
        description: `${agentLabel ? `${agentLabel} agent` : "Subagent"} report · ${result.toolCalls} tool calls`,
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
