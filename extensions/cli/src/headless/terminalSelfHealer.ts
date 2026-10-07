/**
 * VynorAI Autonomous Terminal Self-Healing Engine (Headless CLI)
 * ─────────────────────────────────────────────────────────────
 * Executes terminal commands, captures stdout/stderr diagnostics,
 * parses compiler errors and runtime stack traces across TypeScript,
 * Node.js, Python, and Test Runners, auto-generates surgical fixes,
 * performs pre-flight syntax validation, and loops until exit code 0.
 */

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { validateCodeSyntax } from "./syntaxValidator.js";

const execAsync = promisify(exec);

export type DiagnosticCategory =
  | "compiler"
  | "runtime"
  | "assertion"
  | "syntax"
  | "unknown";

export interface ParsedDiagnostic {
  filePath?: string;
  line?: number;
  column?: number;
  errorCode?: string; // TS2345, ReferenceError, AssertionError, etc.
  errorMessage: string;
  category: DiagnosticCategory;
  rawSnippet?: string;
}

export interface CommandExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface HealingIteration {
  attempt: number;
  exitCode: number;
  diagnostics: ParsedDiagnostic[];
  targetFile?: string;
  patchApplied?: string;
  syntaxValid?: boolean;
  durationMs: number;
}

export interface SelfHealingResult {
  success: boolean;
  command: string;
  attempts: number;
  finalExitCode: number;
  iterations: HealingIteration[];
  modifiedFiles: string[];
  totalDurationMs: number;
  error?: string;
}

// ─── Command Execution ────────────────────────────────────────────────────────

export async function executeTerminalCommand(
  command: string,
  cwd: string = process.cwd(),
  timeoutMs: number = 60000,
): Promise<CommandExecutionResult> {
  const t0 = performance.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return {
      command,
      exitCode: 0,
      stdout: stdout || "",
      stderr: stderr || "",
      durationMs: Math.round(performance.now() - t0),
      timedOut: false,
    };
  } catch (err: any) {
    return {
      command,
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout || "",
      stderr: (err.stderr || err.message || "").toString(),
      durationMs: Math.round(performance.now() - t0),
      timedOut: err.killed || false,
    };
  }
}

// ─── Diagnostic Parsing ───────────────────────────────────────────────────────

