/**
 * VynorAI High-Speed Unified Diff & Search/Replace Parser
 * ---------------------------------------------------------
 * Parses multi-file patches in:
 *  1. Unified Diff format (git diff, unified diff with @@ -l,s +l,s @@ headers)
 *  2. Search / Replace block format (<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE)
 *  3. Markdown fenced code blocks (```diff ... ```)
 */

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  contextHeader?: string; // Symbol/function context from @@ ... @@ <symbol>
  searchLines: string[]; // Lines to find / replace
  replaceLines: string[]; // Replacement lines
  rawText: string;
}

export interface ParsedFilePatch {
  targetFile: string;
  oldPath?: string;
  newPath?: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  hunks: PatchHunk[];
  format: "unified" | "search_replace";
}

/**
 * Dedent common leading whitespace from all lines
 */
export function dedent(text: string): string {
  const lines = text.split(/\r?\n/);
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;
    if (indent < minIndent) {
      minIndent = indent;
    }
  }
  if (minIndent > 0 && minIndent !== Infinity) {
    return lines
      .map((line) => (line.length >= minIndent ? line.slice(minIndent) : line))
      .join("\n");
  }
  return text;
}

/**
 * Strip surrounding markdown code fences if present and dedent
 */
export function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }
  if (cleaned.endsWith("```")) {
    const lastFence = cleaned.lastIndexOf("```");
    cleaned = cleaned.slice(0, lastFence).trimEnd();
  }
  return dedent(cleaned);
}

/**
 * Clean path names by stripping git prefixes (a/, b/) and quotes
 */
