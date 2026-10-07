/**
 * VynorAI Dynamic Grammar & Language Synthesis — Type Definitions
 *
 * Enables 10-year future-proofing by allowing Vynor to dynamically understand,
 * parse, and index any emerging or future programming language (e.g. Mojo, Carbon,
 * Zig, Cairo, Move, Gleam, custom DSLs) at runtime without code updates.
 */

export type LanguageFamily =
  | "c-like"
  | "python-like"
  | "rust-like"
  | "functional"
  | "declarative";

export interface LanguageSpecification {
  name: string;
  extensions: string[];
  family: LanguageFamily;
  commentTokens: {
    line: string[];
    block?: [string, string];
  };
  keywords: string[];
  symbolPatterns: {
    functions: RegExp[];
    classes?: RegExp[];
    structs?: RegExp[];
    types?: RegExp[];
    modules?: RegExp[];
  };
  wasmUrl?: string;
  wasmLocalPath?: string;
}

export interface SynthesizedSymbol {
  name: string;
  type: "function" | "class" | "struct" | "type" | "variable" | "module";
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface GrammarResolution {
  extension: string;
  languageName: string;
  source: "builtin_wasm" | "cached_wasm" | "synthesized_heuristic";
  wasmPath?: string;
  spec?: LanguageSpecification;
}
