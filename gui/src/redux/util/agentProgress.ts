import { ChatHistoryItem, ContextItem } from "core";
import {
  MAX_AUTONOMOUS_STEPS,
  REPEAT_LIMIT_ERROR,
  STEP_LIMIT_ERROR,
} from "core/agent/guardErrors";
import { BuiltInToolNames } from "core/tools/builtIn";
import { parseTodoArgs } from "core/tools/definitions/updateTodoList";
import { renderChatMessage } from "core/util/messageContent";

import { classifyVerificationCommand } from "./verificationEvidence";
import { verificationFailed } from "./verificationRepair";

/**
 * When an agent turn pauses.
 *
 * A turn has no cap on rounds. A fixed cap (40 rounds) stopped a build that
 * was still writing files and let a stuck agent run 40 rounds; the number of
 * rounds says nothing about either. A turn ends when the work is done (the
 * todo and verification gates), when the user stops it, at the user's task
 * credit cap, or when it is stuck. Stuck is read from what the tool calls did:
 *
 * - stalled: STALL_LIMIT answers in a row whose calls all failed or repeated
 *   an earlier call, so nothing new was even learned;
 * - no_change: NO_CHANGE_LIMIT answers in a row that changed nothing in the
 *   project: no new edit, no check going from failing to passing, no todo
 *   item closed. Reading and running things is allowed, but not without end;
 * - same_failure: one check failed the same way SAME_FAILURE_LIMIT times in a
 *   row, so the edits in between are not reaching the fault. At
 *   SAME_FAILURE_NUDGE the model is told once and may change approach;
 * - actions: the core's per-task action net refused a call (a runaway guard,
 *   see MAX_AUTONOMOUS_STEPS); the turn pauses once instead of failing call
 *   after call. A prompt whose task could not be started has no such net in
 *   the core, so its tool calls are counted here to the same limit.
 *
 * An answer with no tool call is neither progress nor a stalled round: it
 * ends the turn unless a gate sends the model back, and each gate is bounded.
 *
 * On a pause the model answers without tools: what is done, what is left,
 * what blocks it. "Continue" is a new prompt and starts clean.
 */
export const STALL_LIMIT = 8;
export const NO_CHANGE_LIMIT = 30;
export const SAME_FAILURE_NUDGE = 5;
export const SAME_FAILURE_LIMIT = 10;

export type ProgressPause =
  | "stalled"
  | "no_change"
  | "same_failure"
  | "actions";

const EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

export const CONTINUE_TASK_PROMPT =
  "Continue the task from where you stopped. Follow the remaining steps you listed.";

/**
 * Index of the user message that opened the current job, or -1.
 *
 * "Continue" after a pause is sent as a real user message, so it starts a new
 * prompt: the stall and same-failure counts begin again (see currentPrompt).
 * It is not a new request, though. What belongs to the job (its todo list,
 * its goal, the roles and memories chosen for it) is looked up from here;
 * from the Continue message on, the list from before the pause was invisible
 * and the turn could finish with it open.
 */
export function jobStartIndex(history: ChatHistoryItem[]): number {
  let start = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role !== "user" || isAutoPrompt) continue;
    start = i;
    if (renderChatMessage(message).trim() !== CONTINUE_TASK_PROMPT) break;
  }
  return start;
}

export const SAME_FAILURE_MARKER = "[same-failure]";

const ACTION_LIMIT_MESSAGE =
  "The per-task action limit was reached, so this tool call was not run.";

const PAUSE_REPLY =
  "Do not request or simulate more tool calls in this response. Reply with: (1) what is done so far, (2) the remaining steps as a short numbered list, (3) what is blocking you. Use only the evidence already collected.";

const PAUSE_CAUSE: Record<ProgressPause, string> = {
  stalled: "Your last several steps failed or repeated earlier steps.",
  no_change:
    "Your last many steps read and ran things but changed nothing in the project.",
  same_failure:
    "The same check has failed with the same output many times in a row, so your edits are not reaching the cause.",
  actions: "This task reached its action limit.",
};

/** Appended to the system message of the one round that reports a pause. */
export function pauseGuidance(reason: ProgressPause): string {
  return `${PAUSE_CAUSE[reason]} ${PAUSE_REPLY}`;
}

/**
 * A pause is told to the model as the last message of the history. The system
 * message and the tool list stay exactly as they were: changing them for one
 * round re-billed the whole conversation, and a request without tools made
 * the model report that the user had switched its tools off.
 */
export const PAUSE_MARKER = "[paused]";

export function pausePrompt(guidance: string): string {
  return `${PAUSE_MARKER} ${guidance.trim()}`;
}

/** What a tool call gets when the model makes one on a paused round. */
export const PAUSED_CALL_MESSAGE =
  "Not run: this task is paused. Do not call tools. Reply now with what is done, what is left and what blocks you.";

function isPausePrompt(item: ChatHistoryItem): boolean {
  return (
    item.message.role === "user" &&
    !!item.isAutoPrompt &&
    typeof item.message.content === "string" &&
    item.message.content.startsWith(PAUSE_MARKER)
  );
}

