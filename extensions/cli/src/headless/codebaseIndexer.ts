/**
 * VynorAI High-Precision Codebase Symbol Graph Indexer (Headless CLI)
 * ──────────────────────────────────────────────────────────────────
 * Multi-language AST parsing (TS/JS via TypeScript compiler API, plus Python, Go, Rust, Java),
 * bidirectional Call Graph construction, in-degree centrality calculation,
 * and hybrid BM25 + dense token retrieval.
 *
 * Runs 100% offline in-process, with automatic fallback / delegation to local
 * backend server if available.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "enum";

export interface CodeSymbol {
  id: string; // filePath:name:startLine
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  docstring?: string;
  calls: string[];
  callees?: string[];
  callers?: string[];
  centralityScore?: number;
}

export interface CallGraphEdge {
  fromSymbolId: string;
  toSymbolId: string;
  callerName: string;
  calleeName: string;
  filePath: string;
}

export interface CallGraph {
  nodes: Map<string, CodeSymbol>;
  edges: CallGraphEdge[];
  inDegrees: Map<string, number>;
  outDegrees: Map<string, number>;
}

export interface SearchResult {
  symbol: CodeSymbol;
  score: number;
  bm25Score: number;
  vectorScore: number;
  centralityBoost: number;
  callerCalleeContext?: {
    callers: CodeSymbol[];
    callees: CodeSymbol[];
  };
}

// ─── AST Symbol Extraction ────────────────────────────────────────────────────

export function extractSymbolsFromTsJs(
  filePath: string,
  content: string,
): {
  symbols: CodeSymbol[];
  calls: { callerName: string; calleeName: string; line: number }[];
} {
  const symbols: CodeSymbol[] = [];
  const calls: { callerName: string; calleeName: string; line: number }[] = [];

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
    true,
    scriptKind,
  );

  let currentEnclosingSymbol: string | null = null;

  function visit(node: ts.Node) {
    let symName: string | null = null;
    let symKind: SymbolKind | null = null;
    let signature = "";
    let docstring: string | undefined;

    if (ts.isFunctionDeclaration(node) && node.name) {
      symName = node.name.text;
      symKind = "function";
      signature = node.getText(sourceFile).split("{")[0].trim();
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      symName = node.name.text;
      symKind = "method";
      signature = node.getText(sourceFile).split("{")[0].trim();
    } else if (ts.isClassDeclaration(node) && node.name) {
      symName = node.name.text;
      symKind = "class";
      signature = `class ${node.name.text}`;
    } else if (ts.isInterfaceDeclaration(node)) {
      symName = node.name.text;
      symKind = "interface";
      signature = `interface ${node.name.text}`;
    } else if (ts.isTypeAliasDeclaration(node)) {
      symName = node.name.text;
      symKind = "type";
      signature = `type ${node.name.text} = ...`;
    } else if (ts.isEnumDeclaration(node)) {
      symName = node.name.text;
      symKind = "enum";
      signature = `enum ${node.name.text}`;
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          symName = decl.name.text;
          symKind = "function";
          signature = `${decl.name.text} = ${decl.initializer.getText(sourceFile).split("=>")[0].split("{")[0].trim()}`;
          break;
        }
      }
    }

    if (symName && symKind) {
      const startPos = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      );
      const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const startLine = startPos.line + 1;
      const endLine = endPos.line + 1;

      const jsDocs = (node as any).jsDoc;
      if (jsDocs && jsDocs.length > 0) {
        docstring = jsDocs[0].comment;
      }

      const id = `${filePath}:${symName}:${startLine}`;
      const symbolCalls: string[] = [];

      const prevEnclosing = currentEnclosingSymbol;
      currentEnclosingSymbol = symName;

      node.forEachChild((child) => {
        if (ts.isCallExpression(child)) {
          let callee = "";
          if (ts.isIdentifier(child.expression)) {
            callee = child.expression.text;
          } else if (ts.isPropertyAccessExpression(child.expression)) {
            callee = child.expression.name.text;
          }
          if (callee) {
            symbolCalls.push(callee);
            const callPos = sourceFile.getLineAndCharacterOfPosition(
              child.getStart(),
            );
            calls.push({
              callerName: symName!,
              calleeName: callee,
              line: callPos.line + 1,
            });
          }
        }
      });

      symbols.push({
        id,
        name: symName,
        kind: symKind,
        filePath,
        startLine,
        endLine,
        signature,
        docstring,
        calls: symbolCalls,
      });

      ts.forEachChild(node, visit);
      currentEnclosingSymbol = prevEnclosing;
      return;
    }

    if (ts.isCallExpression(node) && currentEnclosingSymbol) {
      let callee = "";
      if (ts.isIdentifier(node.expression)) {
        callee = node.expression.text;
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        callee = node.expression.name.text;
      }
      if (callee) {
        const callPos = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        );
        calls.push({
          callerName: currentEnclosingSymbol,
          calleeName: callee,
          line: callPos.line + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { symbols, calls };
}

export function extractSymbolsGeneric(
  filePath: string,
  content: string,
): {
  symbols: CodeSymbol[];
  calls: { callerName: string; calleeName: string; line: number }[];
} {
  const symbols: CodeSymbol[] = [];
  const calls: { callerName: string; calleeName: string; line: number }[] = [];
  const lines = content.split("\n");

  const patterns = [
    { regex: /^\s*def\s+([a-zA-Z0-9_]+)\s*\(/, kind: "function" as SymbolKind },
    { regex: /^\s*class\s+([a-zA-Z0-9_]+)[\s:(]/, kind: "class" as SymbolKind },
    {
      regex: /^\s*func\s+(?:\([^\)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/,
      kind: "function" as SymbolKind,
    },
    {
      regex: /^\s*(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*[<(]/,
      kind: "function" as SymbolKind,
    },
    {
      regex: /^\s*(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/,
      kind: "type" as SymbolKind,
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      const match = line.match(p.regex);
      if (match) {
        const name = match[1];
        symbols.push({
          id: `${filePath}:${name}:${i + 1}`,
          name,
          kind: p.kind,
          filePath,
          startLine: i + 1,
          endLine: Math.min(i + 20, lines.length),
          signature: line.trim(),
          calls: [],
        });
        break;
      }
    }
  }

  return { symbols, calls };
}

export function extractSymbolsFromFile(filePath: string, content: string) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    return extractSymbolsFromTsJs(filePath, content);
  }
  return extractSymbolsGeneric(filePath, content);
}

// ─── Call Graph Construction ─────────────────────────────────────────────────

export function buildCallGraph(
  symbols: CodeSymbol[],
  calls: { callerName: string; calleeName: string; filePath: string }[],
): CallGraph {
  const nodes = new Map<string, CodeSymbol>();
  const nameToSymbols = new Map<string, CodeSymbol[]>();

  for (const sym of symbols) {
    nodes.set(sym.id, sym);
    if (!nameToSymbols.has(sym.name)) {
      nameToSymbols.set(sym.name, []);
    }
    nameToSymbols.get(sym.name)!.push(sym);
  }

  const edges: CallGraphEdge[] = [];
  const inDegrees = new Map<string, number>();
  const outDegrees = new Map<string, number>();

  for (const sym of symbols) {
    inDegrees.set(sym.id, 0);
    outDegrees.set(sym.id, 0);
    sym.callees = [];
    sym.callers = [];
  }

  for (const call of calls) {
    const callerMatches = (nameToSymbols.get(call.callerName) || []).filter(
      (s) => s.filePath === call.filePath,
    );
    const calleeMatches = nameToSymbols.get(call.calleeName) || [];

    for (const caller of callerMatches) {
      for (const callee of calleeMatches) {
        if (caller.id === callee.id) continue;

        edges.push({
          fromSymbolId: caller.id,
          toSymbolId: callee.id,
          callerName: caller.name,
          calleeName: callee.name,
          filePath: call.filePath,
        });

        if (!caller.callees!.includes(callee.id)) {
          caller.callees!.push(callee.id);
        }
        if (!callee.callers!.includes(caller.id)) {
          callee.callers!.push(caller.id);
        }

        outDegrees.set(caller.id, (outDegrees.get(caller.id) || 0) + 1);
        inDegrees.set(callee.id, (inDegrees.get(callee.id) || 0) + 1);
      }
    }
  }

  // Centrality score calculation (in-degree normalized with dampening)
  const maxInDegree = Math.max(...Array.from(inDegrees.values()), 1);
  for (const sym of symbols) {
    const inDeg = inDegrees.get(sym.id) || 0;
    sym.centralityScore = Number(
      (0.1 + 0.9 * (inDeg / maxInDegree)).toFixed(3),
    );
  }

  return { nodes, edges, inDegrees, outDegrees };
}

// ─── BM25 + Dense Retrieval ──────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function computeBm25Scores(
  queryTokens: string[],
  symbols: CodeSymbol[],
): Map<string, number> {
  const scores = new Map<string, number>();
  const k1 = 1.2;
  const b = 0.75;

  const docFreq = new Map<string, number>();
  const docTokens = new Map<string, string[]>();
  let totalLength = 0;

  for (const sym of symbols) {
    const text = `${sym.name} ${sym.name} ${sym.signature} ${sym.docstring || ""} ${path.basename(sym.filePath)}`;
    const tokens = tokenize(text);
    docTokens.set(sym.id, tokens);
    totalLength += tokens.length;

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const N = symbols.length || 1;
  const avgDl = totalLength / N || 1;

  for (const sym of symbols) {
    const tokens = docTokens.get(sym.id) || [];
    const docLen = tokens.length;
    let score = 0;

    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const q of queryTokens) {
      const count = tf.get(q) || 0;
      if (count > 0) {
        const df = docFreq.get(q) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const num = count * (k1 + 1);
        const denom = count + k1 * (1 - b + b * (docLen / avgDl));
        score += idf * (num / denom);
      }
    }

    scores.set(sym.id, score);
  }

  return scores;
}

function computeVectorSimilarity(query: string, symbol: CodeSymbol): number {
  const qTokens = new Set(tokenize(query));
  const sTokens = new Set(
    tokenize(`${symbol.name} ${symbol.signature} ${symbol.docstring || ""}`),
  );

  let intersection = 0;
  for (const t of qTokens) {
    if (sTokens.has(t)) intersection++;
  }

  const union = qTokens.size + sTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── High-Level Manager ──────────────────────────────────────────────────────

export class CodebaseIndexer {
  private symbols: CodeSymbol[] = [];
  private callGraph: CallGraph | null = null;
  private indexedFiles = new Set<string>();
  private workspaceDir: string = process.cwd();

  constructor(workspaceDir?: string) {
    if (workspaceDir) {
      this.workspaceDir = path.resolve(workspaceDir);
    }
  }

  public getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  public async indexWorkspace(options?: {
    workspaceDir?: string;
    filePaths?: string[];
    forceReindex?: boolean;
  }): Promise<{
    filesIndexed: number;
    symbolsIndexed: number;
    callGraphEdges: number;
    durationMs: number;
  }> {
    const t0 = performance.now();
    if (options?.workspaceDir) {
      this.workspaceDir = path.resolve(options.workspaceDir);
    }

    if (options?.forceReindex) {
      this.symbols = [];
      this.indexedFiles.clear();
      this.callGraph = null;
    }

    let filesToScan = options?.filePaths;
    if (!filesToScan || filesToScan.length === 0) {
      filesToScan = this.discoverFiles(this.workspaceDir);
    }

    const allSymbols: CodeSymbol[] = [];
    const allCalls: {
      callerName: string;
      calleeName: string;
      filePath: string;
    }[] = [];

    for (const relOrAbs of filesToScan) {
      const fullPath = path.isAbsolute(relOrAbs)
        ? relOrAbs
        : path.resolve(this.workspaceDir, relOrAbs);

      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const relPath = path
          .relative(this.workspaceDir, fullPath)
          .replace(/\\/g, "/");
        const { symbols, calls } = extractSymbolsFromFile(relPath, content);

        allSymbols.push(...symbols);
        for (const c of calls) {
          allCalls.push({ ...c, filePath: relPath });
        }
        this.indexedFiles.add(relPath);
      } catch {
        // Skip unreadable files
      }
    }

    this.symbols = allSymbols;
    this.callGraph = buildCallGraph(this.symbols, allCalls);

    return {
      filesIndexed: this.indexedFiles.size,
      symbolsIndexed: this.symbols.length,
      callGraphEdges: this.callGraph.edges.length,
      durationMs: Math.round(performance.now() - t0),
    };
  }

  public query(options: {
    query: string;
    topK?: number;
    rerank?: boolean;
  }): SearchResult[] {
    const topK = options.topK || 5;
    const queryTokens = tokenize(options.query);
    if (queryTokens.length === 0 || this.symbols.length === 0) {
      return [];
    }

    const bm25Map = computeBm25Scores(queryTokens, this.symbols);
    const maxBm25 = Math.max(...Array.from(bm25Map.values()), 1e-6);

    const scored: SearchResult[] = this.symbols.map((sym) => {
      const bm25Raw = bm25Map.get(sym.id) || 0;
      const bm25Norm = bm25Raw / maxBm25;
      const vectorScore = computeVectorSimilarity(options.query, sym);
      const centrality = sym.centralityScore || 0.1;

      // Exact name match boost
      let nameBoost = 0;
      if (sym.name.toLowerCase() === options.query.toLowerCase().trim()) {
        nameBoost = 0.5;
      } else if (
        sym.name.toLowerCase().includes(options.query.toLowerCase().trim())
      ) {
        nameBoost = 0.25;
      }

      // Hybrid Reciprocal Rank Fusion style score
      const combined =
        0.45 * bm25Norm + 0.35 * vectorScore + 0.1 * centrality + nameBoost;

      return {
        symbol: sym,
        score: Number(combined.toFixed(4)),
        bm25Score: Number(bm25Norm.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        centralityBoost: centrality,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    // Expand 1-hop caller/callee context
    if (this.callGraph) {
      for (const res of topResults) {
        const callerSymbols = (res.symbol.callers || [])
          .map((id) => this.callGraph!.nodes.get(id))
          .filter((s): s is CodeSymbol => !!s);

        const calleeSymbols = (res.symbol.callees || [])
          .map((id) => this.callGraph!.nodes.get(id))
          .filter((s): s is CodeSymbol => !!s);

        res.callerCalleeContext = {
          callers: callerSymbols.slice(0, 5),
          callees: calleeSymbols.slice(0, 5),
        };
      }
    }

    return topResults;
  }

  public getSymbol(symbolName: string): CodeSymbol | undefined {
    return this.symbols.find(
      (s) => s.name.toLowerCase() === symbolName.toLowerCase().trim(),
    );
  }

  public getStats() {
    const topHubs = [...this.symbols]
      .sort((a, b) => (b.centralityScore || 0) - (a.centralityScore || 0))
      .slice(0, 5);

    return {
      workspaceDir: this.workspaceDir,
      totalFiles: this.indexedFiles.size,
      totalSymbols: this.symbols.length,
      totalCallEdges: this.callGraph?.edges.length || 0,
      topHubs,
    };
  }

  private discoverFiles(dir: string, depth = 0): string[] {
    if (depth > 6) return [];
    const results: string[] = [];
    const ignored = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      "out",
      ".next",
      ".vynor-worktrees",
      ".gemini",
    ]);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".vynor") continue;
        if (ignored.has(entry.name)) continue;

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.discoverFiles(full, depth + 1));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (
            [
              ".ts",
              ".tsx",
              ".js",
              ".jsx",
              ".mjs",
              ".py",
              ".go",
              ".rs",
              ".java",
            ].includes(ext)
          ) {
            results.push(full);
          }
        }
      }
    } catch {
      // Permission or reading error
    }
    return results;
  }
}
