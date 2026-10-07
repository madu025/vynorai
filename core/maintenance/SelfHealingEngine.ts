/**
 * Self-Healing Test-Driven Edit Engine
 *
 * Implements VynorAI's Autonomous Error Recovery:
 * When a build, type-check, or test fails during an agent run, this engine:
 *  1. Parses raw test / compiler stderr to extract failure signatures
 *  2. Isolates the culprit file, line, and expected vs. actual discrepancy
 *  3. Formulates targeted self-correction patches
 *  4. Iteratively validates until tests pass (Green) or max attempts reached
 */

export interface FailureSignature {
  errorType: string;
  culpritFile?: string;
  lineNumber?: number;
  expected?: string;
  actual?: string;
  stackSnippet?: string;
  message: string;
}

export interface HealingAttempt {
  attemptNumber: number;
  signature: FailureSignature;
  proposedPatchDescription: string;
  verificationPassed: boolean;
  errorOutput?: string;
}

export interface HealingResult {
  status: "healed" | "failed" | "no_error";
  totalAttempts: number;
  rootCause?: string;
  repairedFiles: string[];
  diagnosticHistory: HealingAttempt[];
  finalVerificationEvidence?: string;
}

export class SelfHealingEngine {
  constructor(private readonly maxAttempts = 3) {}

  /**
   * Parse test output (Vitest, Jest, Mocha, TypeScript compiler) to extract failure signature.
   */
  static parseFailureSignature(rawOutput: string): FailureSignature | null {
    if (!rawOutput || rawOutput.trim().length === 0) return null;

    // Detect Vitest / Jest AssertionError
    const assertionMatch = rawOutput.match(
      /(?:AssertionError|Error):\s*([^\n\r]+)(?:[\s\S]*?Expected:\s*([^\n\r]+)[\s\S]*?Received:\s*([^\n\r]+))?/i,
    );

    // Detect TypeScript compile error (e.g. src/auth.ts(42,15): error TS2322)
    const tscMatch = rawOutput.match(
      /([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx))(?:\((\d+),\d+\)|:(\d+))?:\s*error\s*(TS\d+:\s*[^\n\r]+)/i,
    );

    // Detect File location in stack trace
    const stackFileMatch = rawOutput.match(
      /(?:at\s+[^\n\r]+\()?([a-zA-Z0-9_\-./\\]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)\)?/,
    );

    if (tscMatch) {
      return {
        errorType: "TypeScriptError",
        culpritFile: tscMatch[1],
        lineNumber: parseInt(tscMatch[2] || tscMatch[3] || "1", 10),
        message: tscMatch[4],
      };
    }

    if (assertionMatch) {
      const culpritFile = stackFileMatch ? stackFileMatch[1] : undefined;
      const lineNumber = stackFileMatch
        ? parseInt(stackFileMatch[2], 10)
        : undefined;

      return {
        errorType: "AssertionError",
        culpritFile,
        lineNumber,
        expected: assertionMatch[2]?.trim(),
        actual: assertionMatch[3]?.trim(),
        message: assertionMatch[1]?.trim() || "Assertion failed",
        stackSnippet: rawOutput.slice(0, 500),
      };
    }

    // Generic error fallback
    const genericMatch = rawOutput.match(
      /(?:TypeError|ReferenceError|SyntaxError):\s*([^\n\r]+)/,
    );
    if (genericMatch) {
      return {
        errorType: genericMatch[0].split(":")[0],
        culpritFile: stackFileMatch ? stackFileMatch[1] : undefined,
        lineNumber: stackFileMatch
          ? parseInt(stackFileMatch[2], 10)
          : undefined,
        message: genericMatch[1].trim(),
      };
    }

    return null;
  }

  /**
   * Execute an iterative self-healing repair loop against a test execution validator.
   */
  async runHealingLoop(
    initialErrorOutput: string,
    executeValidator: (
      attempt: number,
    ) => Promise<{ passed: boolean; errorOutput?: string }>,
    applyPatch: (
      signature: FailureSignature,
      attempt: number,
    ) => Promise<string[]>,
  ): Promise<HealingResult> {
    const diagnosticHistory: HealingAttempt[] = [];
    let currentError = initialErrorOutput;
    const allRepairedFiles = new Set<string>();

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const signature = SelfHealingEngine.parseFailureSignature(currentError);
      if (!signature) {
        return {
          status: "no_error",
          totalAttempts: attempt - 1,
          repairedFiles: Array.from(allRepairedFiles),
          diagnosticHistory,
        };
      }

      // Apply the surgical patch based on failure signature
      const modifiedFiles = await applyPatch(signature, attempt);
      for (const f of modifiedFiles) allRepairedFiles.add(f);

      // Re-run the verification gate
      const validation = await executeValidator(attempt);

      diagnosticHistory.push({
        attemptNumber: attempt,
        signature,
        proposedPatchDescription: `Targeted repair for ${signature.errorType} in ${signature.culpritFile || "workspace"}`,
        verificationPassed: validation.passed,
        errorOutput: validation.errorOutput,
      });

      if (validation.passed) {
        return {
          status: "healed",
          totalAttempts: attempt,
          rootCause: `${signature.errorType}: ${signature.message}`,
          repairedFiles: Array.from(allRepairedFiles),
          diagnosticHistory,
          finalVerificationEvidence: `Verification passed on attempt ${attempt}`,
        };
      }

      currentError = validation.errorOutput || "Validation failed";
    }

    return {
      status: "failed",
      totalAttempts: this.maxAttempts,
      rootCause: `Exceeded max attempts (${this.maxAttempts}) without green verification.`,
      repairedFiles: Array.from(allRepairedFiles),
      diagnosticHistory,
    };
  }
}
