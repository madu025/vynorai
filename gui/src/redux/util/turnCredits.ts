/** Shown to the model when a prompt reaches the user's task credit cap. */
export const CREDIT_CAP_GUIDANCE =
  "\n\nTASK CREDIT LIMIT REACHED\nThe user set a credit limit for one task and this task has reached it. Do not request or simulate more tool calls in this response. Reply with: (1) what is done so far, (2) the remaining steps as a short numbered list, (3) any blocker or uncertainty. Use only the evidence already collected.";

export const TASK_CREDIT_CAP_OPTIONS = [0, 50_000, 200_000, 500_000, 1_000_000];

export function creditCapReached(
  used: number,
  cap: number | undefined,
): boolean {
  return !!cap && cap > 0 && used >= cap;
}

/** 950 -> "950", 12_400 -> "12.4K", 2_300_000 -> "2.3M". */
export function formatCredits(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
