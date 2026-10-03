import { Tool, ToolCallState } from "core";
import Mustache from "mustache";

interface ToolCallStatusMessageProps {
  tool: Tool | undefined;
  toolCallState: ToolCallState;
}

/** "142 lines" / "3 results" for a finished call, from its real output. */
export function toolOutputSummary(toolCallState: ToolCallState): string | null {
  if (toolCallState.status !== "done" || !toolCallState.output?.length) {
    return null;
  }
  const visible = toolCallState.output.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  if (visible.length > 1) return `${visible.length} results`;
  const content = visible[0].content ?? "";
  if (!content.trim()) return "no output";
  const lines = content.replace(/\n$/, "").split("\n").length;
  return lines === 1 ? "1 line" : `${lines} lines`;
}

function statusSuffix(toolCallState: ToolCallState): string | null {
  switch (toolCallState.status) {
    case "generating":
      return "preparing";
    case "generated":
      return "needs approval";
    case "canceled":
      return "canceled";
    case "errored":
      return "failed";
    case "done":
      return toolOutputSummary(toolCallState);
    default:
      return null;
  }
}

/**
 * Compact tool row title: **Read** src/auth.ts · 142 lines
 * The verb tense follows the real call status (Read / Reading / failed).
 */
export function ToolCallStatusMessage({
  tool,
  toolCallState,
}: ToolCallStatusMessageProps) {
  let message: string;
  if (!tool) {
    message = `use ${toolCallState.toolCall.function.name || "project inspection"}`;
  } else {
    const toolName = tool.displayTitle ?? tool.function.name;
    const render = (template: string | undefined, fallback: string) =>
      template ? Mustache.render(template, toolCallState.parsedArgs) : fallback;

    const finished =
      toolCallState.status === "done" ||
      (tool.isInstant && toolCallState.status === "calling");
    if (finished) {
      message = render(tool.hasAlready, `used ${toolName}`);
    } else if (toolCallState.status === "calling") {
      message = render(tool.isCurrently, `using ${toolName}`);
    } else {
      message = render(tool.wouldLikeTo, `use ${toolName}`);
    }
  }

  const [verb, ...rest] = message.trim().split(" ");
  const suffix = statusSuffix(toolCallState);

  return (
    <div
      className="text-description line-clamp-4 min-w-0 break-words"
      data-testid="tool-call-title"
    >
      <span className="text-foreground font-semibold">
        {verb.charAt(0).toUpperCase() + verb.slice(1)}
      </span>
      {rest.length > 0 && ` ${rest.join(" ")}`}
      {suffix && (
        <span className="text-description-muted">{` · ${suffix}`}</span>
      )}
    </div>
  );
}
