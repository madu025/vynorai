/**
 * Reviewer agent: a second agent checks the plan before the person sees the preview. It starts
 * with a fresh conversation (so it does not share the first agent's assumptions), may read the
 * workbook and calculate, and answers with a verdict. When it finds problems, the first agent gets
 * one chance to stage a corrected plan. Nothing is written here: every change stays staged until the
 * person approves it. The review message goes after the fixed prompt prefix, so the cache still hits.
 */
import {
  describeChange,
  runAgent,
  type AgentHost,
  type AgentModel,
  type AgentPhase,
  type AgentRun,
  type PersonalMask,
} from "./agent.js";

/** The reviewer only reads and calculates; it never needs many turns. */
export const REVIEW_MAX_TURNS = 4;
/** Staged changes listed for the reviewer (the rest are counted). */
export const REVIEW_MAX_CHANGES = 25;
export const REVIEW_MAX_ISSUES = 5;

export interface ReviewResult {
  ok: boolean;
  issues: string[];
}

export interface ReviewedRun {
  run: AgentRun;
  review?: ReviewResult;
  /** True when the first agent staged a corrected plan after the review. */
  revised: boolean;
}

/** The reviewer's request: the person's words and the staged plan, in plain text. */
export function reviewRequest(
  request: string,
  run: Pick<AgentRun, "changes" | "reply">,
): string {
  const listed = run.changes
    .slice(0, REVIEW_MAX_CHANGES)
    .map((item, index) => `${index + 1}. ${describeChange(item.change)}`);
  const more = run.changes.length - listed.length;
  return [
    "[Report from the add-in: review] You are the reviewer. Another agent prepared the changes below for this request. Nothing has been written yet.",
    `Request: ${request.slice(0, 1500)}`,
    "Staged changes:",
    ...listed,
    ...(more > 0 ? [`(and ${more} more)`] : []),
    ...(run.reply ? [`The other agent said: ${run.reply.slice(0, 600)}`] : []),
    "Check them against the workbook: read the ranges and calculate where it helps. Look for wrong or shifted ranges, formulas that give errors or wrong totals, a part of the request nothing covers, and anything that would overwrite data. Do not stage any change yourself.",
    'Reply with exactly one first line, "VERDICT: OK" or "VERDICT: FIX", then one line per problem starting with "- " (at most 5).',
  ].join("\n");
}

/** Reads the reviewer's answer. Anything that is not a clear FIX counts as OK, so a vague answer never blocks. */
export function parseReview(reply: string): ReviewResult {
  const text = String(reply ?? "");
  const fix = /^\s*\**\s*VERDICT\s*:\s*FIX\b/im.test(text);
  if (!fix) return { ok: true, issues: [] };
  const issues = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").slice(0, 300))
    .filter(Boolean)
    .slice(0, REVIEW_MAX_ISSUES);
  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

/** What the first agent is told when the reviewer found problems. */
export function revisionRequest(issues: readonly string[]): string {
  return `[Report from the add-in: review] A reviewer checked the staged changes and found: ${issues
    .map((issue, index) => `(${index + 1}) ${issue}`)
    .join(
      " ",
    )}. The staged changes are discarded. Stage the complete corrected set now, or, if a point is wrong, stage the same changes again and say why in the reply.`;
}

/** A short line for the pane. */
export function describeReview(result: ReviewedRun): string {
  if (!result.review) return "";
  if (result.review.ok)
    return "A second agent reviewed the plan: no problems found.";
  return result.revised
    ? `A second agent reviewed the plan and found ${result.review.issues.length} problem(s); the plan was corrected.`
    : `A second agent reviewed the plan and found: ${result.review.issues.join("; ")}`;
}

/**
 * Reviews a run that staged changes and, when the reviewer asks for a fix, lets the first agent
 * stage a corrected plan once. A failed review never loses the first plan.
 */
export async function reviewAndRevise(options: {
  request: string;
  run: AgentRun;
  host: AgentHost;
  model: AgentModel;
  mask: PersonalMask;
  onPhase?: (phase: AgentPhase | "reviewing" | "revising") => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
}): Promise<ReviewedRun> {
  const { run } = options;
  if (!run.changes.length) return { run, revised: false };
  let review: ReviewResult;
  try {
    options.onPhase?.("reviewing");
    const reviewer = await runAgent({
      request: reviewRequest(options.request, run),
      host: options.host,
      model: options.model,
      mask: options.mask,
      maxTurns: REVIEW_MAX_TURNS,
      onTool: options.onTool,
    });
    review = parseReview(reviewer.reply);
  } catch (error) {
    if ((error as Error)?.message === "stopped") throw error;
    return { run, revised: false };
  }
  if (review.ok) return { run, review, revised: false };
  try {
    options.onPhase?.("revising");
    const revision = await runAgent({
      request: revisionRequest(review.issues),
      history: run.messages,
      host: options.host,
      model: options.model,
      mask: options.mask,
      onTool: options.onTool,
    });
    // A revision that stages nothing keeps the first plan, with the review shown to the person.
    if (!revision.changes.length)
      return {
        run: { ...run, messages: revision.messages },
        review,
        revised: false,
      };
    return {
      run: {
        ...revision,
        reply: revision.reply || run.reply,
        turns: run.turns + revision.turns,
      },
      review,
      revised: true,
    };
  } catch (error) {
    if ((error as Error)?.message === "stopped") throw error;
    return { run, review, revised: false };
  }
}
