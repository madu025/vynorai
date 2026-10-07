import { describe, expect, it, vi } from "vitest";
import { SelfHealingEngine } from "./SelfHealingEngine";

describe("VynorAI Self-Healing Test-Driven Edit Engine", () => {
  describe("Failure Signature Parsing", () => {
    it("correctly extracts Vitest/Jest AssertionError with expected vs actual values", () => {
      const rawError = `
AssertionError: expected false to be true // Object.is equality
Expected: true
Received: false
    at D:/My Project/VynorAI/src/auth/session.ts:42:18
    at file:///D:/My%20Project/VynorAI/node_modules/vitest/dist/runner.js:120:10
`;

      const signature = SelfHealingEngine.parseFailureSignature(rawError);
      expect(signature).not.toBeNull();
      expect(signature?.errorType).toBe("AssertionError");
      expect(signature?.expected).toBe("true");
      expect(signature?.actual).toBe("false");
      expect(signature?.culpritFile).toContain("session.ts");
      expect(signature?.lineNumber).toBe(42);
    });

    it("correctly extracts TypeScript compiler TS errors", () => {
      const rawTscError = `src/routes/payment.ts(88,21): error TS2322: Type 'string' is not assignable to type 'number'.`;

      const signature = SelfHealingEngine.parseFailureSignature(rawTscError);
      expect(signature).not.toBeNull();
      expect(signature?.errorType).toBe("TypeScriptError");
      expect(signature?.culpritFile).toBe("src/routes/payment.ts");
      expect(signature?.lineNumber).toBe(88);
      expect(signature?.message).toContain("TS2322");
    });
  });

  describe("Iterative Self-Healing Loop", () => {
    it("heals code defect on attempt 2 after initial validation failure", async () => {
      const engine = new SelfHealingEngine(3);

      const initialError = `
AssertionError: expected 401 to be 200
Expected: 200
Received: 401
    at src/auth/guard.ts:25:9
`;

      let attemptCount = 0;
      const mockValidator = vi
        .fn()
        .mockImplementation(async (attempt: number) => {
          attemptCount = attempt;
          if (attempt === 1) {
            return {
              passed: false,
              errorOutput:
                "AssertionError: expected 403 to be 200\nExpected: 200\nReceived: 403\nat src/auth/guard.ts:30:5",
            };
          }
          return { passed: true };
        });

      const mockApplyPatch = vi
        .fn()
        .mockImplementation(async (sig, attempt) => {
          return ["src/auth/guard.ts"];
        });

      const result = await engine.runHealingLoop(
        initialError,
        mockValidator,
        mockApplyPatch,
      );

      expect(result.status).toBe("healed");
      expect(result.totalAttempts).toBe(2);
      expect(result.repairedFiles).toContain("src/auth/guard.ts");
      expect(result.diagnosticHistory.length).toBe(2);
      expect(result.diagnosticHistory[0].verificationPassed).toBe(false);
      expect(result.diagnosticHistory[1].verificationPassed).toBe(true);
      expect(result.finalVerificationEvidence).toContain("attempt 2");
    });

    it("terminates safely with failed status when max attempts are exceeded", async () => {
      const engine = new SelfHealingEngine(2);

      const persistentError =
        "TypeError: Cannot read properties of undefined\nat src/core.ts:10:5";

      const mockValidator = vi.fn().mockResolvedValue({
        passed: false,
        errorOutput: persistentError,
      });

      const mockApplyPatch = vi.fn().mockResolvedValue(["src/core.ts"]);

      const result = await engine.runHealingLoop(
        persistentError,
        mockValidator,
        mockApplyPatch,
      );

      expect(result.status).toBe("failed");
      expect(result.totalAttempts).toBe(2);
      expect(result.rootCause).toContain("Exceeded max attempts");
    });
  });
});
