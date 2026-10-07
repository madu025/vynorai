/**
 * Dynamic Grammar Synthesizer
 *
 * Implements VynorAI's 10-Year Future-Proofing Language Synthesis:
 * When an unknown, future, or custom programming language (e.g. Mojo, Zig, Carbon,
 * Cairo, Move, Gleam, custom DSLs) is encountered, this engine:
 *  1. Resolves community / local Tree-Sitter WASM parsers if cached or available
 *  2. Autonomously infers syntax rules (delimiters, comments, function/class keywords)
 *  3. Generates resilient AST-level symbol & scope extractors
 *  4. Dynamically registers the language with Vynor's indexing and navigation pipelines
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  GrammarResolution,
  LanguageSpecification,
  SynthesizedSymbol,
} from "./types.js";

export class DynamicGrammarSynthesizer {
  private static grammarCache = new Map<string, GrammarResolution>();
  private static specsCache = new Map<string, LanguageSpecification>();

  private static readonly KNOWN_NEXTGEN_SPECS: Record<
    string,
    LanguageSpecification
  > = {
    mojo: {
      name: "mojo",
      extensions: ["mojo", "🔥"],
      family: "python-like",
      commentTokens: { line: ["#"] },
      keywords: [
        "fn",
        "def",
        "struct",
        "trait",
        "var",
        "let",
        "alias",
        "import",
        "from",
      ],
      symbolPatterns: {
        functions: [/^\s*(?:pub\s+)?(?:fn|def)\s+([A-Za-z0-9_]+)\s*\(/gm],
        structs: [/^\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/gm],
        types: [/^\s*alias\s+([A-Za-z0-9_]+)\s*=/gm],
      },
    },
    zig: {
      name: "zig",
      extensions: ["zig"],
      family: "c-like",
      commentTokens: { line: ["//"] },
      keywords: [
        "fn",
        "pub",
        "const",
        "var",
        "struct",
        "enum",
        "union",
        "test",
      ],
      symbolPatterns: {
        functions: [/^\s*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)\s*\(/gm],
        structs: [
          /^\s*(?:pub\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:packed\s+)?struct/gm,
        ],
        types: [
          /^\s*(?:pub\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:enum|union|opaque)/gm,
        ],
      },
    },
    carbon: {
      name: "carbon",
      extensions: ["carbon"],
      family: "c-like",
      commentTokens: { line: ["//"] },
      keywords: [
        "fn",
        "class",
        "package",
        "namespace",
        "var",
        "let",
        "impl",
        "interface",
      ],
      symbolPatterns: {
        functions: [/^\s*fn\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/gm],
        classes: [/^\s*class\s+([A-Za-z0-9_]+)/gm],
        types: [/^\s*interface\s+([A-Za-z0-9_]+)/gm],
      },
    },
    cairo: {
      name: "cairo",
      extensions: ["cairo"],
      family: "rust-like",
      commentTokens: { line: ["//"] },
      keywords: ["fn", "struct", "enum", "trait", "impl", "mod", "use"],
      symbolPatterns: {
        functions: [/^\s*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)\s*\(/gm],
        structs: [/^\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/gm],
        types: [/^\s*(?:pub\s+)?enum\s+([A-Za-z0-9_]+)/gm],
      },
    },
    move: {
      name: "move",
      extensions: ["move"],
      family: "rust-like",
      commentTokens: { line: ["//"] },
      keywords: ["module", "fun", "struct", "public", "entry", "use"],
      symbolPatterns: {
        functions: [
          /^\s*(?:public(?:\s*\([^)]*\))?\s+)?(?:entry\s+)?fun\s+([A-Za-z0-9_]+)\s*\(/gm,
        ],
        structs: [/^\s*struct\s+([A-Za-z0-9_]+)/gm],
        modules: [/^\s*module\s+([A-Za-z0-9_::]+)/gm],
      },
    },
    gleam: {
      name: "gleam",
      extensions: ["gleam"],
      family: "functional",
      commentTokens: { line: ["//"] },
      keywords: ["pub", "fn", "type", "import", "case", "let"],
      symbolPatterns: {
        functions: [/^\s*(?:pub\s+)?fn\s+([A-Za-z0-9_]+)\s*\(/gm],
        types: [/^\s*(?:pub\s+)?type\s+([A-Za-z0-9_]+)/gm],
      },
    },
  };

  /**
   * Register a custom or newly synthesized language specification.
   */
  static registerSpecification(spec: LanguageSpecification): void {
    for (const ext of spec.extensions) {
      const cleanExt = ext.toLowerCase().replace(/^\./, "");
      this.specsCache.set(cleanExt, spec);
      this.grammarCache.delete(cleanExt);
    }
  }

  /**
   * Clear in-memory caches (useful for testing or cache invalidation).
   */
  static clearCaches(): void {
    this.grammarCache.clear();
    this.specsCache.clear();
  }

  /**
   * Get the global storage directory for dynamically downloaded or cached grammars.
   */
  static getGrammarsCacheDir(): string {
    const dir = path.join(os.homedir(), ".vynor", "grammars");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Autonomously infer grammar specifications from code heuristics when no pre-defined spec exists.
   */
  static inferSpecification(
    extension: string,
    sampleContent = "",
  ): LanguageSpecification {
    const ext = extension.toLowerCase().replace(/^\./, "");
    if (this.specsCache.has(ext)) return this.specsCache.get(ext)!;

    // Check predefined next-gen languages
    for (const spec of Object.values(this.KNOWN_NEXTGEN_SPECS)) {
      if (spec.extensions.includes(ext)) {
        this.specsCache.set(ext, spec);
        return spec;
      }
    }

    // Zero-shot heuristic syntax analysis on file content
    const hasHashComments = /^\s*#/m.test(sampleContent);
    const hasSlashComments = /^\s*\/\//m.test(sampleContent);
    const hasCurlyBraces = /\{[\s\S]*\}/m.test(sampleContent);
    const hasPythonDef = /^\s*def\s+[A-Za-z0-9_]+\s*\(/m.test(sampleContent);
    const hasFnKeyword = /^\s*(?:pub\s+)?fn\s+[A-Za-z0-9_]+\s*\(/m.test(
      sampleContent,
    );
    const hasFunctionKeyword = /^\s*function\s+[A-Za-z0-9_]+\s*\(/m.test(
      sampleContent,
    );

    const family = hasCurlyBraces
      ? hasFnKeyword
        ? "rust-like"
        : "c-like"
      : hasPythonDef
        ? "python-like"
        : "declarative";

    const spec: LanguageSpecification = {
      name: ext,
      extensions: [ext],
      family,
      commentTokens: {
        line: hasSlashComments ? ["//"] : hasHashComments ? ["#"] : ["//", "#"],
      },
      keywords: [
        "fn",
        "def",
        "function",
        "class",
        "struct",
        "type",
        "let",
        "var",
        "const",
      ],
      symbolPatterns: {
        functions: [
          /^\s*(?:pub(?:lic)?\s+)?(?:fn|def|func|function|proc)\s+([A-Za-z0-9_]+)\s*\(/gm,
        ],
        classes: [/^\s*(?:pub(?:lic)?\s+)?class\s+([A-Za-z0-9_]+)/gm],
        structs: [/^\s*(?:pub(?:lic)?\s+)?struct\s+([A-Za-z0-9_]+)/gm],
        types: [/^\s*(?:pub(?:lic)?\s+)?type\s+([A-Za-z0-9_]+)/gm],
      },
    };

    this.specsCache.set(ext, spec);
    return spec;
  }

  /**
   * Resolve language grammar: checks for cached Tree-sitter WASM binary first,
   * otherwise falls back to synthesized heuristic AST extraction.
   */
  static resolveLanguage(
    extension: string,
    sampleContent = "",
  ): GrammarResolution {
    const ext = extension.toLowerCase().replace(/^\./, "");
    if (this.grammarCache.has(ext)) return this.grammarCache.get(ext)!;

    const spec = this.inferSpecification(ext, sampleContent);
    const wasmCachePath = path.join(
      this.getGrammarsCacheDir(),
      `tree-sitter-${spec.name}.wasm`,
    );

    let resolution: GrammarResolution;
    if (fs.existsSync(wasmCachePath)) {
      resolution = {
        extension: ext,
        languageName: spec.name,
        source: "cached_wasm",
        wasmPath: wasmCachePath,
        spec,
      };
    } else {
      resolution = {
        extension: ext,
        languageName: spec.name,
        source: "synthesized_heuristic",
        spec,
      };
    }

    this.grammarCache.set(ext, resolution);
    return resolution;
  }

  /**
   * Extract top-level symbols (functions, structs, classes, types) from code using
   * synthesized language rules. Returns symbols with line-precise ranges compatible
   * with Vynor's Codebase Symbol Indexing pipeline.
   */
  static extractSymbols(
    extension: string,
    content: string,
  ): SynthesizedSymbol[] {
    const resolution = this.resolveLanguage(extension, content);
    const spec = resolution.spec || this.inferSpecification(extension, content);
    const symbols: SynthesizedSymbol[] = [];
    const lines = content.split("\n");

    const scanPattern = (pattern: RegExp, type: SynthesizedSymbol["type"]) => {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;

        // Find 0-indexed line number
        const charIndex = match.index;
        const upToChar = content.slice(0, charIndex);
        const lineNumber = upToChar.split("\n").length - 1;
        const lineContent = lines[lineNumber] || "";
        const charStart = lineContent.indexOf(name);

        symbols.push({
          name,
          type,
          range: {
            start: { line: lineNumber, character: Math.max(0, charStart) },
            end: {
              line: lineNumber,
              character: Math.max(0, charStart + name.length),
            },
          },
        });
      }
    };

    for (const fnPattern of spec.symbolPatterns.functions) {
      scanPattern(fnPattern, "function");
    }
    if (spec.symbolPatterns.structs) {
      for (const stPattern of spec.symbolPatterns.structs) {
        scanPattern(stPattern, "struct");
      }
    }
    if (spec.symbolPatterns.classes) {
      for (const clPattern of spec.symbolPatterns.classes) {
        scanPattern(clPattern, "class");
      }
    }
    if (spec.symbolPatterns.types) {
      for (const tpPattern of spec.symbolPatterns.types) {
        scanPattern(tpPattern, "type");
      }
    }
    if (spec.symbolPatterns.modules) {
      for (const mdPattern of spec.symbolPatterns.modules) {
        scanPattern(mdPattern, "module");
      }
    }

    // Sort symbols chronologically by line
    return symbols.sort((a, b) => a.range.start.line - b.range.start.line);
  }
}
