import {
  ConfigValidationError,
  markdownToRule,
} from "@continuedev/config-yaml";
import { IDE, RuleWithSource } from "../..";
import { PROMPTS_DIR_NAME, RULES_DIR_NAME } from "../../promptFiles";
import { joinPathsToUri } from "../../util/uri";
import { getActiveRootUri } from "../../workspace/activeRootProvider";
import { expandInstructionImports } from "./expandInstructionImports";
import {
  loadLocalInstructionRules,
  loadOuterInstructionRules,
} from "./loadInstructionFiles";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";

export const SUPPORTED_AGENT_FILES = ["AGENTS.md", "AGENT.md", "CLAUDE.md"];
/**
 * Loads rules from markdown files in the .continue/rules and .continue/prompts directories
 * and agent files (AGENTS.md, AGENT.md, CLAUDE.md) at workspace root
 */
export async function loadMarkdownRules(ide: IDE): Promise<{
  rules: RuleWithSource[];
  errors: ConfigValidationError[];
}> {
  const errors: ConfigValidationError[] = [];
  const rules: RuleWithSource[] = [];

  // First, try to load agent files from workspace root
  const workspaceDirs = await ide.getWorkspaceDirs();

  for (const workspaceDir of workspaceDirs) {
    // Every supported agent file in a root is loaded, so a repo that keeps
    // both AGENTS.md and CLAUDE.md gets both. A file whose content is
    // identical to one already loaded (a copy or a symlink) is skipped.
    const loadedContent = new Set<string>();
    // Agent files that exist in this root load as their own rules, so one file
    // importing another (CLAUDE.md with `@AGENTS.md`) must not repeat it.
    const siblingAgentFiles: string[] = [];
    for (const name of SUPPORTED_AGENT_FILES) {
      const uri = joinPathsToUri(workspaceDir, name);
      try {
        if (await ide.fileExists(uri)) siblingAgentFiles.push(uri);
      } catch {
        // unreadable: not a sibling
      }
    }
    for (const fileName of SUPPORTED_AGENT_FILES) {
      try {
        const agentFileUri = joinPathsToUri(workspaceDir, fileName);
        const exists = await ide.fileExists(agentFileUri);
        if (exists) {
          const agentContent = await ide.readFile(agentFileUri);
          const normalized = agentContent.trim();
          if (loadedContent.has(normalized)) continue;
          loadedContent.add(normalized);

          // Inline `@path` imports (within this root) before parsing.
          const expandedContent = await expandInstructionImports(
            agentContent,
            agentFileUri,
            workspaceDir,
            ide,
            { skipUris: siblingAgentFiles.filter((u) => u !== agentFileUri) },
          );

          const rule = markdownToRule(expandedContent, {
            uriType: "file",
            fileUri: agentFileUri,
          });
          rules.push({
            ...rule,
            source: "agentFile",
            sourceFile: agentFileUri,
            alwaysApply: true,
          });
        }
      } catch (e) {
        // File doesn't exist or can't be read, continue to next file
      }
    }
    // CLAUDE.local.md / AGENTS.local.md: personal notes, read after the shared ones.
    rules.push(
      ...(await loadLocalInstructionRules(ide, workspaceDir, loadedContent)),
    );
  }

  // Agent files of the active root come first, so in a multi-root workspace
  // the project the user is working in leads the instructions. Every root's
  // files still load; only the order changes.
  const activeRootUri = await getActiveRootUri();
  if (activeRootUri && workspaceDirs.length > 1) {
    const prefix = activeRootUri.endsWith("/")
      ? activeRootUri
      : `${activeRootUri}/`;
    const inActiveRoot = (rule: RuleWithSource) =>
      rule.sourceFile?.startsWith(prefix) ?? false;
    rules.splice(
      0,
      rules.length,
      ...rules.filter(inActiveRoot),
      ...rules.filter((rule) => !inActiveRoot(rule)),
    );
  }

  // Global files and the AGENTS.md / CLAUDE.md of folders above the workspace
  // come first; the project's own files, which are more specific, read after.
  rules.unshift(
    ...(await loadOuterInstructionRules(
      ide,
      workspaceDirs,
      new Set(rules.map((rule) => rule.rule.trim())),
    )),
  );

  // Load markdown files from both .continue/rules and .continue/prompts
  const dirsToCheck = [RULES_DIR_NAME, PROMPTS_DIR_NAME];

  for (const dirName of dirsToCheck) {
    try {
      const markdownFiles = await getAllDotContinueDefinitionFiles(
        ide,
        {
          includeGlobal: true,
          includeWorkspace: true,
          fileExtType: "markdown",
        },
        dirName,
      );

      // Filter to just .md files
      const mdFiles = markdownFiles.filter((file) => file.path.endsWith(".md"));

      // Process each markdown file
      for (const file of mdFiles) {
        try {
          const rule = markdownToRule(file.content, {
            uriType: "file",
            fileUri: file.path,
          });
          if (!rule.invokable) {
            rules.push({
              ...rule,
              source: "rules-block",
              sourceFile: file.path,
            });
          }
        } catch (e) {
          errors.push({
            fatal: false,
            message: `Failed to parse markdown rule file ${file.path}: ${e instanceof Error ? e.message : e}`,
          });
        }
      }
    } catch (e) {
      errors.push({
        fatal: false,
        message: `Error loading markdown rule files from ${dirName}: ${e instanceof Error ? e.message : e}`,
      });
    }
  }

  return { rules, errors };
}
