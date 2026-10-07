/**
 * VynorAI High-Speed Pre-Flight Syntax Validator (Headless CLI)
 * ─────────────────────────────────────────────────────────────
 * Validates in-memory patched code before disk write:
 *  - TypeScript / JavaScript / TSX / JSX using TypeScript AST compiler
 *  - JSON using native JSON parser
 *  - Python / CSS / HTML / SQL structural delimiter and syntax checks
 */

import path from "node:path";
import ts from "typescript";

export interface SyntaxValidationResult {
  valid: boolean;
  language: string;
  error?: string;
  line?: number;
  column?: number;
}

/**
 * Validate TypeScript / JavaScript / TSX / JSX files
 */
function validateTypeScriptOrJavaScript(
  filePath: string,
  content: string,
): SyntaxValidationResult {
  const ext = path.extname(filePath).toLowerCase();
  const scriptKind =
    ext === ".tsx"
      ? ts.ScriptKind.TSX
      : ext === ".jsx"
        ? ts.ScriptKind.JSX
        : ext === ".js" || ext === ".mjs" || ext === ".cjs"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    scriptKind,
  );

  const diagnostics = (sourceFile as any).parseDiagnostics as
    | ts.Diagnostic[]
    | undefined;
  if (diagnostics && diagnostics.length > 0) {
    const first = diagnostics[0];
    const message =
      typeof first.messageText === "string"
        ? first.messageText
        : first.messageText?.messageText || "Syntax parsing error";

    let line = 1;
    let column = 1;
    if (first.start !== undefined) {
      const pos = sourceFile.getLineAndCharacterOfPosition(first.start);
      line = pos.line + 1;
      column = pos.character + 1;
    }

    return {
      valid: false,
      language: ext.replace(".", "") || "typescript",
      error: `Syntax error at line ${line}:${column}: ${message}`,
      line,
      column,
    };
  }

  return {
    valid: true,
    language: ext.replace(".", "") || "typescript",
  };
}

/**
 * Validate JSON files
 */
function validateJson(content: string): SyntaxValidationResult {
  try {
    JSON.parse(content);
    return { valid: true, language: "json" };
  } catch (err: any) {
    const lineMatch = err.message.match(/position (\d+)/i);
    let line = 1;
    if (lineMatch) {
      const pos = parseInt(lineMatch[1], 10);
      line = content.slice(0, pos).split("\n").length;
    }
    return {
      valid: false,
      language: "json",
      error: `Invalid JSON: ${err.message}`,
      line,
    };
  }
}

/**
 * Validate Python structural syntax
 */
function validatePython(content: string): SyntaxValidationResult {
  const lines = content.split("\n");
  const stack: { char: string; line: number }[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closers = new Set(Object.values(pairs));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;

    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      const prev = c > 0 ? line[c - 1] : "";

      if (char === "'" && prev !== "\\" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (char === '"' && prev !== "\\" && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (inSingleQuote || inDoubleQuote) continue;

      if (char in pairs) {
        stack.push({ char, line: i + 1 });
      } else if (closers.has(char)) {
        if (stack.length === 0) {
          return {
            valid: false,
            language: "python",
            error: `Unmatched closing bracket '${char}' at line ${i + 1}`,
            line: i + 1,
          };
        }
        const top = stack.pop()!;
        if (pairs[top.char] !== char) {
          return {
            valid: false,
            language: "python",
            error: `Mismatched brackets '${top.char}' and '${char}' at line ${i + 1}`,
            line: i + 1,
          };
        }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return {
      valid: false,
      language: "python",
      error: `Unclosed bracket '${unclosed.char}' opened at line ${unclosed.line}`,
      line: unclosed.line,
    };
  }

  return { valid: true, language: "python" };
}

/**
 * Universal Pre-Flight Code Syntax Validator
 */
export function validateCodeSyntax(
  filePath: string,
  content: string,
): SyntaxValidationResult {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return validateTypeScriptOrJavaScript(filePath, content);

    case ".json":
      return validateJson(content);

    case ".py":
      return validatePython(content);

    default:
      // For unparsed extensions, verify bracket balance
      return validatePython(content);
  }
}
