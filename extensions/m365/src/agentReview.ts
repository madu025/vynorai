/**
 * Agent team for one request: a planner splits a change request into steps, the builder (the main
 * agent) stages the changes, then two reviewers check them before the person sees the preview, one
 * for accuracy (ranges, formulas, totals) and one for coverage and safety (every part of the
 * request, nothing overwritten). Each helper starts a fresh conversation, so it does not share the
 * builder's assumptions, and may only read the workbook and calculate. When a reviewer finds
 * problems, the builder gets one chance to stage a corrected plan. Nothing is written here: every
 * change stays staged until the person approves it. Each helper's message goes after the fixed
 * prompt prefix, so the cache still hits. Reviewers run one after the other, because `calculate`
 * uses one temporary sheet.
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
import { lintChanges, repairChanges } from "./formulaLint.js";
import { evaluateJoins } from "./resultCheck.js";
import { findUnhandledJobs } from "./workflowCheck.js";

/** The reviewer only reads and calculates; it never needs many turns. */
export const REVIEW_MAX_TURNS = 6;
/** Staged changes listed for the reviewer (the rest are counted). */
export const REVIEW_MAX_CHANGES = 25;
export const REVIEW_MAX_ISSUES = 5;
/** Problems passed to the builder from all reviewers together. */
export const REVIEW_MAX_MERGED = 8;
export const PLAN_MAX_TURNS = 4;
export const PLAN_MAX_STEPS = 8;

export type ReviewFocus = "accuracy" | "coverage";
export const REVIEW_FOCUSES: readonly ReviewFocus[] = ["accuracy", "coverage"];

const FOCUS_CHECKS: Record<ReviewFocus, string> = {
  accuracy:
    "Your focus is accuracy: read the ranges and calculate where it helps. Look for wrong or shifted ranges, formulas that give errors or wrong totals, wrong column references, and number formats that do not fit the data. Do not trust the other agent's numbers: run every staged formula through calculate and report any error value (#VALUE!, #N/A, #REF!) as a problem. For a summary table, calculate the sum of its value column over the source rows and compare it with the sum of the summary's own totals; if they differ, report both numbers as a problem. For a cross-sheet lookup, join or reconciliation, call map_relationships on the source ranges and report a wrong key, many-to-many key, unmatched rows that were ignored, repeated lookup-side keys, or a key that needs cleaning. Dates stored as text make EOMONTH and TEXT fail: DATE(YEAR(x),MONTH(x),1) works on both.",
  coverage:
    "Your focus is coverage and safety: check that every part of the request is covered, nothing would overwrite existing data or headers, new cells sit next to the data they belong to, and labels and sheet names are clear.",
};

export interface ReviewResult {
  ok: boolean;
  issues: string[];
}

export interface ReviewerVerdict extends ReviewResult {
  focus: ReviewFocus;
}

export interface ReviewedRun {
  run: AgentRun;
  /** All reviewers together: ok only when every reviewer that answered found nothing. */
  review?: ReviewResult;
  reviewers?: ReviewerVerdict[];
  /** The planner's steps, when the planner ran. */
  plan?: string[];
  /** True when the first agent staged a corrected plan after the review. */
  revised: boolean;
}

