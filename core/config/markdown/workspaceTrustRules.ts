import { ConfigValidationError } from "@continuedev/config-yaml";
import { IDE, RuleWithSource } from "../..";
import { findUriInDirs } from "../../util/uri";

export const UNTRUSTED_RULES_MESSAGE =
  "Project instructions were not loaded because this workspace is not trusted. Trust the workspace to use its CLAUDE.md, AGENTS.md and rule files.";

function isInWorkspace(rule: RuleWithSource, workspaceDirs: string[]) {
  if (!rule.sourceFile) return false;
  try {
    return findUriInDirs(rule.sourceFile, workspaceDirs).foundInDir !== null;
  } catch {
    // A source that is not a valid URI cannot be placed: treat it as project content.
    return true;
  }
}

/**
 * A repository's own instruction files (CLAUDE.md, AGENTS.md, .continue/rules,
 * colocated rules) steer the agent, so an untrusted workspace must not inject
 * them. Global and parent-folder files stay: the user put those there.
 * An IDE without a trust API counts as trusted, as in the hook and MCP gates.
 */
export async function gateWorkspaceRules(
  ide: IDE,
  rules: RuleWithSource[],
): Promise<{ rules: RuleWithSource[]; errors: ConfigValidationError[] }> {
  if (!ide.isWorkspaceTrusted) return { rules, errors: [] };
  const trusted = await ide.isWorkspaceTrusted().catch(() => false);
  if (trusted) return { rules, errors: [] };

  const workspaceDirs = await ide.getWorkspaceDirs().catch(() => []);
  const kept = rules.filter((rule) => !isInWorkspace(rule, workspaceDirs));
  const dropped = rules.length - kept.length;
  return {
    rules: kept,
    errors:
      dropped > 0 ? [{ fatal: false, message: UNTRUSTED_RULES_MESSAGE }] : [],
  };
}
