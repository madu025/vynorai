import { markdownToRule } from "@continuedev/config-yaml";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDE, RuleWithSource } from "../..";
import { localPathToUri } from "../../util/pathToUri";
import { getGlobalFolderWithName } from "../../util/paths";
import { joinPathsToUri } from "../../util/uri";

/** Personal, uncommitted instructions next to the project's own, loaded last. */
export const LOCAL_AGENT_FILES = ["CLAUDE.local.md", "AGENTS.local.md"];

const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "AGENT.md", "CLAUDE.md"];
const MAX_ANCESTOR_LEVELS = 4;

function toRule(content: string, fileUri: string): RuleWithSource {
  const rule = markdownToRule(content, { uriType: "file", fileUri });
  return {
    ...rule,
    source: "agentFile",
    sourceFile: fileUri,
    alwaysApply: true,
  };
}

async function readIfExists(
  ide: IDE,
  uri: string,
): Promise<string | undefined> {
  try {
    if (!(await ide.fileExists(uri))) return undefined;
    const content = await ide.readFile(uri);
    return content.trim() ? content : undefined;
  } catch {
    return undefined;
  }
}

/**
 * CLAUDE.local.md / AGENTS.local.md in a workspace root: instructions that stay
 * on this machine. Not imported (`@path`) or expanded: they apply as written.
 */
export async function loadLocalInstructionRules(
  ide: IDE,
  workspaceDir: string,
  alreadyLoaded: Set<string>,
): Promise<RuleWithSource[]> {
  const rules: RuleWithSource[] = [];
  for (const name of LOCAL_AGENT_FILES) {
    const uri = joinPathsToUri(workspaceDir, name);
    const content = await readIfExists(ide, uri);
    if (!content || alreadyLoaded.has(content.trim())) continue;
    alreadyLoaded.add(content.trim());
    try {
      rules.push(toRule(content, uri));
    } catch {
      // an unparseable personal file is skipped like any other agent file
    }
  }
  return rules;
}

/** Folders above a workspace root that may hold shared instructions, outermost first. */
export function ancestorDirs(workspaceDir: string): string[] {
  let local: string;
  try {
    local = fileURLToPath(workspaceDir);
  } catch {
    return []; // remote or virtual workspace: no local parents to read
  }
  const home = path.resolve(os.homedir());
  const insideHome = path.resolve(local).startsWith(home + path.sep);
  const dirs: string[] = [];
  let current = path.dirname(path.resolve(local));
  for (let level = 0; level < MAX_ANCESTOR_LEVELS; level++) {
    const parent = path.dirname(current);
    // Never the drive or filesystem root, and never above the home folder.
    if (parent === current) break;
    if (
      insideHome &&
      !(current === home || current.startsWith(home + path.sep))
    )
      break;
    dirs.push(current);
    if (current === home) break;
    current = parent;
  }
  return dirs.reverse();
}

/**
 * Instructions that apply to every project: the user's global files, then the
 * AGENTS.md / CLAUDE.md of each folder above the workspace (like Claude Code),
 * outermost first so the closest ones read last. Imports are not expanded:
 * these files live outside the workspace.
 */
export async function loadOuterInstructionRules(
  ide: IDE,
  workspaceDirs: string[],
  alreadyLoaded: Set<string>,
): Promise<RuleWithSource[]> {
  const candidates: string[] = [];
  const home = os.homedir();
  candidates.push(
    localPathToUri(path.join(home, ".claude", "CLAUDE.md")),
    ...INSTRUCTION_FILE_NAMES.map((name) =>
      localPathToUri(getGlobalFolderWithName(name)),
    ),
  );
  for (const dir of workspaceDirs) {
    for (const ancestor of ancestorDirs(dir)) {
      for (const name of INSTRUCTION_FILE_NAMES) {
        candidates.push(localPathToUri(path.join(ancestor, name)));
      }
    }
  }

  const rules: RuleWithSource[] = [];
  const seenFiles = new Set<string>();
  for (const uri of candidates) {
    if (seenFiles.has(uri)) continue;
    seenFiles.add(uri);
    const content = await readIfExists(ide, uri);
    if (!content || alreadyLoaded.has(content.trim())) continue;
    alreadyLoaded.add(content.trim());
    try {
      rules.push(toRule(content, uri));
    } catch {
      // skip an unparseable file
    }
  }
  return rules;
}
