import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolImpl } from ".";
import { classifyFileEdit } from "../../agent/autoApproval";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { crossFileRefactorEngine } from "../patch/crossFileRefactorEngine";
import {
  applySpeculativeDiff,
  resolveInsideRoot,
} from "../patch/speculativeDiffEngine";

const MAX_LISTED = 30;

async function localWorkspaceRoots(
  extras: Parameters<ToolImpl>[1],
): Promise<string[]> {
  const dirs = (await extras.ide.getWorkspaceDirs()) ?? [];
  const roots: string[] = [];
  for (const dir of dirs) {
    if (!dir.startsWith("file:")) continue;
    try {
      roots.push(fileURLToPath(dir));
    } catch {
      // not a local path
    }
  }
  return roots;
}

function fail(message: string): never {
  throw new ContinueError(ContinueErrorReason.Unspecified, message);
}

/** The diff's own paths: sensitive files always need the user's hands. */
function refuseSensitive(relPaths: string[], root: string): void {
  for (const rel of relPaths) {
    const verdict = classifyFileEdit(rel, [root]);
    if (verdict.decision !== "auto") {
      fail(
        `${rel}: ${verdict.reason ?? "this file needs a manual edit"} Edit it yourself or use the normal edit tools so you can approve it.`,
      );
    }
  }
}

function listed(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).map((p) => `- ${p}`);
  const more =
    items.length > MAX_LISTED
      ? [`…and ${items.length - MAX_LISTED} more.`]
      : [];
  return [...shown, ...more].join("\n");
}

export const applyDiffImpl: ToolImpl = async (args, extras) => {
  const diff = typeof args?.diff === "string" ? args.diff : "";
  if (!diff.trim()) fail("apply_diff needs a non-empty 'diff' string.");
  const roots = await localWorkspaceRoots(extras);
  if (roots.length === 0) {
    fail("apply_diff needs an open local workspace folder.");
  }
  const root = roots[0];
  const wantWrite = args?.dry_run !== true;

  // Always validate in memory first; write only when everything applies.
  let preview;
  try {
    preview = await applySpeculativeDiff(diff, {
      workspaceRoot: root,
      dryRun: true,
    });
  } catch (err: any) {
    fail(err?.message ?? String(err));
  }
  if (!preview.success) {
    const failing = Object.values(preview.fileOutcomes)
      .filter((o) => !o.success)
      .map((o) => `${o.filePath}: ${o.error ?? o.syntaxError ?? "failed"}`);
    fail(
      `Diff not applied (${preview.status}). ${preview.error ?? ""}\n${listed(failing)}\nNothing was written. Re-read the files and send a diff against their current content.`.trim(),
    );
  }
  refuseSensitive(preview.modifiedFiles, root);

  let result = preview;
  if (wantWrite) {
    try {
      result = await applySpeculativeDiff(diff, { workspaceRoot: root });
    } catch (err: any) {
      fail(err?.message ?? String(err));
    }
    if (!result.success) {
      fail(`Diff not applied (${result.status}). ${result.error ?? ""}`.trim());
    }
  }

  const summary = `${wantWrite ? "Applied" : "Checked (dry run, nothing written)"}: ${result.modifiedFiles.length} file(s), ${result.appliedHunks}/${result.totalHunks} hunk(s), +${result.linesAdded} -${result.linesDeleted}.`;
  return [
    {
      name: "Apply diff",
      description: wantWrite ? "diff applied" : "diff checked",
      content: `${summary}\n${listed(result.modifiedFiles)}${wantWrite ? "\nRun get_diagnostics or the tests to confirm the change." : ""}`,
    },
  ];
};

export const renameSymbolImpl: ToolImpl = async (args, extras) => {
  const symbol = typeof args?.symbol === "string" ? args.symbol.trim() : "";
  const newName =
    typeof args?.new_name === "string" ? args.new_name.trim() : "";
  if (!symbol || !newName) {
    fail("rename_symbol needs 'symbol' and 'new_name'.");
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(newName)) {
    fail(`"${newName}" is not a valid identifier.`);
  }
  const roots = await localWorkspaceRoots(extras);
  if (roots.length === 0) {
    fail("rename_symbol needs an open local workspace folder.");
  }
  const root = roots[0];
  let definingFilePath: string | undefined;
  if (typeof args?.defining_file === "string" && args.defining_file.trim()) {
    try {
      definingFilePath = resolveInsideRoot(root, args.defining_file.trim());
    } catch (err: any) {
      fail(err?.message ?? String(err));
    }
  }
  const dryRun = args?.dry_run === true;

  // Dry run first: sensitive files must never be rewritten here.
  const plan = await crossFileRefactorEngine.renameSymbol({
    projectRoot: root,
    targetSymbol: symbol,
    newSymbolName: newName,
    definingFilePath,
    dryRun: true,
  });
  if (!plan.success) {
    fail(plan.error ?? `Could not rename ${symbol}.`);
  }
  const rel = (p: string) => path.relative(root, p) || p;
  refuseSensitive(
    plan.candidates.map((c) => rel(c.filePath)),
    root,
  );

  let result = plan;
  if (!dryRun) {
    result = await crossFileRefactorEngine.renameSymbol({
      projectRoot: root,
      targetSymbol: symbol,
      newSymbolName: newName,
      definingFilePath,
      dryRun: false,
    });
    if (!result.success) fail(result.error ?? `Could not rename ${symbol}.`);
  }
  const files = (
    dryRun ? plan.candidates.map((c) => c.filePath) : result.filesModified
  ).map(rel);
  return [
    {
      name: "Rename symbol",
      description: dryRun ? "rename planned" : "rename applied",
      content: `${dryRun ? "Would rename" : "Renamed"} ${symbol} to ${newName}: ${result.totalReplacements} replacement(s) in ${files.length} file(s).\n${listed(files)}${dryRun ? "" : "\nRun get_diagnostics or the typecheck to confirm."}`,
    },
  ];
};
