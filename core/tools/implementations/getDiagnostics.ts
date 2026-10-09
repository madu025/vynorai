import { ToolImpl } from ".";
import { Problem } from "../..";
import { resolveInputPath } from "../../util/pathResolver";
import { getUriDescription } from "../../util/uri";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

const MAX_LISTED = 40;
const SEVERITY_ORDER = ["error", "warning", "info", "hint"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

/** A missing or unknown severity counts as an error, everywhere. */
function severityOf(problem: Problem): Severity {
  return SEVERITY_ORDER.includes(problem.severity as Severity)
    ? (problem.severity as Severity)
    : "error";
}

/** Errors first, then warnings, at most MAX_LISTED lines, paths relative to the project. */
export function formatDiagnostics(
  problems: Problem[],
  workspaceDirs: string[],
): string {
  if (problems.length === 0) {
    return "No errors or warnings reported by the editor (language servers can take a moment after an edit; this does not run the build or tests).";
  }
  const rank = (problem: Problem) =>
    SEVERITY_ORDER.indexOf(severityOf(problem));
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
    return `${severityOf(problem)} ${where}${source}: ${message}`;
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
  if (!uri) {
    // getProblems() without a file means "the open file"; with none open the
    // answer would be empty, which must not read as a clean result.
    const current = await extras.ide.getCurrentFile().catch(() => undefined);
    if (!current || current.isUntitled) {
      return [
        {
          name: "Diagnostics",
          description: "no file",
          content:
            "No file is open and no filepath was given, so nothing was checked. Pass the filepath of the file to check.",
        },
      ];
    }
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