/** The reviewer's request: the person's words and the staged plan, in plain text. */
export function reviewRequest(
  request: string,
  run: Pick<AgentRun, "changes" | "reply">,
  focus: ReviewFocus = "accuracy",
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
    "The changes run in the listed order: a sheet, name or header that an earlier change creates exists for the later ones, so never report it as missing.",
    `Check them against the workbook. ${FOCUS_CHECKS[focus]} Report only problems in your focus. Do not stage any change yourself.`,
    'Never list something that is correct (a result that matches, a range that is right) as a problem. If you find no real problem, reply exactly "VERDICT: OK" and nothing else.',
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

/** A question only reads, so it needs no planner; anything else that may change cells gets one. */
export function needsPlan(request: string): boolean {
  const text = String(request ?? "").trim();
  if (!text || text.startsWith("[Report from the add-in")) return false;
  const question =
    /\?\s*$/.test(text) ||
    /^(what|how (much|many)|which|who|why|when|where|is|are|does|do|did|can you tell|tell me)\b/i.test(
      text,
    );
  // "Audit the formulas", "check the totals", "list the sheets": a request that only reads is
  // answered in the reply, so a plan (which tends to invent a report sheet) is not needed. Any
  // word that changes or writes something brings the planner back.
  const readsOnly =
    /^(please\s+)?(audit|check|review|explain|list|show|find|inspect|describe|summari[sz]e|analy[sz]e|compare|tell)\b/i.test(
      text,
    ) &&
    !/\b(fix|correct|repair|add|create|make|build|put|write|insert|delete|remove|replace|rename|clean|sort|format|highlight|merge|copy|move|change|update|set|apply|new sheet|pivot|chart|and then|then)\b/i.test(
      text,
    );
  if (readsOnly) return false;
  if (findUnhandledJobs(text, []).length) return true;
  return !question;
}

/** The planner's request. */
export function planRequest(request: string): string {
  return [
    "[Report from the add-in: plan] You are the planner. Another agent will stage the changes; you only plan them. Nothing has been written yet.",
    `Request: ${request.slice(0, 1500)}`,
    "Read the workbook where it helps (sheets, headers, where the data ends). For a cross-sheet lookup, join or reconciliation, call map_relationships on the source ranges before planning and put its key, cardinality, unmatched-row count, repeated-key status and cleaning warning in the relevant plan step. If it finds no key, plan a question instead of guessing. Do not stage any change yourself. Plan only what the request asks for: do not add cleaning, trimming, formatting or any other step the person did not name.",
    `Reply with "PLAN:" on the first line, then the ordered steps, one per line, as "1. ..." (at most ${PLAN_MAX_STEPS}). Name the sheet, range or column in each step. If the request only asks a question, reply "PLAN: none".`,
  ].join("\n");
}

/** Reads the planner's answer: the numbered steps, or none. */
export function parsePlan(reply: string): string[] {
  const text = String(reply ?? "");
  if (/^\s*\**\s*PLAN\s*:\s*none\b/im.test(text)) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, "").slice(0, 300))
    .filter(Boolean)
    .slice(0, PLAN_MAX_STEPS);
}

/** The plan as a note after the builder's request (never in the fixed prefix). */
export function planFacts(steps: readonly string[]): string {
  if (!steps.length) return "";
  return `Plan from the planner agent (follow it unless the workbook shows a step is wrong): ${steps
    .map((step, index) => `(${index + 1}) ${step}`)
    .join(" ")}`;
}

/** Problems from several reviewers, without repeats. */
export function mergeIssues(verdicts: readonly ReviewResult[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const verdict of verdicts)
    for (const issue of verdict.issues) {
      const key = issue.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(issue);
    }
  return merged.slice(0, REVIEW_MAX_MERGED);
}

/** A short line for the pane. */
export function describeReview(result: ReviewedRun): string {
  const team = result.plan?.length
    ? `Planner (${result.plan.length} step${result.plan.length === 1 ? "" : "s"}), builder and ${result.reviewers?.length ?? 0} reviewer(s)`
    : `${(result.reviewers?.length ?? 1) + 1} agents`;
  if (!result.review)
    return result.plan?.length ? `${team} worked on this.` : "";
  if (result.review.ok) return `${team} checked the plan: no problems found.`;
  return result.revised
    ? `${team} checked the plan and found ${result.review.issues.length} problem(s); the plan was corrected.`
    : `${team} checked the plan and found: ${result.review.issues.join("; ")}`;
}

type HelperOptions = {
  host: AgentHost;
  model: AgentModel;
  mask: PersonalMask;
  onTool?: (name: string, args: Record<string, unknown>) => void;
};

const isStop = (error: unknown) => (error as Error)?.message === "stopped";

/** Runs the planner. A failed plan is no plan; the builder works as before. */
export async function makePlan(
  options: HelperOptions & { request: string },
): Promise<string[]> {
  try {
    const planner = await runAgent({
      request: planRequest(options.request),
      host: options.host,
      model: options.model,
      mask: options.mask,
      maxTurns: PLAN_MAX_TURNS,
      onTool: options.onTool,
    });
    return parsePlan(planner.reply);
  } catch (error) {
    if (isStop(error)) throw error;
    return [];
  }
}

/**
 * Reviews a run that staged changes and, when a reviewer asks for a fix, lets the first agent
 * stage a corrected plan once. A failed review never loses the first plan.
 */
