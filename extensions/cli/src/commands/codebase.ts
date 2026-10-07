/**
 * VynorAI Codebase Command: `cn codebase <subcommand>` / `vynor codebase <subcommand>`
 * ───────────────────────────────────────────────────────────────────────────────────
 * Multi-language AST symbol graph indexing, caller/callee call-graph inspection,
 * and hybrid BM25 + dense token semantic retrieval from the terminal shell.
 */

import chalk from "chalk";
import {
  CodebaseIndexer,
  SearchResult,
  CodeSymbol,
} from "../headless/codebaseIndexer.js";
import { gracefulExit } from "../util/exit.js";

export interface CodebaseOptions {
  dir?: string;
  force?: boolean;
  topK?: string | number;
  json?: boolean;
}

export async function codebaseIndexCommand(
  options: CodebaseOptions,
): Promise<void> {
  const indexer = new CodebaseIndexer(options.dir);
  if (!options.json) {
    console.log(
      chalk.bold.cyan("\n⚡ VynorAI Codebase AST Symbol Graph Indexer"),
    );
    console.log(chalk.gray(`Scanning: ${indexer.getWorkspaceDir()}...`));
  }

  const stats = await indexer.indexWorkspace({
    forceReindex: options.force,
  });

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(
      chalk.green(`\n✔ Indexing Complete in ${stats.durationMs}ms!`),
    );
    console.log(
      ` • Files Indexed:     ${chalk.bold.white(stats.filesIndexed)}`,
    );
    console.log(
      ` • Symbols Extracted: ${chalk.bold.white(stats.symbolsIndexed)}`,
    );
    console.log(
      ` • Call Graph Edges:  ${chalk.bold.white(stats.callGraphEdges)}\n`,
    );
  }

  await gracefulExit(0);
}

export async function codebaseQueryCommand(
  queryText: string,
  options: CodebaseOptions,
): Promise<void> {
  if (!queryText || !queryText.trim()) {
    console.error(chalk.red("Error: Search query string is required."));
    await gracefulExit(1);
    return;
  }

  const topK =
    typeof options.topK === "string"
      ? parseInt(options.topK, 10)
      : options.topK || 5;
  const indexer = new CodebaseIndexer(options.dir);
  await indexer.indexWorkspace();

  const results: SearchResult[] = indexer.query({
    query: queryText,
    topK,
  });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(
      chalk.bold.cyan(
        `\n🔍 Codebase Search Results for: "${queryText}" [Top ${results.length}]`,
      ),
    );
    console.log(
      chalk.gray(
        "─────────────────────────────────────────────────────────────────",
      ),
    );

    if (results.length === 0) {
      console.log(
        chalk.yellow("No matching symbols found in the indexed codebase."),
      );
    } else {
      results.forEach((r, idx) => {
        const sym = r.symbol;
        const scorePct = Math.round(r.score * 100);
        console.log(
          `\n${chalk.bold.green(`#${idx + 1}`)} ${chalk.bold.white(sym.name)} ${chalk.dim(`[${sym.kind}]`)} ${chalk.cyan(`Score: ${scorePct}%`)}`,
        );
        console.log(
          `   ${chalk.gray("Location:")} ${sym.filePath}:${sym.startLine}-${sym.endLine}`,
        );
        console.log(
          `   ${chalk.gray("Signature:")} ${chalk.italic(sym.signature)}`,
        );

        if (sym.docstring) {
          console.log(
            `   ${chalk.gray("Docstring:")} ${chalk.dim(sym.docstring.trim())}`,
          );
        }

        if (r.callerCalleeContext) {
          const callers = r.callerCalleeContext.callers.map((c) => c.name);
          const callees = r.callerCalleeContext.callees.map((c) => c.name);
          if (callers.length > 0) {
            console.log(`   ${chalk.gray("Called by:")} ${callers.join(", ")}`);
          }
          if (callees.length > 0) {
            console.log(`   ${chalk.gray("Calls:")} ${callees.join(", ")}`);
          }
        }
      });
      console.log("");
    }
  }

  await gracefulExit(0);
}

export async function codebaseSymbolCommand(
  symbolName: string,
  options: CodebaseOptions,
): Promise<void> {
  if (!symbolName || !symbolName.trim()) {
    console.error(chalk.red("Error: Symbol name is required."));
    await gracefulExit(1);
    return;
  }

  const indexer = new CodebaseIndexer(options.dir);
  await indexer.indexWorkspace();

  const sym: CodeSymbol | undefined = indexer.getSymbol(symbolName);

  if (options.json) {
    console.log(JSON.stringify(sym || null, null, 2));
  } else {
    if (!sym) {
      console.log(
        chalk.yellow(
          `\nSymbol "${symbolName}" was not found in the codebase AST.`,
        ),
      );
    } else {
      console.log(chalk.bold.cyan(`\n⚡ Symbol Details: ${sym.name}`));
      console.log(
        chalk.gray(
          "─────────────────────────────────────────────────────────────────",
        ),
      );
      console.log(` • Kind:        ${chalk.white(sym.kind)}`);
      console.log(
        ` • Location:    ${sym.filePath}:${sym.startLine}-${sym.endLine}`,
      );
      console.log(` • Signature:   ${sym.signature}`);
      console.log(` • Centrality:  ${sym.centralityScore || 0.1}`);
      if (sym.calls.length > 0) {
        console.log(` • Invocations: ${sym.calls.join(", ")}`);
      }
      if (sym.callers && sym.callers.length > 0) {
        console.log(` • Callers:     ${sym.callers.join(", ")}`);
      }
      console.log("");
    }
  }

  await gracefulExit(sym ? 0 : 1);
}

export async function codebaseStatsCommand(
  options: CodebaseOptions,
): Promise<void> {
  const indexer = new CodebaseIndexer(options.dir);
  await indexer.indexWorkspace();
  const stats = indexer.getStats();

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(
      chalk.bold.cyan("\n📊 Codebase Architecture & Graph Centrality Stats"),
    );
    console.log(
      chalk.gray(
        "─────────────────────────────────────────────────────────────────",
      ),
    );
    console.log(` • Workspace:    ${stats.workspaceDir}`);
    console.log(` • Total Files:  ${stats.totalFiles}`);
    console.log(` • Total Symbols: ${stats.totalSymbols}`);
    console.log(` • Call Graph:   ${stats.totalCallEdges} directional edges`);

    if (stats.topHubs.length > 0) {
      console.log(
        chalk.magenta(
          "\n🏛️  Top Architectural Authority Hubs (Highest Centrality):",
        ),
      );
      stats.topHubs.forEach((h, i) => {
        console.log(
          `   ${i + 1}. ${chalk.bold.white(h.name)} [${h.kind}] (Authority: ${h.centralityScore}) - ${h.filePath}:${h.startLine}`,
        );
      });
    }
    console.log("");
  }

  await gracefulExit(0);
}
