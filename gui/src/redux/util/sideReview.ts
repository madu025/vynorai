import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";

/**
 * "You should know": after an agent turn that changed files, a cheap second
 * look at the diff flags what the user or the agent may have missed. The note
 * is shown beside the reply and never added to the conversation, so it does
 * not change the prompt prefix.
 */
const EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

export const SIDE_REVIEW_MAX_DIFF_CHARS = 8000;

export type SideReviewResult = {
  blocking: string[];
  warnings: string[];
  /** False when the model did not follow the required review format. */
  reliable: boolean;
};

/** Side review is reserved for complex or deterministically high-risk work. */
export function requiresIndependentSideReview(
  files: string[],
  scope?: "simple" | "medium" | "complex",
): boolean {
  if (scope === "complex") return true;
  return files.some((file) =>
    /(^|[/_.-])(auth|security|permission|billing|payment|deploy|release|migration|schema|database|db)([/_.-]|$)/i.test(
      file.replace(/\\/g, "/"),
    ),
  );
}

type ToolCall = NonNullable<ChatHistoryItem["toolCallStates"]>[number];

const normalizePath = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

/** A finished call of a tool that changes a file. */
export function isFinishedEdit(call: ToolCall): boolean {
  return call.status === "done" && EDIT_TOOLS.has(call.toolCall.function.name);
}

/**
 * The file of each finished edit among `calls`, as the path the model first
 * wrote for it. One file is one entry however it was spelled: `src/a.ts` and
 * `./src/a.ts` counted as two files, and a one-file fix then got the
 * completion gate and the pre-mortem, which are for changes of two files.
 *
 * A file is told by the URI preprocessing resolved (`fileUri`, or
 * `resolvedPath.uri`), else by its normalised path. A file that did not exist
 * when it was created has no URI on that call, so a path seen with a URI on
 * any call stands for that URI on every call.
 */
function editedPaths(calls: ToolCall[]): Map<ToolCall, string> {
  const edits = calls.filter(isFinishedEdit).map((call) => {
    const filepath = (call.parsedArgs as { filepath?: unknown } | undefined)
      ?.filepath;
    const processed = call.processedArgs as
      | { fileUri?: unknown; resolvedPath?: { uri?: unknown } | null }
      | undefined;
    const uri = processed?.fileUri ?? processed?.resolvedPath?.uri;
    return {
      call,
      written: typeof filepath === "string" ? filepath : undefined,
      uri: typeof uri === "string" ? uri : undefined,
    };
  });
  const uriOfPath = new Map<string, string>();
  for (const { written, uri } of edits) {
    if (written !== undefined && uri && !uriOfPath.has(normalizePath(written)))
      uriOfPath.set(normalizePath(written), uri);
  }
  const shownAs = new Map<string, string>();
  const paths = new Map<ToolCall, string>();
  for (const { call, written, uri } of edits) {
    const path = written === undefined ? undefined : normalizePath(written);
    const identity =
      uri ?? (path === undefined ? undefined : (uriOfPath.get(path) ?? path));
    if (identity === undefined) continue;
    if (!shownAs.has(identity)) shownAs.set(identity, written ?? identity);
    paths.set(call, shownAs.get(identity)!);
  }
  return paths;
}

/**
 * The distinct files the finished edits among `calls` changed, and how many
 * of those edits named no file.
 */
export function editedFiles(calls: ToolCall[]): {
  files: string[];
  unnamed: number;
} {
  const paths = editedPaths(calls);
  return {
    files: [...new Set(paths.values())],
    unnamed: calls.filter(isFinishedEdit).length - paths.size,
  };
}

/** Files changed since the latest real user prompt, and that prompt's text. */
export function turnEdits(history: ChatHistoryItem[]): {
  files: string[];
  request: string;
} {
  let start = 0;
  let request = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.message.role !== "user" || item.isAutoPrompt) continue;
    start = i + 1;
    const content = item.message.content;
    request =
      typeof content === "string"
        ? content
        : content.map((p) => (p.type === "text" ? p.text : "")).join("");
    break;
  }
  const { files } = editedFiles(
    history.slice(start).flatMap((item) => item.toolCallStates ?? []),
  );
  return { files, request };
}

/**
 * What this turn did to each file: created it, or the exact replacements it
 * made. Untracked files have no git diff, so the review uses these instead
 * of the whole file (which made old code look like new work).
 */