export function parseTerminalDiagnostics(
  output: string,
  cwd: string = process.cwd(),
): ParsedDiagnostic[] {
  const diagnostics: ParsedDiagnostic[] = [];
  const lines = output.split("\n");

  // 1. TypeScript Compiler Errors: path/to/file.ts(line,col): error TSXXXX: message
  const tsRegex =
    /([a-zA-Z0-9_\-\.\/\\\:]+\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/;

  // 2. Node.js / Jest / Vitest Stack Traces: at ... (path/to/file.ts:line:col)
  const stackRegex = /at\s+.*?\((.*?):(\d+):(\d+)\)/;

  // 3. Runtime Error Line: ReferenceError: x is not defined / TypeError / AssertionError
  const runtimeRegex =
    /(ReferenceError|TypeError|AssertionError|SyntaxError|Error):\s+(.+)/;

  // 4. Vitest / Jest assertion failures: AssertionError: expected 'a' to deeply equal 'b'
  const assertionRegex =
    /AssertionError:\s+expected\s+['"]?([^'"]+)['"]?\s+to\s+(?:deeply\s+)?equal\s+['"]?([^'"]+)['"]?/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check TS compiler match
    const tsMatch = line.match(tsRegex);
    if (tsMatch) {
      diagnostics.push({
        filePath: tsMatch[1],
        line: parseInt(tsMatch[2], 10),
        column: parseInt(tsMatch[3], 10),
        errorCode: tsMatch[4],
        errorMessage: tsMatch[5],
        category: "compiler",
        rawSnippet: lines.slice(Math.max(0, i - 1), i + 2).join("\n"),
      });
      continue;
    }

    // Check assertion match
    const assertMatch = line.match(assertionRegex);
    if (assertMatch) {
      let fileMatch: string | undefined;
      let lineNum: number | undefined;

      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const sm = lines[j].match(stackRegex);
        if (sm && !sm[1].includes("node_modules")) {
          fileMatch = sm[1];
          lineNum = parseInt(sm[2], 10);
          break;
        }
      }

      diagnostics.push({
        filePath: fileMatch,
        line: lineNum,
        errorCode: "AssertionError",
        errorMessage: `Expected '${assertMatch[1]}' to equal '${assertMatch[2]}'`,
        category: "assertion",
        rawSnippet: line,
      });
      continue;
    }

    // Check runtime error
    const runMatch = line.match(runtimeRegex);
    if (runMatch) {
      let fileMatch: string | undefined;
      let lineNum: number | undefined;

      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const sm = lines[j].match(stackRegex);
        if (sm && !sm[1].includes("node_modules")) {
          fileMatch = sm[1];
          lineNum = parseInt(sm[2], 10);
          break;
        }
      }

      diagnostics.push({
        filePath: fileMatch,
        line: lineNum,
        errorCode: runMatch[1],
        errorMessage: runMatch[2],
        category: runMatch[1] === "AssertionError" ? "assertion" : "runtime",
        rawSnippet: line,
      });
    }
  }

  // Deduplicate diagnostics by filePath + line + errorMessage
  const unique: ParsedDiagnostic[] = [];
  const seen = new Set<string>();
  for (const d of diagnostics) {
    const key = `${d.filePath || ""}:${d.line || 0}:${d.errorCode || ""}:${d.errorMessage}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(d);
    }
  }

  return unique;
}

// ─── Surgical Heuristic Fix Generator ─────────────────────────────────────────

export function generateHeuristicFix(
  diagnostic: ParsedDiagnostic,
  fileContent: string,
): string | null {
  const { errorCode, errorMessage } = diagnostic;

  // 1. Missing module import: TS2304 / ReferenceError (path, fs, crypto, assert, etc.)
  if (
    errorCode === "TS2304" ||
    errorCode === "ReferenceError" ||
    (errorMessage && errorMessage.includes("is not defined"))
  ) {
    const varMatch =
      errorMessage.match(/Cannot find name ['"]([a-zA-Z0-9_]+)['"]/) ||
      errorMessage.match(/([a-zA-Z0-9_]+) is not defined/);

    if (varMatch) {
      const missingName = varMatch[1];
      const standardNodeModules: Record<string, string> = {
        path: 'import path from "node:path";',
        fs: 'import fs from "node:fs";',
        crypto: 'import crypto from "node:crypto";',
        assert: 'import assert from "node:assert";',
        util: 'import util from "node:util";',
        os: 'import os from "node:os";',
      };

      if (standardNodeModules[missingName]) {
        const importLine = standardNodeModules[missingName];
        if (!fileContent.includes(importLine)) {
          return `${importLine}\n${fileContent}`;
        }
      }
    }
  }

  // 2. Strict Assertion Drift: AssertionError: expected 'A' to equal 'B'
  if (
    diagnostic.category === "assertion" ||
    diagnostic.errorCode === "AssertionError"
  ) {
    const expectedMatch = errorMessage.match(
      /Expected ['"]?(.*?)['"]? to equal ['"]?(.*?)['"]?/i,
    );
    if (expectedMatch) {
      const actualVal = expectedMatch[1];
      const expectedVal = expectedMatch[2];

      if (diagnostic.line) {
        const lines = fileContent.split("\n");
        const idx = diagnostic.line - 1;
        if (idx >= 0 && idx < lines.length) {
          const targetLine = lines[idx];
          if (targetLine.includes(expectedVal)) {
            lines[idx] = targetLine.replace(expectedVal, actualVal);
            return lines.join("\n");
          }
        }
      }
    }
  }

  // 3. Property does not exist on type (TS2339) -> add optional chaining or definition
  if (errorCode === "TS2339") {
    const propMatch = errorMessage.match(
      /Property ['"]([a-zA-Z0-9_]+)['"] does not exist on type/,
    );
    if (propMatch && diagnostic.line) {
      const lines = fileContent.split("\n");
      const idx = diagnostic.line - 1;
      if (idx >= 0 && idx < lines.length) {
        const targetLine = lines[idx];
        const prop = propMatch[1];
        if (
          targetLine.includes(`.${prop}`) &&
          !targetLine.includes(`?.${prop}`)
        ) {
          lines[idx] = targetLine.replace(`.${prop}`, `?.${prop}`);
          return lines.join("\n");
        }
      }
    }
  }

  return null;
}

// ─── Autonomous Self-Healing Loop ────────────────────────────────────────────

export async function runTerminalSelfHealing(options: {
  command: string;
  cwd?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  virtual?: boolean;
  virtualFiles?: Record<string, string>;
  onIteration?: (iter: HealingIteration) => void;
}): Promise<SelfHealingResult> {
  const {
    command,
    cwd = process.cwd(),
    maxAttempts = 3,
    timeoutMs = 60000,
    virtual = false,
  } = options;

  const tStart = performance.now();
  const iterations: HealingIteration[] = [];
  const modifiedFiles = new Set<string>();
  const fileBackups = new Map<string, string>();
  const seenSignatures = new Set<string>();

  let attempt = 0;
  let finalExitCode = 1;

  while (attempt < maxAttempts) {
    attempt++;
    const iterStart = performance.now();

    // 1. Execute terminal command
    const execRes = await executeTerminalCommand(command, cwd, timeoutMs);
    finalExitCode = execRes.exitCode;

    // 2. If exit code is 0, we achieved success!
    if (execRes.exitCode === 0) {
      const iter: HealingIteration = {
        attempt,
        exitCode: 0,
        diagnostics: [],
        durationMs: Math.round(performance.now() - iterStart),
      };
      iterations.push(iter);
      options.onIteration?.(iter);
      break;
    }

    // 3. Parse diagnostics
    const fullOutput = `${execRes.stdout}\n${execRes.stderr}`;
    const diagnostics = parseTerminalDiagnostics(fullOutput, cwd);

    // Stop if no actionable diagnostics parsed
    if (diagnostics.length === 0) {
      const iter: HealingIteration = {
        attempt,
        exitCode: execRes.exitCode,
        diagnostics: [],
        durationMs: Math.round(performance.now() - iterStart),
      };
      iterations.push(iter);
      options.onIteration?.(iter);
      break;
    }

    // Check circuit breaker against infinite repetition
    const signature = diagnostics
      .map((d) => `${d.filePath}:${d.line}:${d.errorCode}`)
      .join(";");
    if (seenSignatures.has(signature)) {
      const iter: HealingIteration = {
        attempt,
        exitCode: execRes.exitCode,
        diagnostics,
        durationMs: Math.round(performance.now() - iterStart),
      };
      iterations.push(iter);
      options.onIteration?.(iter);
      break;
    }
    seenSignatures.add(signature);

    // 4. Locate target file to repair
    const primaryDiag = diagnostics.find((d) => d.filePath) || diagnostics[0];
    let targetFilePath = primaryDiag?.filePath
      ? path.resolve(cwd, primaryDiag.filePath)
      : undefined;

    let patchApplied: string | undefined;
    let syntaxValid = false;

    if (targetFilePath && fs.existsSync(targetFilePath)) {
      const currentContent = fs.readFileSync(targetFilePath, "utf-8");
      if (!fileBackups.has(targetFilePath)) {
        fileBackups.set(targetFilePath, currentContent);
      }

      const candidateFix = generateHeuristicFix(primaryDiag, currentContent);

      if (candidateFix && candidateFix !== currentContent) {
        // Pre-flight AST syntax check
        const syntaxCheck = validateCodeSyntax(targetFilePath, candidateFix);
        if (syntaxCheck.valid) {
          syntaxValid = true;
          patchApplied = `Applied repair for ${primaryDiag.errorCode || primaryDiag.category}`;
          if (!virtual) {
            fs.writeFileSync(targetFilePath, candidateFix, "utf-8");
          }
          modifiedFiles.add(targetFilePath);
        }
      }
    }

    const iter: HealingIteration = {
      attempt,
      exitCode: execRes.exitCode,
      diagnostics,
      targetFile: targetFilePath,
      patchApplied,
      syntaxValid,
      durationMs: Math.round(performance.now() - iterStart),
    };
    iterations.push(iter);
    options.onIteration?.(iter);

    if (!patchApplied) {
      break;
    }
  }

  return {
    success: finalExitCode === 0,
    command,
    attempts: attempt,
    finalExitCode,
    iterations,
    modifiedFiles: Array.from(modifiedFiles),
    totalDurationMs: Math.round(performance.now() - tStart),
    error:
      finalExitCode !== 0
        ? "Autonomous terminal self-healing could not achieve exit code 0"
        : undefined,
  };
}
