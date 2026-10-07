/**
 * VynorAI High-Precision Symbol & Chunk Matcher
 * ---------------------------------------------
 * Matches diff search hunks into target source files with:
 *  1. Exact line position match
 *  2. Sliding window match (line shift tolerance)
 *  3. Whitespace & indentation normalized fuzzy match
 *  4. AST / Symbol-anchored matching (anchoring on function/class boundaries)
 */

import { PatchHunk } from "./unifiedDiffParser.js";

export interface MatchResult {
  success: boolean;
  matchIndex: number; // 0-indexed line in original file
  matchedLineCount: number;
  strategy:
    | "exact_position"
    | "sliding_exact"
    | "whitespace_normalized"
    | "symbol_anchored"
    | "none";
  error?: string;
}

export interface AppliedHunkResult {
  success: boolean;
  newContent: string;
  linesAdded: number;
  linesDeleted: number;
  strategy?: string;
  error?: string;
}

/**
 * Normalize line for fuzzy comparison:
 * - strips carriage returns
 * - trims trailing whitespace
 */
function normalizeLine(line: string): string {
  return line.replace(/\r/g, "").trimEnd();
}

/**
 * Fuzzy line equivalence check:
 * - Checks normalized line
 * - Checks completely trimmed line (ignores indent shift)
 */
function linesMatchFuzzy(a: string, b: string): boolean {
  if (normalizeLine(a) === normalizeLine(b)) return true;
  if (a.trim() === b.trim() && a.trim().length > 0) return true;
  return false;
}

/**
 * Find candidate symbol boundaries in a file (functions, classes, methods, exports)
 */
export function findSymbolAnchors(
  lines: string[],
): Array<{ lineIndex: number; symbolHeader: string }> {
  const anchors: Array<{ lineIndex: number; symbolHeader: string }> = [];
  const symbolRegex =
    /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+([a-zA-Z0-9_$]+)|class\s+([a-zA-Z0-9_$]+)|const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|def\s+([a-zA-Z0-9_$]+))/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(symbolRegex);
    if (match) {
      const symbolName = match[1] || match[2] || match[3] || match[4] || "";
      anchors.push({ lineIndex: i, symbolHeader: symbolName });
    }
  }
  return anchors;
}

/**
 * Locate best match position for searchLines in fileLines
 */