export function turnChanges(
  history: ChatHistoryItem[],
): Map<string, { created: boolean; edits: string[] }> {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user" && !history[i].isAutoPrompt) {
      start = i + 1;
      break;
    }
  }
  const out = new Map<string, { created: boolean; edits: string[] }>();
  const calls = history
    .slice(start)
    .flatMap((item) => item.toolCallStates ?? []);
  // Keyed like turnEdits().files, so both spellings of a file are one entry.
  for (const [call, file] of editedPaths(calls)) {
    const name = call.toolCall.function.name;
    const args = (call.parsedArgs ?? {}) as Record<string, any>;
    const entry = out.get(file) ?? { created: false, edits: [] };
    if (name === BuiltInToolNames.CreateNewFile) entry.created = true;
    const pairs: Array<{ old_string?: string; new_string?: string }> =
      Array.isArray(args.edits) ? args.edits : [args];
    for (const p of pairs) {
      if (typeof p.new_string !== "string") continue;
      const minus = String(p.old_string ?? "")
        .split("\n")
        .map((l) => `-${l}`);
      const plus = p.new_string.split("\n").map((l) => `+${l}`);
      entry.edits.push([...minus, ...plus].join("\n"));
    }
    out.set(file, entry);
  }
  return out;
}

/** This turn's replacements in one untracked file, as a diff. */
export function editsDiff(file: string, edits: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `+++ b/${file}`,
    ...edits.map((e) => `@@\n${e}`),
  ].join("\n");
}

/** Files of this turn with no hunk in the diff (new, untracked files). */
export function filesMissingFromDiff(diff: string, files: string[]): string[] {
  return files.filter((f) => !diff.includes(normalizePath(f)));
}

/** A new file rendered as an added-file diff so the reviewer sees it. */
export function newFileDiff(file: string, contents: string): string {
  const lines = contents.split("\n").slice(0, 200);
  return [
    `diff --git a/${file} b/${file}`,
    "new file",
    `+++ b/${file}`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");
}

/** Keep the diff hunks for the changed files, capped for a cheap review. */
export function diffForFiles(diffs: string[], files: string[]): string {
  const wanted = files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, ""));
  const parts = diffs
    .join("\n")
    .split(/(?=^diff --git )/m)
    .filter((part) => wanted.some((f) => part.includes(f)));
  // Only this turn's files: other uncommitted changes in the repo are not
  // the agent's work and made the review comment on unrelated files.
  const diff = parts.join("\n");
  return diff.length > SIDE_REVIEW_MAX_DIFF_CHARS
    ? `${diff.slice(0, SIDE_REVIEW_MAX_DIFF_CHARS)}\n[... diff truncated ...]`
    : diff;
}

export function sideReviewPrompt(request: string, diff: string): string {
  return `You are reviewing changes an AI coding agent just made, to tell the developer what they should know.

The developer asked:
${request.slice(0, 1500)}

The diff:
${diff}

List at most 3 concrete problems a careful senior engineer would flag. Use exactly one of these prefixes for every line:
[block] file: a security problem, likely correctness bug, broken boundary, or missing evidence that makes completion unsafe.
[warn] file: a non-blocking concern that is useful to mention but must not prevent completion.
Do not treat style, naming, or an optional extra test as [block]. Name the file. If nothing is worth flagging, reply exactly: NONE.`;
}

/** Parse the strict review protocol. Unstructured output is not reliable. */
export function parseSideReviewResult(text: string): SideReviewResult {
  const trimmed = text.trim();
  if (!trimmed) return { blocking: [], warnings: [], reliable: false };
  if (/^none\.?$/i.test(trimmed))
    return { blocking: [], warnings: [], reliable: true };
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 3) return { blocking: [], warnings: [], reliable: false };
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\[(block|warn)\]\s+(.+)$/i);
    if (!match) return { blocking: [], warnings: [], reliable: false };
    const formatted = `- ${match[2].trim()}`;
    if (match[1].toLowerCase() === "block") blocking.push(formatted);
    else warnings.push(formatted);
  }
  return { blocking, warnings, reliable: true };
}

/** The note to show, or null when the reviewer found nothing. */
export function parseSideReview(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /^none\.?$/i.test(trimmed)) return null;
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, 3);
  return lines.length ? lines.join("\n") : null;
}
