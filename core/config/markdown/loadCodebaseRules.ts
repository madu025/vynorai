import {
  ConfigValidationError,
  markdownToRule,
} from "@continuedev/config-yaml";
import { IDE, RuleWithSource } from "../..";
import { walkDirs } from "../../indexing/walkDir";
import {
  isNestedAgentInstructionFile,
  RULES_MARKDOWN_FILENAME,
} from "../../llm/rules/constants";
import { findUriInDirs, getUriPathBasename } from "../../util/uri";
import { expandInstructionImports } from "./expandInstructionImports";

export class CodebaseRulesCache {
  private static instance: CodebaseRulesCache | null = null;
  private constructor() {}

  public static getInstance(): CodebaseRulesCache {
    if (CodebaseRulesCache.instance === null) {
      CodebaseRulesCache.instance = new CodebaseRulesCache();
    }
    return CodebaseRulesCache.instance;
  }
  rules: RuleWithSource[] = [];
  errors: ConfigValidationError[] = [];
  async refresh(ide: IDE) {
    const { rules, errors } = await loadCodebaseRules(ide);
    this.rules = rules;
    this.errors = errors;
  }
  /** Returns false when the file is not a codebase rule (e.g. a root agent file). */
  async update(ide: IDE, uri: string): Promise<boolean> {
    const content = await ide.readFile(uri);
    const workspaceDirs = await ide.getWorkspaceDirs();
    const { relativePathOrBasename, foundInDir } = findUriInDirs(
      uri,
      workspaceDirs,
    );
    if (!foundInDir) {
      console.warn(
        `Failed to load codebase rule ${uri}: URI not found in workspace`,
      );
    }
    const filename = getUriPathBasename(uri);
    if (
      filename !== RULES_MARKDOWN_FILENAME &&
      !isNestedAgentInstructionFile(filename, relativePathOrBasename)
    ) {
      return false; // root agent files load through loadMarkdownRules
    }
    const body =
      filename !== RULES_MARKDOWN_FILENAME && foundInDir
        ? await expandInstructionImports(content, uri, foundInDir, ide)
        : content;
    const rule = markdownToRule(
      body,
      {
        uriType: "file",
        fileUri: uri,
      },
      relativePathOrBasename,
    );
    const ruleWithSource: RuleWithSource = {
      ...rule,
      source: "colocated-markdown",
      sourceFile: uri,
    };
    const matchIdx = this.rules.findIndex((r) => r.sourceFile === uri);
    if (matchIdx === -1) {
      this.rules.push(ruleWithSource);
    } else {
      this.rules[matchIdx] = ruleWithSource;
    }
    return true;
  }
  remove(uri: string) {
    this.rules = this.rules.filter((r) => r.sourceFile !== uri);
  }
}

/**
 * Loads rules from rules.md files colocated in the codebase
 */
export async function loadCodebaseRules(ide: IDE): Promise<{
  rules: RuleWithSource[];
  errors: ConfigValidationError[];
}> {
  const errors: ConfigValidationError[] = [];
  const rules: RuleWithSource[] = [];

  try {
    // Get all files from the workspace
    const allFiles = await walkDirs(ide);

    // rules.md anywhere, plus agent files below the workspace root. Root agent
    // files are excluded here: loadMarkdownRules loads them (always applied).
    const workspaceDirsForFilter = await ide.getWorkspaceDirs();
    const rulesMdFiles = allFiles.filter((file) => {
      const filename = getUriPathBasename(file);
      if (filename === RULES_MARKDOWN_FILENAME) return true;
      return isNestedAgentInstructionFile(
        filename,
        findUriInDirs(file, workspaceDirsForFilter).relativePathOrBasename,
      );
    });

    // Process each rules.md file
    for (const filePath of rulesMdFiles) {
      try {
        const content = await ide.readFile(filePath);
        const { relativePathOrBasename, foundInDir, uri } = findUriInDirs(
          filePath,
          await ide.getWorkspaceDirs(),
        );
        if (foundInDir) {
          const lastSlashIndex = relativePathOrBasename.lastIndexOf("/");
          const parentDir = relativePathOrBasename.substring(0, lastSlashIndex);
          const body =
            getUriPathBasename(filePath) !== RULES_MARKDOWN_FILENAME
              ? await expandInstructionImports(content, uri, foundInDir, ide)
              : content;
          const rule = markdownToRule(
            body,
            {
              uriType: "file",
              fileUri: uri,
            },
            parentDir,
          );

          rules.push({
            ...rule,
            source: "colocated-markdown",
            sourceFile: filePath,
          });
        } else {
          console.warn(
            `Failed to load codebase rule ${uri}: URI not found in workspace dirs`,
          );
        }
      } catch (e) {
        errors.push({
          fatal: false,
          message: `Failed to parse colocated rule file ${filePath}: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
  } catch (e) {
    errors.push({
      fatal: false,
      message: `Error loading colocated rule files: ${e instanceof Error ? e.message : e}`,
    });
  }

  return { rules, errors };
}
