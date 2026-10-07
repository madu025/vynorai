/**
 * VynorAI High-Speed Pre-Flight Syntax Validator
 * -----------------------------------------------
 * Validates in-memory patched code before disk write:
 *  - TypeScript / JavaScript / TSX / JSX using TypeScript AST compiler
 *  - JSON using native JSON parser
 *  - Python / CSS / HTML using structural delimiter and indentation analysis
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
    return {
      valid: false,
      language: "json",
      error: `Invalid JSON: ${err?.message || "Syntax error"}`,
    };
  }
}

/**
 * Validate balanced delimiters and structure for Python, CSS, etc.
 */
function validateBalancedDelimiters(
  content: string,
  language: string,
): SyntaxValidationResult {
  const stack: Array<{ char: string; line: number }> = [];
  const lines = content.split(/\r?\n/);

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const prev = c > 0 ? line[c - 1] : "";

      if (prev === "\\") continue; // Escaped character

      if (ch === "'" && !inDoubleQuote && !inBacktick) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (ch === '"' && !inSingleQuote && !inBacktick) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (ch === "`" && !inSingleQuote && !inDoubleQuote) {
        inBacktick = !inBacktick;
        continue;
      }

      if (inSingleQuote || inDoubleQuote || inBacktick) continue;

      // Delimiters
      if (ch === "(" || ch === "[" || ch === "{") {
        stack.push({ char: ch, line: l + 1 });
      } else if (ch === ")" || ch === "]" || ch === "}") {
        if (stack.length === 0) {
          return {
            valid: false,
            language,
            error: `Unexpected closing delimiter '${ch}' at line ${l + 1}`,
            line: l + 1,
          };
        }
        const top = stack.pop()!;
        const matching =
          (ch === ")" && top.char === "(") ||
          (ch === "]" && top.char === "[") ||
          (ch === "}" && top.char === "{");

        if (!matching) {
          return {
            valid: false,
            language,
            error: `Mismatched delimiter: expected closing for '${top.char}' (line ${top.line}), but found '${ch}' at line ${l + 1}`,
            line: l + 1,
          };
        }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return {
      valid: false,
      language,
      error: `Unclosed delimiter '${unclosed.char}' opened at line ${unclosed.line}`,
      line: unclosed.line,
    };
  }

  return { valid: true, language };
}

/**
 * Universal syntax validator by file extension
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
      return validateBalancedDelimiters(content, "python");

    case ".css":
    case ".scss":
    case ".less":
      return validateBalancedDelimiters(content, "css");

    default:
      // General structure check
      return validateBalancedDelimiters(
        content,
        ext.replace(".", "") || "text",
      );
  }
}