export function cleanFilePath(rawPath: string): string {
  let p = rawPath.trim();
  p = p.replace(/^["']|["']$/g, "");
  p = p.replace(/^[ab]\//, "");
  p = p.replace(/^(\.\/)+/, "");
  return p;
}

/**
 * Parse Search/Replace blocks:
 * <<<<<<< SEARCH
 * [old code]
 * =======
 * [new code]
 * >>>>>>> REPLACE
 */
export function parseSearchReplaceBlocks(diffText: string): ParsedFilePatch[] {
  const patches: ParsedFilePatch[] = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile: string | null = null;
  let currentHunks: PatchHunk[] = [];

  let inSearch = false;
  let inReplace = false;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  const fileHeaderRegex =
    /^(?:#+\s*File:\s*|###\s+|---\s+|File:\s*)([^\s\n\r]+)/i;
  const standaloneFileRegex = /^[a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+$/;

  const commitCurrentFile = () => {
    if (currentFile && currentHunks.length > 0) {
      patches.push({
        targetFile: cleanFilePath(currentFile),
        isNewFile: false,
        isDeletedFile: false,
        hunks: currentHunks,
        format: "search_replace",
      });
      currentHunks = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check file header
    const fileMatch = line.match(fileHeaderRegex);
    if (fileMatch && !inSearch && !inReplace) {
      commitCurrentFile();
      currentFile = fileMatch[1];
      continue;
    }

    if (standaloneFileRegex.test(line.trim()) && !inSearch && !inReplace) {
      // Possible naked filename line right before search block
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && nextLine.startsWith("<<<<<<< SEARCH")) {
        commitCurrentFile();
        currentFile = line.trim();
        continue;
      }
    }

    if (line.trim().startsWith("<<<<<<< SEARCH")) {
      inSearch = true;
      inReplace = false;
      searchLines = [];
      replaceLines = [];
      continue;
    }

    if (line.trim() === "=======" && inSearch) {
      inSearch = false;
      inReplace = true;
      continue;
    }

    if (line.trim().startsWith(">>>>>>> REPLACE") && inReplace) {
      inReplace = false;
      const hunk: PatchHunk = {
        oldStart: 1,
        oldLines: searchLines.length,
        newStart: 1,
        newLines: replaceLines.length,
        searchLines: [...searchLines],
        replaceLines: [...replaceLines],
        rawText: `<<<<<<< SEARCH\n${searchLines.join("\n")}\n=======\n${replaceLines.join("\n")}\n>>>>>>> REPLACE`,
      };

      if (!currentFile) {
        currentFile = "unknown_file";
      }
      currentHunks.push(hunk);
      searchLines = [];
      replaceLines = [];
      continue;
    }

    if (inSearch) {
      searchLines.push(line);
    } else if (inReplace) {
      replaceLines.push(line);
    }
  }

  commitCurrentFile();
  return patches;
}

/**
 * Parse Unified Diff format (git diff / diff -u)
 */
export function parseUnifiedDiff(diffText: string): ParsedFilePatch[] {
  const patches: ParsedFilePatch[] = [];
  const lines = diffText.split(/\r?\n/);

  let currentPatch: ParsedFilePatch | null = null;
  let currentHunk: PatchHunk | null = null;

  const hunkHeaderRegex =
    /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect file header
    if (line.startsWith("diff --git ")) {
      if (currentHunk && currentPatch) {
        currentPatch.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentPatch && currentPatch.hunks.length > 0) {
        patches.push(currentPatch);
      }

      const parts = line.split(" ");
      const oldP = parts[2] ? cleanFilePath(parts[2]) : "";
      const newP = parts[3] ? cleanFilePath(parts[3]) : "";

      currentPatch = {
        targetFile: newP || oldP,
        oldPath: oldP,
        newPath: newP,
        isNewFile: false,
        isDeletedFile: false,
        hunks: [],
        format: "unified",
      };
      continue;
    }

    if (line.startsWith("--- ")) {
      const oldP = cleanFilePath(line.slice(4));
      if (!currentPatch) {
        currentPatch = {
          targetFile: oldP,
          oldPath: oldP,
          isNewFile: false,
          isDeletedFile: false,
          hunks: [],
          format: "unified",
        };
      } else {
        currentPatch.oldPath = oldP;
      }
      if (line.includes("/dev/null")) {
        currentPatch.isNewFile = true;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newP = cleanFilePath(line.slice(4));
      if (!currentPatch) {
        currentPatch = {
          targetFile: newP,
          newPath: newP,
          isNewFile: false,
          isDeletedFile: false,
          hunks: [],
          format: "unified",
        };
      } else {
        currentPatch.newPath = newP;
        currentPatch.targetFile = newP;
      }
      if (line.includes("/dev/null")) {
        currentPatch.isDeletedFile = true;
      }
      continue;
    }

    // Detect hunk header
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      if (currentHunk && currentPatch) {
        currentPatch.hunks.push(currentHunk);
      }

      if (!currentPatch) {
        currentPatch = {
          targetFile: "unknown_file",
          isNewFile: false,
          isDeletedFile: false,
          hunks: [],
          format: "unified",
        };
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines =
        hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines =
        hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      const contextHeader = hunkMatch[5]?.trim() || undefined;

      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        contextHeader,
        searchLines: [],
        replaceLines: [],
        rawText: line,
      };
      continue;
    }

    // Inside a hunk
    if (currentHunk) {
      if (line.startsWith("-")) {
        currentHunk.searchLines.push(line.slice(1));
        currentHunk.rawText += `\n${line}`;
      } else if (line.startsWith("+")) {
        currentHunk.replaceLines.push(line.slice(1));
        currentHunk.rawText += `\n${line}`;
      } else if (line.startsWith(" ")) {
        const contextLine = line.slice(1);
        currentHunk.searchLines.push(contextLine);
        currentHunk.replaceLines.push(contextLine);
        currentHunk.rawText += `\n${line}`;
      } else if (
        line === "" &&
        currentHunk.searchLines.length < currentHunk.oldLines
      ) {
        currentHunk.searchLines.push("");
        currentHunk.replaceLines.push("");
        currentHunk.rawText += `\n${line}`;
      } else if (line === "") {
        // Blank line outside context: close current hunk
        if (currentHunk && currentPatch) {
          currentPatch.hunks.push(currentHunk);
          currentHunk = null;
        }
      }
    }
  }

  if (currentHunk && currentPatch) {
    currentPatch.hunks.push(currentHunk);
  }
  if (currentPatch && currentPatch.hunks.length > 0) {
    patches.push(currentPatch);
  }

  return patches;
}

/**
 * Universal Multi-File Diff Parser
 * Autodetects Unified Diff vs Search/Replace and returns structured file patches.
 */
export function parseMultiFileDiff(rawInput: string): ParsedFilePatch[] {
  const cleaned = stripCodeFences(rawInput);

  // Check if payload contains Search/Replace markers
  if (
    cleaned.includes("<<<<<<< SEARCH") &&
    cleaned.includes(">>>>>>> REPLACE")
  ) {
    const srPatches = parseSearchReplaceBlocks(cleaned);
    if (srPatches.length > 0) {
      return srPatches;
    }
  }

  // Parse unified diff
  const unifiedPatches = parseUnifiedDiff(cleaned);
  if (unifiedPatches.length > 0) {
    return unifiedPatches;
  }

  return [];
}