export async function reviewAndRevise(options: {
  request: string;
  run: AgentRun;
  host: AgentHost;
  model: AgentModel;
  mask: PersonalMask;
  focuses?: readonly ReviewFocus[];
  onPhase?: (phase: AgentPhase | "reviewing" | "revising") => void;
  onTool?: (name: string, args: Record<string, unknown>) => void;
  onReviewer?: (focus: ReviewFocus) => void;
}): Promise<ReviewedRun> {
  const { run } = options;
  if (!run.changes.length) return { run, revised: false };
  const reviewers: ReviewerVerdict[] = [];
  // A mistake that is plain from the formula text goes straight back to the builder: no reviewer needed.
  const linted = [
    ...lintChanges(run.changes),
    ...(await evaluateJoins(run.changes, options.host)),
  ].slice(0, REVIEW_MAX_ISSUES);
  if (linted.length)
    reviewers.push({ focus: "accuracy", ok: false, issues: linted });
  for (const focus of linted.length
    ? []
    : (options.focuses ?? REVIEW_FOCUSES)) {
    try {
      options.onPhase?.("reviewing");
      options.onReviewer?.(focus);
      const reviewer = await runAgent({
        request: reviewRequest(options.request, run, focus),
        host: options.host,
        model: options.model,
        mask: options.mask,
        maxTurns: REVIEW_MAX_TURNS,
        onTool: options.onTool,
      });
      reviewers.push({ focus, ...parseReview(reviewer.reply) });
    } catch (error) {
      if (isStop(error)) throw error;
      // A reviewer that fails is left out; the others still count.
    }
  }
  if (!reviewers.length) return { run, revised: false };
  const issues = mergeIssues(reviewers);
  const review: ReviewResult = { ok: !issues.length, issues };
  if (review.ok) return { run, review, reviewers, revised: false };
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
    if (!revision.changes.length) {
      repairChanges(run.changes);
      return {
        run: { ...run, messages: revision.messages },
        review,
        reviewers,
        revised: false,
      };
    }
    // The builder was told about a known formula mistake; if it repeated it, fix it here.
    repairChanges(revision.changes);
    return {
      run: {
        ...revision,
        reply: revision.reply || run.reply,
        turns: run.turns + revision.turns,
      },
      review,
      reviewers,
      revised: true,
    };
  } catch (error) {
    if (isStop(error)) throw error;
    repairChanges(run.changes);
    return { run, review, reviewers, revised: false };
  }
}

/**
 * The whole team for one request: planner (for a change request), builder, the reviewers, and one
 * correction round. Options are runAgent's, plus progress callbacks for each helper.
 */
export async function runTeam(
  options: Parameters<typeof runAgent>[0] & {
    onTeamPhase?: (phase: "plan" | "reviewing" | "revising") => void;
    onHelperTool?: (name: string, args: Record<string, unknown>) => void;
    onReviewer?: (focus: ReviewFocus) => void;
    /** The planner's steps, as soon as they exist and before the builder starts; not called without a plan. */
    onPlan?: (steps: string[]) => void;
    /** Where the planner and reviewers read (defaults to the builder's host). */
    helperHost?: AgentHost;
  },
): Promise<ReviewedRun> {
  const helper = {
    host: options.helperHost ?? options.host,
    model: options.model,
    mask: options.mask,
    onTool: options.onHelperTool,
  };
  let plan: string[] = [];
  if (needsPlan(options.request)) {
    options.onTeamPhase?.("plan");
    plan = await makePlan({ ...helper, request: options.request });
    if (plan.length) options.onPlan?.(plan);
  }
  const {
    onTeamPhase,
    onHelperTool: _helperTool,
    helperHost: _helperHost,
    onPlan: _onPlan,
    onReviewer,
    ...builderOptions
  } = options;
  const first = await runAgent({
    ...builderOptions,
    facts: [options.facts ?? "", planFacts(plan)].filter(Boolean).join("\n"),
  });
  const reviewed = await reviewAndRevise({
    ...helper,
    request: options.request,
    run: first,
    onReviewer,
    onPhase: (phase) => {
      if (phase === "reviewing" || phase === "revising") onTeamPhase?.(phase);
    },
  });
  return plan.length ? { ...reviewed, plan } : reviewed;
}
