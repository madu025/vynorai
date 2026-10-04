import { ChatHistoryItem, MessageModes } from "core";

/**
 * Tool rounds (model call → tool calls → results) a single prompt may run
 * before the agent pauses with a progress summary and offers "Continue".
 * This is a check-in point, not a hard stop: Continue starts a fresh budget.
 */
const ROUND_BUDGET: Record<string, number> = {
  chat: 12,
  plan: 25,
  agent: 40,
};

export function toolRoundBudget(mode: MessageModes | string): number {
  return ROUND_BUDGET[mode] ?? ROUND_BUDGET.agent;
}

export const CONTINUE_TASK_PROMPT =
  "Continue the task from where you stopped. Follow the remaining steps you listed.";

export const TOOL_BUDGET_GUIDANCE =
  "\n\nTOOL ROUND BUDGET REACHED\nDo not request or simulate more tool calls in this response. The user can let you continue with a fresh budget. Reply with: (1) what is done so far, (2) the remaining steps as a short numbered list, (3) any blocker or uncertainty. Use only the evidence already collected.";

/**
 * Safety-guard refusals the model can recover from by changing approach.
 * They are returned as the tool's error instead of failing the whole turn.
 */
export function isRecoverableGuardError(message: string): boolean {
  return /Repeated tool action limit|Autonomous step limit/i.test(message);
}

export function guardErrorForModel(message: string): string {
  if (/Repeated tool action limit/i.test(message)) {
    return "This exact tool call has already run 3 times with no file edits in between, so it was not run again. Use the earlier result, or change approach.";
  }
  return "The per-task action limit was reached, so this tool call was not run. Stop calling tools and summarize progress and the remaining steps.";
}

/**
 * Model rounds since the user's last real prompt (auto prompts such as the
 * verification gate don't start a new prompt). Derived from history so every
 * way of continuing a turn (approve, reject, apply, move to background)
 * counts toward the same budget; passing `depth` alone reset it to 1 after
 * each approval, so the budget and the credit cap never triggered.
 */
export function roundsSincePrompt(history: ChatHistoryItem[]): number {
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role === "user" && !isAutoPrompt) break;
    if (message.role === "assistant") rounds++;
  }
  return rounds;
}
