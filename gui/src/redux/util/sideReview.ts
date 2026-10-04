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
  const files = new Set<string>();
  for (const item of history.slice(start)) {
    for (const call of item.toolCallStates ?? []) {
      if (call.status !== "done") continue;
      if (!EDIT_TOOLS.has(call.toolCall.function.name)) continue;
      const filepath = (call.parsedArgs as { filepath?: unknown })?.filepath;
      if (typeof filepath === "string") files.add(filepath);
    }
  }
  return { files: [...files], request };
}

const normalizePath = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

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

List at most 3 concrete problems a careful senior engineer would flag: a secret or credential in code, debug or leftover code, a likely bug or broken import, missing error handling at a boundary, a change outside what was asked, or a test that should exist and does not.
One short line each, starting with "- ". Name the file.
If nothing is worth flagging, reply exactly: NONE`;
}

/** The note to show, or null when the reviewer found nothing. */
export function parseSideReview(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /^none\.?$/i.test(trimmed)) return null;
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .slice(0, 3);
  return lines.length ? lines.join("\n") : null;
}
