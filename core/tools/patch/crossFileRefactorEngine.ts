/**
 * VynorAI AST-Aware Cross-File Refactoring Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides safe, multi-file code refactoring operations backed by the
 * TypeScript Compiler AST API:
 *
 *  1. Multi-File Symbol Renaming:
 *     - Tracks symbol definitions (functions, classes, interfaces, types, variables)
 *     - Discovers export & import bindings (named, default, aliased, re-exports)
 *     - Updates reference & call sites across all importing files
 *     - Disambiguates local shadowing (avoids modifying unrelated local variables)
 *
 *  2. Import Path Rewrites (File Relocation):
 *     - Updates all relative import/export/require specifiers targeting moved files
 *     - Updates internal relative imports inside the moved file to match its new location
 *     - Preserves module extension conventions (.js / extensionless)
 *
 *  3. Atomic Syntax Validation & Rollback:
 *     - Validates candidate file contents in-memory via AST syntax checks
 *     - If ANY file produces a parse error, transaction is aborted with zero disk writes
 *     - Supports dry-run diff preview mode
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  validateCodeSyntax,
  SyntaxValidationResult,
} from "./syntaxValidator.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ReplacementSpan {
  start: number;
  end: number;
  newText: string;
  description?: string;
}

export interface FileRefactorCandidate {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  replacementsCount: number;
  syntaxValid: boolean;
  syntaxError?: string;
  diffPreview?: string;
}

export interface RenameSymbolOptions {
  projectRoot: string;
  targetSymbol: string;
  newSymbolName: string;
  definingFilePath?: string;
  dryRun?: boolean;
  fileExtensions?: string[];
  ignoreDirs?: string[];
}

export interface RewriteImportsOptions {
  projectRoot: string;
  oldFilePath: string;
  newFilePath: string;
  dryRun?: boolean;
  fileExtensions?: string[];
  ignoreDirs?: string[];
}

export interface RefactorResult {
  success: boolean;
  operation: "rename-symbol" | "rewrite-imports";
  filesModified: string[];
  totalReplacements: number;
  candidates: FileRefactorCandidate[];
  error?: string;
  diagnostics?: SyntaxValidationResult[];
  durationMs: number;
}

// ─── Engine Implementation ───────────────────────────────────────────────────

export class CrossFileRefactorEngine {
  private defaultExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  private defaultIgnoreDirs = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".vynor-worktrees",
    "coverage",
  ];

  /**
   * 1. Recursively find all supported code files in project root
   */
  public discoverProjectFiles(
    dir: string,
    extensions = this.defaultExtensions,
    ignoreDirs = this.defaultIgnoreDirs,
  ): string[] {
    const results: string[] = [];

    const walk = (currentDir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name)) {
            walk(path.join(currentDir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(path.join(currentDir, entry.name));
          }
        }
      }
    };

    walk(dir);
    return results;
  }

  /**
   * Parse TypeScript/JavaScript SourceFile AST
   */
  public parseSourceFile(filePath: string, content: string): ts.SourceFile {
    const ext = path.extname(filePath).toLowerCase();
    const scriptKind =
      ext === ".tsx"
        ? ts.ScriptKind.TSX
        : ext === ".jsx"
          ? ts.ScriptKind.JSX
          : ext === ".js" || ext === ".mjs" || ext === ".cjs"
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;

    return ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true, // setParentNodes
      scriptKind,
    );
  }

  // ─── 2. Cross-File Symbol Renaming ──────────────────────────────────────────

  /**
   * Renames a symbol across definition, exports, imports, and reference sites.
   */
  public async renameSymbol(
    options: RenameSymbolOptions,
  ): Promise<RefactorResult> {
    const t0 = performance.now();
    const {
      projectRoot,
      targetSymbol,
      newSymbolName,
      definingFilePath,
      dryRun = false,
      fileExtensions = this.defaultExtensions,
      ignoreDirs = this.defaultIgnoreDirs,
    } = options;

    if (!targetSymbol || !newSymbolName) {
      return {
        success: false,
        operation: "rename-symbol",
        filesModified: [],
        totalReplacements: 0,
        candidates: [],
        error: "targetSymbol and newSymbolName are required",
        durationMs: 0,
      };
    }

    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newSymbolName)) {
      return {
        success: false,
        operation: "rename-symbol",
        filesModified: [],
        totalReplacements: 0,
        candidates: [],
        error: `Invalid identifier name: "${newSymbolName}"`,
        durationMs: 0,
      };
    }

    const allFiles = this.discoverProjectFiles(
      projectRoot,
      fileExtensions,
      ignoreDirs,
    );
    const fileContents = new Map<string, string>();
    const fileAsts = new Map<string, ts.SourceFile>();

    for (const f of allFiles) {
      try {
        const text = fs.readFileSync(f, "utf-8");
        fileContents.set(f, text);
        fileAsts.set(f, this.parseSourceFile(f, text));
      } catch {
        // skip unreadable
      }
    }

    // Identify defining file(s)
    let candidateDefiningFiles: string[] = [];
    if (definingFilePath) {
      const absDef = path.isAbsolute(definingFilePath)
        ? definingFilePath
        : path.join(projectRoot, definingFilePath);
      candidateDefiningFiles = [absDef];
    } else {
      for (const [f, ast] of fileAsts.entries()) {
        if (this.hasTopLevelSymbolDeclaration(ast, targetSymbol)) {
          candidateDefiningFiles.push(f);
        }
      }
    }

    if (candidateDefiningFiles.length === 0) {
      return {
        success: false,
        operation: "rename-symbol",
        filesModified: [],
        totalReplacements: 0,
        candidates: [],
        error: `Symbol "${targetSymbol}" definition not found in project`,
        durationMs: Math.round(performance.now() - t0),
      };
    }

    const primaryDefiningFile = candidateDefiningFiles[0];
    const replacementSpansByFile = new Map<string, ReplacementSpan[]>();

    // Step A: Collect spans in defining file
    const defSpans = this.collectDefiningFileSpans(
      fileAsts.get(primaryDefiningFile)!,
      targetSymbol,
      newSymbolName,
    );
    if (defSpans.length > 0) {
      replacementSpansByFile.set(primaryDefiningFile, defSpans);
    }

    // Step B: Collect spans in all importing files
    for (const [filePath, ast] of fileAsts.entries()) {
      if (filePath === primaryDefiningFile) continue;

      const importInfo = this.checkIfImportsSymbol(
        ast,
        filePath,
        primaryDefiningFile,
        targetSymbol,
      );
      if (importInfo.importsTarget) {
        const spans = this.collectImportingFileSpans(
          ast,
          targetSymbol,
          newSymbolName,
          importInfo.localAlias,
        );
        if (spans.length > 0) {
          const existing = replacementSpansByFile.get(filePath) || [];
          replacementSpansByFile.set(filePath, [...existing, ...spans]);
        }
      }
    }

    // Step C: Apply candidate replacements in memory
    const candidates: FileRefactorCandidate[] = [];
    const diagnostics: SyntaxValidationResult[] = [];
    let hasSyntaxError = false;

    for (const [filePath, spans] of replacementSpansByFile.entries()) {
      const original = fileContents.get(filePath)!;
      const modified = this.applySpans(original, spans);

      // Validate candidate code syntax before any disk write
      const valResult = validateCodeSyntax(filePath, modified);
      if (!valResult.valid) {
        hasSyntaxError = true;
        diagnostics.push(valResult);
      }

      candidates.push({
        filePath,
        originalContent: original,
        modifiedContent: modified,
        replacementsCount: spans.length,
        syntaxValid: valResult.valid,
        syntaxError: valResult.error,
        diffPreview: this.generateQuickDiff(filePath, original, modified),
      });
    }

    const totalReplacements = candidates.reduce(
      (acc, c) => acc + c.replacementsCount,
      0,
    );

    // Step D: Atomic Rollback if any syntax failure detected
    if (hasSyntaxError) {
      return {
        success: false,
        operation: "rename-symbol",
        filesModified: [],
        totalReplacements,
        candidates,
        error: `Atomic rollback: Pre-flight syntax validation failed on ${diagnostics.length} file(s). Zero files written.`,
        diagnostics,
        durationMs: Math.round(performance.now() - t0),
      };
    }

    // Step E: Write to disk unless dryRun
    const filesModified: string[] = [];
    if (!dryRun) {
      for (const c of candidates) {
        fs.writeFileSync(c.filePath, c.modifiedContent, "utf-8");
        filesModified.push(c.filePath);
      }
    } else {
      filesModified.push(...candidates.map((c) => c.filePath));
    }

    return {
      success: true,
      operation: "rename-symbol",
      filesModified,
      totalReplacements,
      candidates,
      durationMs: Math.round(performance.now() - t0),
    };
  }

  // ─── 3. Import Path Rewrites (File Moving) ───────────────────────────────────

  /**
   * Rewrites import and export specifiers when a file is moved or renamed.
   */
  public async rewriteImportPaths(
    options: RewriteImportsOptions,
  ): Promise<RefactorResult> {
    const t0 = performance.now();
    const {
      projectRoot,
      oldFilePath,
      newFilePath,
      dryRun = false,
      fileExtensions = this.defaultExtensions,
      ignoreDirs = this.defaultIgnoreDirs,
    } = options;

    const absOld = path.isAbsolute(oldFilePath)
      ? oldFilePath
      : path.join(projectRoot, oldFilePath);
    const absNew = path.isAbsolute(newFilePath)
      ? newFilePath
      : path.join(projectRoot, newFilePath);

    const allFiles = this.discoverProjectFiles(
      projectRoot,
      fileExtensions,
      ignoreDirs,
    );
    const fileContents = new Map<string, string>();
    const fileAsts = new Map<string, ts.SourceFile>();

    for (const f of allFiles) {
      try {
        const text = fs.readFileSync(f, "utf-8");
        fileContents.set(f, text);
        fileAsts.set(f, this.parseSourceFile(f, text));
      } catch {
        // skip unreadable
      }
    }

    const replacementSpansByFile = new Map<string, ReplacementSpan[]>();

    // 3.1 Update other files that import the moved file
    for (const [filePath, ast] of fileAsts.entries()) {
      if (filePath === absOld) continue;

      const spans = this.collectImportPathSpans(ast, filePath, absOld, absNew);
      if (spans.length > 0) {
        replacementSpansByFile.set(filePath, spans);
      }
    }

    // 3.2 Update internal relative imports inside the moved file itself
    const movedAst = fileAsts.get(absOld) || fileAsts.get(absNew);
    if (movedAst) {
      const movedInternalSpans = this.collectInternalPathSpansForMovedFile(
        movedAst,
        absOld,
        absNew,
      );
      if (movedInternalSpans.length > 0) {
        const targetPath = fs.existsSync(absNew) ? absNew : absOld;
        const existing = replacementSpansByFile.get(targetPath) || [];
        replacementSpansByFile.set(targetPath, [
          ...existing,
          ...movedInternalSpans,
        ]);
      }
    }

    // 3.3 Apply candidate replacements in-memory and validate syntax
    const candidates: FileRefactorCandidate[] = [];
    const diagnostics: SyntaxValidationResult[] = [];
    let hasSyntaxError = false;

    for (const [filePath, spans] of replacementSpansByFile.entries()) {
      const original =
        fileContents.get(filePath) || fs.readFileSync(filePath, "utf-8");
      const modified = this.applySpans(original, spans);

      const valResult = validateCodeSyntax(filePath, modified);
      if (!valResult.valid) {
        hasSyntaxError = true;
        diagnostics.push(valResult);
      }

      candidates.push({
        filePath,
        originalContent: original,
        modifiedContent: modified,
        replacementsCount: spans.length,
        syntaxValid: valResult.valid,
        syntaxError: valResult.error,
        diffPreview: this.generateQuickDiff(filePath, original, modified),
      });
    }

    const totalReplacements = candidates.reduce(
      (acc, c) => acc + c.replacementsCount,
      0,
    );

    if (hasSyntaxError) {
      return {
        success: false,
        operation: "rewrite-imports",
        filesModified: [],
        totalReplacements,
        candidates,
        error: `Atomic rollback: Pre-flight syntax validation failed on ${diagnostics.length} file(s). Zero files written.`,
        diagnostics,
        durationMs: Math.round(performance.now() - t0),
      };
    }

    // 3.4 Write to disk unless dryRun
    const filesModified: string[] = [];
    if (!dryRun) {
      for (const c of candidates) {
        fs.writeFileSync(c.filePath, c.modifiedContent, "utf-8");
        filesModified.push(c.filePath);
      }
    } else {
      filesModified.push(...candidates.map((c) => c.filePath));
    }

    return {
      success: true,
      operation: "rewrite-imports",
      filesModified,
      totalReplacements,
      candidates,
      durationMs: Math.round(performance.now() - t0),
    };
  }

  // ─── AST Helpers: Symbol Scope & Replacements ───────────────────────────────

  /**
   * Check if SourceFile has a top-level declaration for the target symbol
   */
  private hasTopLevelSymbolDeclaration(
    sourceFile: ts.SourceFile,
    symbolName: string,
  ): boolean {
    let found = false;

    ts.forEachChild(sourceFile, (node) => {
      if (found) return;

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name?.text === symbolName
      ) {
        found = true;
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === symbolName) {
            found = true;
          }
        }
      }
    });

    return found;
  }

  /**
   * Collect all replacement spans in the defining file
   */
  private collectDefiningFileSpans(
    sourceFile: ts.SourceFile,
    targetSymbol: string,
    newSymbolName: string,
  ): ReplacementSpan[] {
    const spans: ReplacementSpan[] = [];

    const visit = (node: ts.Node, isShadowed: boolean) => {
      // Check for local shadowing (e.g., function parameter or inner variable with same name)
      let shadowedInSubtree = isShadowed;

      if (!isShadowed) {
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node)
        ) {
          // Check if parameters shadow the target symbol
          for (const param of node.parameters) {
            if (
              ts.isIdentifier(param.name) &&
              param.name.text === targetSymbol
            ) {
              // The body of this function shadows targetSymbol!
              shadowedInSubtree = true;
            }
          }
        }
      }

      // 1. Symbol declarations
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name?.text === targetSymbol
      ) {
        spans.push({
          start: node.name.getStart(sourceFile),
          end: node.name.getEnd(),
          newText: newSymbolName,
          description: "declaration",
        });
      }

      // 2. Variable declarations
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === targetSymbol
      ) {
        spans.push({
          start: node.name.getStart(sourceFile),
          end: node.name.getEnd(),
          newText: newSymbolName,
          description: "variable declaration",
        });
      }

      // 3. Export specifiers: export { targetSymbol } or export { targetSymbol as alias }
      if (ts.isExportSpecifier(node)) {
        if (node.propertyName && node.propertyName.text === targetSymbol) {
          spans.push({
            start: node.propertyName.getStart(sourceFile),
            end: node.propertyName.getEnd(),
            newText: newSymbolName,
            description: "export propertyName",
          });
        } else if (!node.propertyName && node.name.text === targetSymbol) {
          spans.push({
            start: node.name.getStart(sourceFile),
            end: node.name.getEnd(),
            newText: newSymbolName,
            description: "export name",
          });
        }
      }

      // 4. Identifiers in call expressions and expressions (when not shadowed)
      if (
        !shadowedInSubtree &&
        ts.isIdentifier(node) &&
        node.text === targetSymbol
      ) {
        const parent = node.parent;

        // Skip property names in object literals: { targetSymbol: value }
        if (ts.isPropertyAssignment(parent) && parent.name === node) {
          // only rename if shorthand: { targetSymbol }
        } else if (
          ts.isShorthandPropertyAssignment(parent) &&
          parent.name === node
        ) {
          spans.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            newText: newSymbolName,
            description: "shorthand property",
          });
        } else if (
          ts.isPropertyAccessExpression(parent) &&
          parent.name === node
        ) {
          // obj.targetSymbol - only rename if this is a static reference or target
        } else if (
          !ts.isFunctionDeclaration(parent) &&
          !ts.isClassDeclaration(parent) &&
          !ts.isInterfaceDeclaration(parent) &&
          !ts.isTypeAliasDeclaration(parent) &&
          !ts.isEnumDeclaration(parent) &&
          !ts.isVariableDeclaration(parent) &&
          !ts.isExportSpecifier(parent) &&
          !ts.isImportSpecifier(parent)
        ) {
          // Check if not already added
          const start = node.getStart(sourceFile);
          const end = node.getEnd();
          if (!spans.some((s) => s.start === start && s.end === end)) {
            spans.push({
              start,
              end,
              newText: newSymbolName,
              description: "identifier reference",
            });
          }
        }
      }

      ts.forEachChild(node, (child) => visit(child, shadowedInSubtree));
    };

    ts.forEachChild(sourceFile, (node) => visit(node, false));
    return spans;
  }

  /**
   * Check if a file imports the target symbol from the defining file
   */
  private checkIfImportsSymbol(
    sourceFile: ts.SourceFile,
    currentFilePath: string,
    definingFilePath: string,
    targetSymbol: string,
  ): { importsTarget: boolean; localAlias?: string } {
    let importsTarget = false;
    let localAlias: string | undefined;

    ts.forEachChild(sourceFile, (node) => {
      if (importsTarget) return;

      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        if (
          this.resolvesToTargetFile(
            specifier,
            currentFilePath,
            definingFilePath,
          )
        ) {
          const importClause = node.importClause;
          if (
            importClause &&
            importClause.namedBindings &&
            ts.isNamedImports(importClause.namedBindings)
          ) {
            for (const elem of importClause.namedBindings.elements) {
              const importedName = elem.propertyName
                ? elem.propertyName.text
                : elem.name.text;
              if (importedName === targetSymbol) {
                importsTarget = true;
                if (elem.propertyName) {
                  // e.g. import { targetSymbol as localAlias }
                  localAlias = elem.name.text;
                }
                break;
              }
            }
          }
        }
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        if (
          this.resolvesToTargetFile(
            specifier,
            currentFilePath,
            definingFilePath,
          )
        ) {
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const elem of node.exportClause.elements) {
              const exportedName = elem.propertyName
                ? elem.propertyName.text
                : elem.name.text;
              if (exportedName === targetSymbol) {
                importsTarget = true;
                break;
              }
            }
          }
        }
      }
    });

    return { importsTarget, localAlias };
  }

  /**
   * Collect spans in files that import the target symbol
   */
  private collectImportingFileSpans(
    sourceFile: ts.SourceFile,
    targetSymbol: string,
    newSymbolName: string,
    localAlias?: string,
  ): ReplacementSpan[] {
    const spans: ReplacementSpan[] = [];

    // If aliased (import { targetSymbol as myAlias }), we only rename the import specifier!
    // The usages in the file use `myAlias`, so they don't change.
    if (localAlias) {
      ts.forEachChild(sourceFile, (node) => {
        if (
          ts.isImportDeclaration(node) &&
          node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)
        ) {
          for (const elem of node.importClause.namedBindings.elements) {
            if (elem.propertyName && elem.propertyName.text === targetSymbol) {
              spans.push({
                start: elem.propertyName.getStart(sourceFile),
                end: elem.propertyName.getEnd(),
                newText: newSymbolName,
                description: "aliased import propertyName",
              });
            }
          }
        }
      });
      return spans;
    }

    // Otherwise, rename both the import specifier AND all references throughout the file
    const visit = (node: ts.Node, isShadowed: boolean) => {
      let shadowedInSubtree = isShadowed;

      // Shadowing detection
      if (!isShadowed) {
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node)
        ) {
          for (const param of node.parameters) {
            if (
              ts.isIdentifier(param.name) &&
              param.name.text === targetSymbol
            ) {
              shadowedInSubtree = true;
            }
          }
        } else if (ts.isBlock(node)) {
          for (const stmt of node.statements) {
            if (ts.isVariableStatement(stmt)) {
              for (const decl of stmt.declarationList.declarations) {
                if (
                  ts.isIdentifier(decl.name) &&
                  decl.name.text === targetSymbol
                ) {
                  shadowedInSubtree = true;
                }
              }
            }
          }
        }
      }

      // 1. Import Specifiers: import { targetSymbol }
      if (ts.isImportSpecifier(node)) {
        if (!node.propertyName && node.name.text === targetSymbol) {
          spans.push({
            start: node.name.getStart(sourceFile),
            end: node.name.getEnd(),
            newText: newSymbolName,
            description: "named import specifier",
          });
        } else if (
          node.propertyName &&
          node.propertyName.text === targetSymbol
        ) {
          spans.push({
            start: node.propertyName.getStart(sourceFile),
            end: node.propertyName.getEnd(),
            newText: newSymbolName,
            description: "named import propertyName",
          });
        }
      }

      // 1b. Export Specifiers: export { targetSymbol } from "./foo"
      if (ts.isExportSpecifier(node)) {
        if (!node.propertyName && node.name.text === targetSymbol) {
          spans.push({
            start: node.name.getStart(sourceFile),
            end: node.name.getEnd(),
            newText: newSymbolName,
            description: "re-export specifier",
          });
        } else if (
          node.propertyName &&
          node.propertyName.text === targetSymbol
        ) {
          spans.push({
            start: node.propertyName.getStart(sourceFile),
            end: node.propertyName.getEnd(),
            newText: newSymbolName,
            description: "re-export propertyName",
          });
        }
      }

      // 2. Reference usages (when not shadowed)
      if (
        !shadowedInSubtree &&
        ts.isIdentifier(node) &&
        node.text === targetSymbol
      ) {
        const parent = node.parent;

        if (
          !ts.isImportSpecifier(parent) &&
          !ts.isExportSpecifier(parent) &&
          !ts.isPropertyAccessExpression(parent) &&
          !(ts.isPropertyAssignment(parent) && parent.name === node)
        ) {
          const start = node.getStart(sourceFile);
          const end = node.getEnd();
          if (!spans.some((s) => s.start === start && s.end === end)) {
            spans.push({
              start,
              end,
              newText: newSymbolName,
              description: "import reference site",
            });
          }
        }
      }

      ts.forEachChild(node, (child) => visit(child, shadowedInSubtree));
    };

    ts.forEachChild(sourceFile, (node) => visit(node, false));
    return spans;
  }

  // ─── AST Helpers: Import Path Specifiers ────────────────────────────────────

  /**
   * Collect spans for rewriting import specifiers targeting the moved file
   */
  private collectImportPathSpans(
    sourceFile: ts.SourceFile,
    currentFilePath: string,
    oldTargetFilePath: string,
    newTargetFilePath: string,
  ): ReplacementSpan[] {
    const spans: ReplacementSpan[] = [];

    const checkSpecifier = (literalNode: ts.StringLiteral) => {
      const specifier = literalNode.text;
      if (
        this.resolvesToTargetFile(specifier, currentFilePath, oldTargetFilePath)
      ) {
        const hasJsExt =
          specifier.endsWith(".js") || specifier.endsWith(".mjs");
        const newSpecifier = this.computeRelativeModuleSpecifier(
          currentFilePath,
          newTargetFilePath,
          hasJsExt,
        );

        // Node start/end includes quotes!
        const start = literalNode.getStart(sourceFile);
        const end = literalNode.getEnd();
        const rawQuote = sourceFile.text.charAt(start);
        const quoteChar = rawQuote === "'" ? "'" : '"';

        spans.push({
          start,
          end,
          newText: `${quoteChar}${newSpecifier}${quoteChar}`,
          description: `rewrite import: ${specifier} -> ${newSpecifier}`,
        });
      }
    };

    const visit = (node: ts.Node) => {
      // 1. Static Import Declaration: import ... from './foo'
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        checkSpecifier(node.moduleSpecifier);
      }
      // 2. Export Declaration: export ... from './foo'
      else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        checkSpecifier(node.moduleSpecifier);
      }
      // 3. Dynamic Import or require: import('./foo') or require('./foo')
      else if (ts.isCallExpression(node)) {
        const isDynamicImport =
          node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire =
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require";

        if ((isDynamicImport || isRequire) && node.arguments.length > 0) {
          const firstArg = node.arguments[0];
          if (ts.isStringLiteral(firstArg)) {
            checkSpecifier(firstArg);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return spans;
  }

  /**
   * Collect spans for rewriting relative imports INSIDE the moved file itself
   */
  private collectInternalPathSpansForMovedFile(
    sourceFile: ts.SourceFile,
    oldMovedFilePath: string,
    newMovedFilePath: string,
  ): ReplacementSpan[] {
    const spans: ReplacementSpan[] = [];
    const oldDir = path.dirname(oldMovedFilePath);
    const newDir = path.dirname(newMovedFilePath);

    if (oldDir === newDir) {
      return spans; // directory didn't change, relative imports remain identical
    }

    const checkSpecifier = (literalNode: ts.StringLiteral) => {
      const specifier = literalNode.text;
      // Only process relative imports: starting with ./ or ../
      if (!specifier.startsWith(".")) return;

      // Resolve what absolute file this was pointing to from the OLD location
      const resolvedTarget = path.resolve(oldDir, specifier);
      const hasJsExt = specifier.endsWith(".js") || specifier.endsWith(".mjs");

      // Compute what relative path is needed from the NEW location
      const newRelative = this.computeRelativeModuleSpecifier(
        newMovedFilePath,
        resolvedTarget,
        hasJsExt,
      );

      const start = literalNode.getStart(sourceFile);
      const end = literalNode.getEnd();
      const rawQuote = sourceFile.text.charAt(start);
      const quoteChar = rawQuote === "'" ? "'" : '"';

      spans.push({
        start,
        end,
        newText: `${quoteChar}${newRelative}${quoteChar}`,
        description: `internal relative rewrite: ${specifier} -> ${newRelative}`,
      });
    };

    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        checkSpecifier(node.moduleSpecifier);
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        checkSpecifier(node.moduleSpecifier);
      } else if (ts.isCallExpression(node)) {
        const isDynamicImport =
          node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire =
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require";
        if (
          (isDynamicImport || isRequire) &&
          node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          checkSpecifier(node.arguments[0] as ts.StringLiteral);
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return spans;
  }

  // ─── Module Resolution & Path Arithmetic ────────────────────────────────────

  /**
   * Determine if a module specifier resolves to the target file
   */
  public resolvesToTargetFile(
    specifier: string,
    importerFilePath: string,
    targetFilePath: string,
  ): boolean {
    if (!specifier.startsWith(".")) return false;

    const importerDir = path.dirname(importerFilePath);
    const resolvedPath = path.resolve(importerDir, specifier);

    // Normalize slashes
    const normResolved = path.normalize(resolvedPath).toLowerCase();
    const normTarget = path.normalize(targetFilePath).toLowerCase();

    if (normResolved === normTarget) return true;

    // Check with stripped/added extensions
    const targetExt = path.extname(normTarget);
    const targetWithoutExt = targetExt
      ? normTarget.slice(0, -targetExt.length)
      : normTarget;

    const resolvedExt = path.extname(normResolved);
    const resolvedWithoutExt = resolvedExt
      ? normResolved.slice(0, -resolvedExt.length)
      : normResolved;

    if (resolvedWithoutExt === targetWithoutExt) return true;

    // Check index file resolution (e.g. ./utils -> ./utils/index.ts)
    if (
      normTarget.endsWith(path.sep + "index.ts") ||
      normTarget.endsWith(path.sep + "index.js")
    ) {
      const targetParent = path.dirname(normTarget);
      if (
        normResolved === targetParent ||
        resolvedWithoutExt === targetParent
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compute relative module specifier from importer to target file
   */
  public computeRelativeModuleSpecifier(
    importerFilePath: string,
    targetFilePath: string,
    preserveJsExt = false,
  ): string {
    const importerDir = path.dirname(importerFilePath);
    let relPath = path.relative(importerDir, targetFilePath);

    // Ensure forward slashes for JavaScript/TypeScript module imports
    relPath = relPath.split(path.sep).join("/");

    // Strip extension unless preserveJsExt
    const ext = path.extname(relPath);
    if (!preserveJsExt && ext) {
      relPath = relPath.slice(0, -ext.length);
    } else if (preserveJsExt && ext) {
      if (ext === ".ts" || ext === ".tsx") {
        relPath = relPath.slice(0, -ext.length) + ".js";
      }
    }

    // Ensure leading ./ if not starting with ../
    if (!relPath.startsWith("./") && !relPath.startsWith("../")) {
      relPath = "./" + relPath;
    }

    return relPath;
  }

  // ─── String Span Replacement & Diff Generation ─────────────────────────────

  /**
   * Apply replacement spans to original content (sorted descending by position)
   */
  public applySpans(content: string, spans: ReplacementSpan[]): string {
    if (spans.length === 0) return content;

    // Sort descending: highest start position first so character offsets remain valid
    const sorted = [...spans].sort(
      (a, b) => b.start - a.start || b.end - a.end,
    );

    let result = content;
    for (const span of sorted) {
      result =
        result.substring(0, span.start) +
        span.newText +
        result.substring(span.end);
    }

    return result;
  }

  /**
   * Quick diff snippet generator for previews
   */
  public generateQuickDiff(
    filePath: string,
    original: string,
    modified: string,
  ): string {
    const origLines = original.split("\n");
    const modLines = modified.split("\n");

    const diffLines: string[] = [
      `--- a/${path.basename(filePath)}`,
      `+++ b/${path.basename(filePath)}`,
    ];
    let changesFound = 0;

    for (let i = 0; i < Math.max(origLines.length, modLines.length); i++) {
      const o = origLines[i];
      const m = modLines[i];

      if (o !== m) {
        changesFound++;
        if (o !== undefined) diffLines.push(`- ${o}`);
        if (m !== undefined) diffLines.push(`+ ${m}`);
      }
    }

    return changesFound > 0 ? diffLines.join("\n") : "No changes";
  }
}

// Global Singleton
export const crossFileRefactorEngine = new CrossFileRefactorEngine();
