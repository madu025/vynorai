/**
 * The one line the agent card shows instead of its six role cards: working, checked, or a check that
 * needs attention. Pure: it reads the badge word, the progress text and the problems found so far.
 */
export type CheckedState = "idle" | "working" | "ok" | "warn";

export interface CheckedInput {
  /** The agent badge in English ("Working", "Done", "Stopped", ...); empty while idle. */
  badge: string;
  /** What the agent is doing right now (shown while working). */
  progress?: string;
  /** Problems reported by the reviewers, the lint, the apply or the verification, first one first. */
  issues?: readonly string[];
}

export interface CheckedLine {
  state: CheckedState;
  /** The fixed English words, ready to be localized. */
  prefix: string;
  /** The variable tail (progress or the first problem); it is shown as it is. */
  detail: string;
  text: string;
}

const WORKING = new Set([
  "Working",
  "Planning",
  "Reviewing",
  "Correcting",
  "Executing",
  "Applying",
  "Verifying",
  "Final answer",
]);

const short = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

export const CHECKED_OK = "Checked · your original data is not changed";
export const CHECK_NEEDED = "Check needed: ";
export const WORKING_PREFIX = "Working…";

export function checkedLine(input: CheckedInput): CheckedLine {
  const line = (
    state: CheckedState,
    prefix: string,
    detail = "",
  ): CheckedLine => ({
    state,
    prefix,
    detail,
    text: detail ? `${prefix} ${detail}`.replace(/: $/, ":") : prefix,
  });
  const badge = input.badge.trim();
  if (!badge) return line("idle", "");
  const issue = input.issues?.map((item) => item.trim()).find(Boolean);
  if (WORKING.has(badge))
    return line("working", WORKING_PREFIX, short(input.progress ?? "", 80));
  if (badge === "Stopped")
    return {
      state: "warn",
      prefix: CHECK_NEEDED,
      detail: "stopped before it finished",
      text: `${CHECK_NEEDED}stopped before it finished`,
    };
  if (issue)
    return {
      state: "warn",
      prefix: CHECK_NEEDED,
      detail: short(issue, 100),
      text: `${CHECK_NEEDED}${short(issue, 100)}`,
    };
  return line("ok", CHECKED_OK);
}
