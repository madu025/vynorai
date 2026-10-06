export interface AgentRunQualitySignal {
  code: "repeated_tool_use" | "exploration_heavy" | "credit_cap_near";
  severity: "warning";
  detail: string;
  recovery: string;
}

const EXPLORATION_TOOLS = new Set([
  "read_file",
  "read_file_range",
  "read_currently_open_file",
  "grep_search",
  "file_glob_search",
  "view_repo_map",
  "view_subdirectory",
  "ls",
  "codebase",
]);

/** Detects completed-but-inefficient runs without storing prompts or file data. */
export function diagnoseAgentRun(
  toolNameCounts: Record<string, number>,
  creditsUsed?: number,
  taskCreditCap?: number,
): AgentRunQualitySignal[] {
  const signals: AgentRunQualitySignal[] = [];
  const entries = Object.entries(toolNameCounts);
  const totalCalls = entries.reduce((sum, [, count]) => sum + count, 0);
  const repeated = entries
    .filter(([, count]) => count >= 8)
    .map(([name]) => name)
    .sort();
  const explorationCalls = entries.reduce(
    (sum, [name, count]) => sum + (EXPLORATION_TOOLS.has(name) ? count : 0),
    0,
  );

  if (repeated.length > 0) {
    signals.push({
      code: "repeated_tool_use",
      severity: "warning",
      detail: `Tools repeated at least 8 times: ${repeated.join(", ")}.`,
      recovery:
        "Review the task plan and narrow the next search before allowing more tool calls.",
    });
  }
  if (
    explorationCalls >= 12 &&
    totalCalls > 0 &&
    explorationCalls / totalCalls >= 0.7
  ) {
    signals.push({
      code: "exploration_heavy",
      severity: "warning",
      detail: `${explorationCalls} of ${totalCalls} tool calls were repository exploration.`,
      recovery:
        "Ask the agent to state its root-cause hypothesis and verification step before further exploration.",
    });
  }
  if (
    typeof creditsUsed === "number" &&
    typeof taskCreditCap === "number" &&
    taskCreditCap > 0 &&
    creditsUsed >= taskCreditCap * 0.8
  ) {
    signals.push({
      code: "credit_cap_near",
      severity: "warning",
      detail: `This run used ${Math.round((creditsUsed / taskCreditCap) * 100)}% of its task credit cap.`,
      recovery:
        "Pause the run, inspect its current evidence, and continue only with a focused next action.",
    });
  }

  return signals;
}
