import { describe, it, expect } from "vitest";
import { validateCodeSyntax } from "../syntaxValidator.js";
import {
  CodebaseIndexer,
  extractSymbolsFromTsJs,
  buildCallGraph,
  CodeSymbol,
} from "../codebaseIndexer.js";
import {
  parseTerminalDiagnostics,
  generateHeuristicFix,
} from "../terminalSelfHealer.js";
import { HeadlessGoalRunner } from "../goalRunner.js";

describe("Headless Syntax Validator", () => {
  it("should validate correct TypeScript code", () => {
    const code = `
      export function sum(a: number, b: number): number {
        return a + b;
      }
    `;
    const res = validateCodeSyntax("math.ts", code);
    expect(res.valid).toBe(true);
  });

  it("should catch syntax errors in broken TypeScript code", () => {
    const code = `
      export function sum(a: number, b: number): number {
        return a + ;
      }
    `;
    const res = validateCodeSyntax("math.ts", code);
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("should validate valid and invalid JSON", () => {
    expect(validateCodeSyntax("data.json", '{"key": "value"}').valid).toBe(
      true,
    );
    expect(validateCodeSyntax("data.json", '{"key": broken}').valid).toBe(
      false,
    );
  });

  it("should validate Python bracket matching", () => {
    expect(
      validateCodeSyntax("test.py", "def fn():\n    return (1 + 2)\n").valid,
    ).toBe(true);
    expect(
      validateCodeSyntax("test.py", "def fn():\n    return (1 + 2\n").valid,
    ).toBe(false);
  });
});

describe("Headless Codebase Indexer & Call Graph", () => {
  it("should extract AST symbols and call invocations from TypeScript", () => {
    const code = `
      export function helper(): string {
        return "ok";
      }

      export class Controller {
        public handle(): string {
          return helper();
        }
      }
    `;
    const { symbols, calls } = extractSymbolsFromTsJs("sample.ts", code);

    expect(symbols.length).toBeGreaterThanOrEqual(2);
    const helperSym = symbols.find((s) => s.name === "helper");
    const controllerSym = symbols.find((s) => s.name === "Controller");
    const handleMethod = symbols.find((s) => s.name === "handle");

    expect(helperSym).toBeDefined();
    expect(controllerSym).toBeDefined();
    expect(handleMethod).toBeDefined();

    expect(calls.some((c) => c.calleeName === "helper")).toBe(true);
  });

  it("should construct Call Graph with in-degree centrality", () => {
    const symbols: CodeSymbol[] = [
      {
        id: "a.ts:foo:1",
        name: "foo",
        kind: "function" as const,
        filePath: "a.ts",
        startLine: 1,
        endLine: 3,
        signature: "function foo()",
        calls: [],
      },
      {
        id: "a.ts:bar:5",
        name: "bar",
        kind: "function" as const,
        filePath: "a.ts",
        startLine: 5,
        endLine: 8,
        signature: "function bar()",
        calls: ["foo"],
      },
    ];

    const calls = [{ callerName: "bar", calleeName: "foo", filePath: "a.ts" }];
    const graph = buildCallGraph(symbols, calls);

    expect(graph.edges.length).toBe(1);
    expect(graph.inDegrees.get("a.ts:foo:1")).toBe(1);
    expect(symbols[0].centralityScore).toBeGreaterThan(
      symbols[1].centralityScore!,
    );
  });

  it("should index directory and perform hybrid queries", async () => {
    const indexer = new CodebaseIndexer(process.cwd());
    const stats = await indexer.indexWorkspace({
      filePaths: [
        "src/headless/syntaxValidator.ts",
        "src/headless/codebaseIndexer.ts",
      ],
    });

    expect(stats.filesIndexed).toBe(2);
    expect(stats.symbolsIndexed).toBeGreaterThan(0);

    const results = indexer.query({ query: "validateCodeSyntax", topK: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].symbol.name).toBe("validateCodeSyntax");
  });
});

describe("Headless Terminal Diagnostic Parser & Fixes", () => {
  it("should parse TypeScript compiler errors", () => {
    const stderr = `src/routes/api.ts(45,12): error TS2304: Cannot find name 'crypto'.`;
    const diags = parseTerminalDiagnostics(stderr);

    expect(diags.length).toBe(1);
    expect(diags[0].filePath).toBe("src/routes/api.ts");
    expect(diags[0].line).toBe(45);
    expect(diags[0].errorCode).toBe("TS2304");
  });

  it("should generate heuristic fix for missing standard Node module", () => {
    const diag = {
      filePath: "src/test.ts",
      line: 1,
      errorCode: "TS2304",
      errorMessage: "Cannot find name 'crypto'.",
      category: "compiler" as const,
    };

    const original = `export function hash() { return crypto.createHash("sha256"); }`;
    const fix = generateHeuristicFix(diag, original);

    expect(fix).toBeDefined();
    expect(fix).toContain('import crypto from "node:crypto";');
  });

  it("should parse assertion failure and propose drift fix", () => {
    const stderr = `AssertionError: expected 'active' to equal 'pending'`;
    const diags = parseTerminalDiagnostics(stderr);

    expect(diags.length).toBe(1);
    expect(diags[0].category).toBe("assertion");

    const diagWithLine = { ...diags[0], line: 2 };
    const content = `const expected = 'pending';\nassert.equal(actual, 'pending');`;
    const fix = generateHeuristicFix(diagWithLine, content);

    expect(fix).toBeDefined();
    expect(fix).toContain("active");
  });
});

describe("Headless Goal Runner", () => {
  it("should decompose goal, resolve AST context, and compile briefing report", async () => {
    const runner = new HeadlessGoalRunner({
      prompt: "Inspect codebase symbol indexer and syntax validator",
      dryRun: true,
      format: "json",
    });

    const report = await runner.run();
    expect(report.success).toBe(true);
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.relevantSymbols.length).toBeGreaterThan(0);
    expect(report.summary).toBeDefined();
  });
});
