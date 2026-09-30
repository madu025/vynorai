import { PatchOperation, PatchResult } from "./types.js";

/**
 * Deterministic File Patch Engine
 * Performs surgical edits (ADD_IMPORT, ADD_ROUTE, INSERT_AFTER) instead of full file rewrites.
 * Enforces DO_NOT_MODIFY protected section boundaries.
 */
export function applyFilePatches(
  initialFiles: Record<string, string>,
  patches: PatchOperation[],
  protectedSections: string[] = []
): PatchResult {
  const fileContents = { ...initialFiles };
  const modifiedFiles: string[] = [];
  const errors: string[] = [];
  const diffs: { file: string; diff: string }[] = [];

  for (const patch of patches) {
    const existingContent = fileContents[patch.file] || "";

    // 1. DO_NOT_MODIFY Security Guard
    for (const sec of protectedSections) {
      const protectedMarker = `@vynor:protected(${sec})`;
      if (existingContent.includes(protectedMarker) && patch.type === "REPLACE_BLOCK") {
        if (patch.targetAnchor.includes(sec)) {
          errors.push(
            `SECURITY VIOLATION: Cannot modify protected security section '${sec}' in ${patch.file}. Marked as DO_NOT_MODIFY.`
          );
          return { success: false, modifiedFiles: [], errors, diffs };
        }
      }
    }

    let updatedContent = existingContent;

    switch (patch.type) {
      case "ADD_IMPORT": {
        // Prevent duplicate import lines
        const importLine = patch.payload.trim();
        if (existingContent.includes(importLine)) {
          break; // Already imported
        }
        updatedContent = `${importLine}\n${existingContent}`;
        break;
      }

      case "INSERT_AFTER": {
        if (!existingContent.includes(patch.targetAnchor)) {
          errors.push(`Anchor '${patch.targetAnchor}' not found in ${patch.file}`);
          break;
        }
        const idx = existingContent.indexOf(patch.targetAnchor) + patch.targetAnchor.length;
        updatedContent =
          existingContent.slice(0, idx) + "\n" + patch.payload + "\n" + existingContent.slice(idx);
        break;
      }

      case "INSERT_BEFORE": {
        if (!existingContent.includes(patch.targetAnchor)) {
          errors.push(`Anchor '${patch.targetAnchor}' not found in ${patch.file}`);
          break;
        }
        const idx = existingContent.indexOf(patch.targetAnchor);
        updatedContent =
          existingContent.slice(0, idx) + "\n" + patch.payload + "\n" + existingContent.slice(idx);
        break;
      }

      case "ADD_ROUTE": {
        // Append route handler before the export statement or at the bottom
        const exportIdx = existingContent.lastIndexOf("export default");
        if (exportIdx !== -1) {
          updatedContent =
            existingContent.slice(0, exportIdx) +
            "\n" +
            patch.payload +
            "\n\n" +
            existingContent.slice(exportIdx);
        } else {
          updatedContent = `${existingContent}\n\n${patch.payload}`;
        }
        break;
      }

      case "REPLACE_BLOCK": {
        if (!existingContent.includes(patch.targetAnchor)) {
          errors.push(`Target block '${patch.targetAnchor}' not found in ${patch.file}`);
          break;
        }
        updatedContent = existingContent.replace(patch.targetAnchor, patch.payload);
        break;
      }
    }

    if (updatedContent !== existingContent) {
      fileContents[patch.file] = updatedContent;
      if (!modifiedFiles.includes(patch.file)) {
        modifiedFiles.push(patch.file);
      }
      diffs.push({
        file: patch.file,
        diff: `[PATCH:${patch.type}] on '${patch.targetAnchor || "ROOT"}'`,
      });
    }
  }

  return {
    success: errors.length === 0,
    modifiedFiles,
    errors,
    diffs,
  };
}
