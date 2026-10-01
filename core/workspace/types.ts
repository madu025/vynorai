export type WorkspaceIndexState =
  | "loading"
  | "waiting"
  | "indexing"
  | "ready"
  | "failed"
  | "paused"
  | "disabled"
  | "cancelled"
  | "unknown";

export interface WorkspaceRootSnapshot {
  id: string;
  name: string;
  branch?: string;
}

export interface WorkspaceArtifactSnapshot {
  rootId: string;
  /** Workspace-relative path. Absolute local paths must never cross the UI boundary. */
  uri: string;
  kind: string;
  digest: string;
}

export interface WorkspaceSnapshot {
  id: string;
  revision: number;
  roots: WorkspaceRootSnapshot[];
  activeRootId?: string;
  activeFile?: { rootId: string; uri: string };
  manifests: WorkspaceArtifactSnapshot[];
  instructions: WorkspaceArtifactSnapshot[];
  index: Array<{
    rootId: string;
    status: WorkspaceIndexState;
    progress?: number;
    description?: string;
  }>;
  trusted: boolean;
  capabilities: string[];
  createdAt: number;
}