/** The current prompt was already told it is paused. */
export function pausePromptSent(history: ChatHistoryItem[]): boolean {
  return currentPrompt(history).some(isPausePrompt);
}

/** A tool call was already refused on a paused round of the current prompt. */
export function pausedCallRefused(history: ChatHistoryItem[]): boolean {
  return currentPrompt(history).some((item) =>
    (item.toolCallStates ?? []).some(
      (call) =>
        call.status === "errored" &&
        outputText(call.output).includes(PAUSED_CALL_MESSAGE),
    ),
  );
}

/**
 * Safety-guard refusals the model can recover from by changing approach.
 * They are returned as the tool's error instead of failing the whole turn.
 */
export function isRecoverableGuardError(message: string): boolean {
  return (
    message.includes(REPEAT_LIMIT_ERROR) || message.includes(STEP_LIMIT_ERROR)
  );
}

export function guardErrorForModel(message: string): string {
  if (message.includes(REPEAT_LIMIT_ERROR)) {
    return "This exact tool call has already run 3 times with no file edits in between, so it was not run again. Use the earlier result, or change approach.";
  }
  return `${ACTION_LIMIT_MESSAGE} Stop calling tools and summarize progress and the remaining steps.`;
}

/**
 * Model rounds since the user's last real prompt (auto prompts such as the
 * verification gate don't start a new prompt). Used to tell the first round
 * of a prompt from a later one and for the task outcome report, never to
 * stop a turn.
 *
 * A round is one model answer. A reasoning model's stream opens with an empty
 * assistant message before its thinking block, so one answer leaves two
 * assistant items in history. Empty placeholders are not rounds.
 */
export function roundsSincePrompt(history: ChatHistoryItem[]): number {
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role === "user" && !isAutoPrompt) break;
    if (message.role === "assistant" && isModelAnswer(message)) rounds++;
  }
  return rounds;
}

function isModelAnswer(message: ChatHistoryItem["message"]): boolean {
  if (message.role !== "assistant") return false;
  if (message.toolCalls && message.toolCalls.length > 0) return true;
  const content = message.content;
  if (typeof content === "string") return content.trim().length > 0;
  return Array.isArray(content) && content.length > 0;
}

/** The items of the current prompt: everything after the last real user message. */
function currentPrompt(history: ChatHistoryItem[]): ChatHistoryItem[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user" && !history[i].isAutoPrompt)
      return history.slice(i + 1);
  }
  return history;
}

type Call = NonNullable<ChatHistoryItem["toolCallStates"]>[number];

/**
 * The model's own arguments, with what preprocessing added. Preprocessing
 * alone is not the call: for the file tools it holds only `resolvedPath`,
 * which is null for every file that does not exist yet, so eleven new files
 * in a row looked like one edit repeated and a build was paused as stalled.
 */
function argsOf(call: Call): unknown {
  return {
    ...((call.parsedArgs as object | undefined) ?? {}),
    ...((call.processedArgs as object | undefined) ?? {}),
  };
}

function outputText(output: ContextItem[] | undefined): string {
  return (output ?? []).map((item) => item.content ?? "").join("\n");
}

/** The command of a finished check (test, type check, lint, build) call. */
function checkCommand(call: Call): string | undefined {
  if (call.toolCall.function.name !== BuiltInToolNames.RunTerminalCommand)
    return undefined;
  if (call.status !== "done" && call.status !== "errored") return undefined;
  const command = (argsOf(call) as { command?: unknown }).command;
  return typeof command === "string" && classifyVerificationCommand(command)
    ? command
    : undefined;
}

function completedTodos(call: Call): number | undefined {
  if (
    call.toolCall.function.name !== BuiltInToolNames.UpdateTodoList ||
    call.status !== "done"
  )
    return undefined;
  try {
    return parseTodoArgs(call.parsedArgs).filter(
      (todo) => todo.status === "completed",
    ).length;
  } catch {
    return undefined;
  }
}

/**
 * Tool-calling answers in a row, up to now, in the current prompt:
 * - `idle`: that learned nothing new. An answer learns something when one of
 *   its calls succeeded and was a new edit or a call not already made since
 *   the last edit (an edit changes what reads, tests and builds return).
 * - `unchanged`: that changed nothing in the project. A change is a new
 *   successful edit, a check that passes after failing, or a closed todo item.
 */
export function progressCounters(history: ChatHistoryItem[]): {
  idle: number;
  unchanged: number;
} {
  const edits = new Set<string>();
  const seen = new Set<string>();
  const failingChecks = new Set<string>();
  let closedTodos = 0;
  let idle = 0;
  let unchanged = 0;
  for (const item of currentPrompt(history)) {
    const calls = item.toolCallStates ?? [];
    if (item.message.role !== "assistant" || calls.length === 0) continue;
    let learned = false;
    let changed = false;
    for (const call of calls) {
      const check = checkCommand(call);
      if (check) {
        if (verificationFailed(call)) failingChecks.add(check);
        else if (failingChecks.delete(check)) changed = true;
      }
      if (call.status !== "done") continue;
      const name = call.toolCall.function.name;
      const signature = `${name}:${JSON.stringify(argsOf(call))}`;
      if (EDIT_TOOLS.has(name)) {
        // Writing the same change again is a loop, not a new state.
        if (edits.has(signature)) continue;
        edits.add(signature);
        learned = changed = true;
        seen.clear();
        continue;
      }
      const closed = completedTodos(call);
      if (closed !== undefined) {
        if (closed > closedTodos) changed = true;
        closedTodos = Math.max(closedTodos, closed);
      }
      if (!seen.has(signature)) learned = true;
      seen.add(signature);
    }
    idle = learned ? 0 : idle + 1;
    unchanged = changed ? 0 : unchanged + 1;
  }
  return { idle, unchanged };
}