export function findHunkMatch(
  fileLines: string[],
  hunk: PatchHunk,
  allowFuzzy = true,
): MatchResult {
  const search = hunk.searchLines;
  if (search.length === 0) {
    // Pure insertion without context: insert at newStart or end
    const insertIdx = Math.min(
      Math.max(0, hunk.newStart - 1),
      fileLines.length,
    );
    return {
      success: true,
      matchIndex: insertIdx,
      matchedLineCount: 0,
      strategy: "exact_position",
    };
  }

  const expectedIdx = Math.max(0, hunk.oldStart - 1);

  // ── Strategy 1: Exact match at expected position ─────────────────────────
  if (expectedIdx + search.length <= fileLines.length) {
    let exactAtExpected = true;
    for (let i = 0; i < search.length; i++) {
      if (fileLines[expectedIdx + i] !== search[i]) {
        exactAtExpected = false;
        break;
      }
    }
    if (exactAtExpected) {
      return {
        success: true,
        matchIndex: expectedIdx,
        matchedLineCount: search.length,
        strategy: "exact_position",
      };
    }
  }

  // ── Strategy 2: Sliding exact match across whole file ────────────────────
  const exactMatches: number[] = [];
  for (let i = 0; i <= fileLines.length - search.length; i++) {
    let match = true;
    for (let j = 0; j < search.length; j++) {
      if (fileLines[i + j] !== search[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      exactMatches.push(i);
    }
  }

  if (exactMatches.length === 1) {
    return {
      success: true,
      matchIndex: exactMatches[0],
      matchedLineCount: search.length,
      strategy: "sliding_exact",
    };
  } else if (exactMatches.length > 1) {
    // Pick match closest to expectedIdx
    let closest = exactMatches[0];
    let minDistance = Math.abs(closest - expectedIdx);
    for (const idx of exactMatches) {
      const dist = Math.abs(idx - expectedIdx);
      if (dist < minDistance) {
        minDistance = dist;
        closest = idx;
      }
    }
    return {
      success: true,
      matchIndex: closest,
      matchedLineCount: search.length,
      strategy: "sliding_exact",
    };
  }

  if (!allowFuzzy) {
    return {
      success: false,
      matchIndex: -1,
      matchedLineCount: 0,
      strategy: "none",
      error: `Exact match failed for hunk starting with "${search[0]?.slice(0, 40)}"`,
    };
  }

  // ── Strategy 3: Whitespace & indentation normalized match ────────────────
  const normalizedMatches: number[] = [];
  for (let i = 0; i <= fileLines.length - search.length; i++) {
    let match = true;
    for (let j = 0; j < search.length; j++) {
      if (!linesMatchFuzzy(fileLines[i + j], search[j])) {
        match = false;
        break;
      }
    }
    if (match) {
      normalizedMatches.push(i);
    }
  }

  if (normalizedMatches.length > 0) {
    let closest = normalizedMatches[0];
    let minDistance = Math.abs(closest - expectedIdx);
    for (const idx of normalizedMatches) {
      const dist = Math.abs(idx - expectedIdx);
      if (dist < minDistance) {
        minDistance = dist;
        closest = idx;
      }
    }
    return {
      success: true,
      matchIndex: closest,
      matchedLineCount: search.length,
      strategy: "whitespace_normalized",
    };
  }

  // ── Strategy 4: AST / Symbol-anchored matching ───────────────────────────
  if (hunk.contextHeader) {
    const contextSymbol = hunk.contextHeader.trim().toLowerCase();
    const anchors = findSymbolAnchors(fileLines);
    const matchingAnchor = anchors.find(
      (a) =>
        a.symbolHeader.toLowerCase().includes(contextSymbol) ||
        contextSymbol.includes(a.symbolHeader.toLowerCase()),
    );

    if (matchingAnchor) {
      // Search within 60 lines below the symbol declaration
      const searchStart = matchingAnchor.lineIndex;
      const searchEnd = Math.min(fileLines.length, searchStart + 60);

      for (let i = searchStart; i <= searchEnd - search.length; i++) {
        let match = true;
        for (let j = 0; j < search.length; j++) {
          if (!linesMatchFuzzy(fileLines[i + j], search[j])) {
            match = false;
            break;
          }
        }
        if (match) {
          return {
            success: true,
            matchIndex: i,
            matchedLineCount: search.length,
            strategy: "symbol_anchored",
          };
        }
      }
    }
  }

  return {
    success: false,
    matchIndex: -1,
    matchedLineCount: 0,
    strategy: "none",
    error: `Could not match diff chunk in file content (tried exact, sliding, fuzzy, symbol-anchored)`,
  };
}

/**
 * Apply a single patch hunk to file content
 */
export function applyHunk(
  fileContent: string,
  hunk: PatchHunk,
  allowFuzzy = true,
): AppliedHunkResult {
  const fileLines = fileContent.split(/\r?\n/);
  const match = findHunkMatch(fileLines, hunk, allowFuzzy);

  if (!match.success) {
    return {
      success: false,
      newContent: fileContent,
      linesAdded: 0,
      linesDeleted: 0,
      error: match.error,
    };
  }

  // If fuzzy matched, adjust indentation of replacement lines to match original file's indent
  let finalReplacement = [...hunk.replaceLines];
  if (
    match.strategy === "whitespace_normalized" ||
    match.strategy === "symbol_anchored"
  ) {
    const originalFirstLine = fileLines[match.matchIndex];
    const searchFirstLine = hunk.searchLines[0];
    if (originalFirstLine && searchFirstLine) {
      const origIndentMatch = originalFirstLine.match(/^(\s*)/);
      const searchIndentMatch = searchFirstLine.match(/^(\s*)/);
      const origIndent = origIndentMatch ? origIndentMatch[1] : "";
      const searchIndent = searchIndentMatch ? searchIndentMatch[1] : "";

      if (origIndent !== searchIndent) {
        finalReplacement = hunk.replaceLines.map((line) => {
          if (line.startsWith(searchIndent)) {
            return origIndent + line.slice(searchIndent.length);
          }
          return line;
        });
      }
    }
  }

  // Splice replacement into file lines
  const newLines = [...fileLines];
  newLines.splice(
    match.matchIndex,
    match.matchedLineCount,
    ...finalReplacement,
  );

  const linesDeleted = match.matchedLineCount;
  const linesAdded = finalReplacement.length;

  return {
    success: true,
    newContent: newLines.join("\n"),
    linesAdded,
    linesDeleted,
    strategy: match.strategy,
  };
}
