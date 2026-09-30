export interface ProjectSnapshot {
  id: string;
  timestamp: string;
  files: Record<string, string>;
}

// In-memory snapshots registry for zero-overhead instant rollback
const snapshotStore = new Map<string, ProjectSnapshot>();

export function createProjectSnapshot(files: Record<string, string>): string {
  const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  snapshotStore.set(snapshotId, {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    files: { ...files },
  });
  return snapshotId;
}

export function restoreProjectSnapshot(snapshotId: string): Record<string, string> | null {
  const snap = snapshotStore.get(snapshotId);
  if (!snap) return null;
  return { ...snap.files };
}

/**
 * Check if a template is already installed in the target codebase.
 * Prevents redundant duplicate installations when a user repeats a command.
 */
export function isTemplateInstalled(
  templateId: string,
  projectFiles: Record<string, string>
): { installed: boolean; location?: string } {
  const cleanId = templateId.replace(/-/g, "_");

  for (const [filePath, content] of Object.entries(projectFiles)) {
    // Check marker comment or filename
    if (content.includes(`@vynor:template(${templateId})`) || content.includes(`VynorAI Verified Scaffold: ${templateId}`)) {
      return { installed: true, location: filePath };
    }
    if (filePath.includes(cleanId)) {
      return { installed: true, location: filePath };
    }
  }

  return { installed: false };
}