/**
 * What stays the same between two runs that fail for the same reason. Run
 * times, clock times, line and column numbers (they move when a line is added
 * above), addresses, process ids and ports differ; the messages do not.
 */
export function failureFingerprint(output: ContextItem[] | undefined): string {
  return outputText(output)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<time>")
    .replace(/(?<![\w.:/\\])\d{1,2}:\d{2}(:\d{2})?(?![\w:])/g, "<time>")
    .replace(/(?<=[\w)\]"']):\d+(:\d+)?/g, ":<n>")
    .replace(/\(\d+,\s?\d+\)/g, "(<n>)")
    .replace(/\bline \d+/gi, "line <n>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b(pid|port)\b(\W{0,3})\d+/gi, "$1$2<n>")
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|secs|seconds|m|min)\b/g, "<duration>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The check of the current prompt that has failed the same way most times in
 * a row. Each command is counted on its own: a pass of that command, or a
 * failure of it that reads differently, starts its count again, and another
 * check passing or failing in between does not. A fix loop whose errors
 * change is still moving.
 */
export function sameFailureStreak(
  history: ChatHistoryItem[],
): { command: string; streak: number } | undefined {
  const failing = new Map<string, { fingerprint: string; streak: number }>();
  for (const item of currentPrompt(history)) {
    for (const call of item.toolCallStates ?? []) {
      const command = checkCommand(call);
      if (!command) continue;
      if (!verificationFailed(call)) {
        failing.delete(command);
        continue;
      }
      const fingerprint = failureFingerprint(call.output);
      const before = failing.get(command);
      failing.set(command, {
        fingerprint,
        streak: before?.fingerprint === fingerprint ? before.streak + 1 : 1,
      });
    }
  }
  let worst: { command: string; streak: number } | undefined;
  for (const [command, { streak }] of failing) {
    if (!worst || streak > worst.streak) worst = { command, streak };
  }
  return worst;
}

/**
 * Sent once per prompt, at the end of the history, when a check has failed
 * the same way SAME_FAILURE_NUDGE times. A build can fail the same way while
 * the part it needs is still being written, so this is a note to the model,
 * not a stop.
 */
export function sameFailureNudge(
  history: ChatHistoryItem[],
): string | undefined {
  const worst = sameFailureStreak(history);
  if (!worst || worst.streak < SAME_FAILURE_NUDGE) return undefined;
  const told = currentPrompt(history).some(
    (item) =>
      item.isAutoPrompt &&
      typeof item.message.content === "string" &&
      item.message.content.startsWith(SAME_FAILURE_MARKER),
  );
  if (told) return undefined;
  return `${SAME_FAILURE_MARKER} \`${worst.command}\` has now failed ${worst.streak} times in a row with the same output, so the changes made since then have not affected it. If that is expected because the part it needs is not written yet, carry on. Otherwise stop editing, read the failure output and the code it points to again from the start, and look for the cause somewhere you have not looked yet before you change anything else.`;
}

function actionLimitRefused(history: ChatHistoryItem[]): boolean {
  return currentPrompt(history).some((item) =>
    (item.toolCallStates ?? []).some(
      (call) =>
        call.status === "errored" &&
        outputText(call.output).includes(ACTION_LIMIT_MESSAGE),
    ),
  );
}

/**
 * Why the current prompt should pause now, if it should. `hasTask` is false
 * when the prompt's task could not be started: no call is then authorized by
 * the core, so nothing there counts the calls.
 */
export function progressPause(
  history: ChatHistoryItem[],
  mode: string = "agent",
  hasTask: boolean = true,
): ProgressPause | undefined {
  if (actionLimitRefused(history)) return "actions";
  if (!hasTask) {
    let calls = 0;
    for (const item of currentPrompt(history))
      calls += item.toolCallStates?.length ?? 0;
    if (calls >= MAX_AUTONOMOUS_STEPS) return "actions";
  }
  if ((sameFailureStreak(history)?.streak ?? 0) >= SAME_FAILURE_LIMIT)
    return "same_failure";
  const { idle, unchanged } = progressCounters(history);
  if (idle >= STALL_LIMIT) return "stalled";
  // Only where the agent can change things. Plan and chat mode have no edit
  // tools, so every long investigation there would count as "no change";
  // they stay bounded by the stall rule and the core's action net.
  if (unchanged >= NO_CHANGE_LIMIT && mode === "agent") return "no_change";
  return undefined;
}
