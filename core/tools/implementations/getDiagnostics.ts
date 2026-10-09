import { ToolImpl } from ".";
import { Problem } from "../..";
import { resolveInputPath } from "../../util/pathResolver";
import { getUriDescription } from "../../util/uri";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

const MAX_LISTED = 40;
const SEVERITY_ORDER = ["error", "warning", "info", "hint"] as const;

/** Errors first, then warnings, at most MAX_LISTED lines, paths relative to the project. */
export function formatDiagnostics(
  problems: Problem[],
  workspaceDirs: string[],
): string {
  if (problems.length === 0) return "No errors or warnings reported.";
  const rank = (problem: Problem) =>
    SEVERITY_ORDER.indexOf(problem.severity ?? "error");
  const sorted = [...problems].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.filepath.localeCompare(b.filepath) ||
      a.range.start.line - b.range.start.line,
  );
  const lines = sorted.slice(0, MAX_LISTED).map((problem) => {
    const { relativePathOrBasename } = getUriDescription(
      problem.filepath,
      workspaceDirs,
    );
    const where = `${relativePathOrBasename}:${problem.range.start.line + 1}:${problem.range.start.character + 1}`;
    const source = problem.source ? ` [${problem.source}]` : "";
    const message = problem.message.replace(/\s+/g, " ").slice(0, 300);
    return `${problem.severity ?? "error"} ${where}${source}: ${message}`;
  });
  const errors = problems.filter((p) => rank(p) === 0).length;
  const header = `${errors} error(s), ${problems.length - errors} other problem(s)`;
  const more =
    problems.length > MAX_LISTED
      ? [`…and ${problems.length - MAX_LISTED} more not shown.`]
      : [];
  return [header, ...lines, ...more].join("\n");
}

export const getDiagnosticsImpl: ToolImpl = async (args, extras) => {
  const requested =
    args && typeof args === "object" && "filepath" in args
      ? String((args as { filepath?: unknown }).filepath ?? "").trim()
      : "";
  let uri: string | undefined;
  if (requested) {
    const resolved = await resolveInputPath(extras.ide, requested);
    if (!resolved) {
      throw new ContinueError(
        ContinueErrorReason.FileNotFound,
        `File "${requested}" does not exist or is not accessible.`,
      );
    }
    uri = resolved.uri;
  }
  const problems = await extras.ide.getProblems(uri);
  const workspaceDirs = (await extras.ide.getWorkspaceDirs()) ?? [];
  return [
    {
      name: "Diagnostics",
      description: requested || "the file open in the editor",
      content: formatDiagnostics(problems, workspaceDirs),
    },
  ];
};
