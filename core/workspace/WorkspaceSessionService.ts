import { createHash } from "crypto";

import type { IDE, IndexingProgressUpdate } from "..";
import { findUriInDirs, getUriPathBasename, joinPathsToUri } from "../util/uri";
import type {
  WorkspaceArtifactSnapshot,
  WorkspaceIndexState,
  WorkspaceSnapshot,
} from "./types";

const MAX_METADATA_BYTES = 64 * 1024;
const MANIFESTS: Record<string, string> = {
  "package.json": "node",
  "pnpm-workspace.yaml": "pnpm-workspace",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "composer.json": "php",
  Gemfile: "ruby",
};
const INSTRUCTION_FILES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  ".continue/rules.md",
  ".github/copilot-instructions.md",
];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toIndexState(
  state: IndexingProgressUpdate["status"] | undefined,
): WorkspaceIndexState {
  if (state === "done") return "ready";
  return state ?? "unknown";
}

export class WorkspaceSessionService {
  private snapshot?: WorkspaceSnapshot;
  private revision = 0;
  private invalidated = true;
  /** Root the user picked explicitly; wins over file/single-root inference. */
  private manualRootId?: string;
  private activeRootUri?: string;

  constructor(
    private readonly ide: IDE,
    private readonly getIndexState: () => IndexingProgressUpdate | undefined,
    private readonly resumeRetryDelayMs = 500,
  ) {}

  invalidate(): void {
    this.invalidated = true;
  }

  /**
   * Pin the active root (multi-root workspaces with no usable active file).
   * An unknown id is rejected so a stale picker can never select a root that
   * is no longer open.
   */
  /** URI of the selected root. Kept off the snapshot: it holds absolute paths. */
  async getActiveRootUri(): Promise<string | undefined> {
    await this.getSnapshot();
    return this.activeRootUri;
  }

  async setActiveRoot(rootId: string): Promise<WorkspaceSnapshot> {
    const snapshot = await this.getSnapshot(true);
    if (!snapshot.roots.some((root) => root.id === rootId)) {
      throw new Error(`Unknown workspace root: ${rootId}`);
    }
    this.manualRootId = rootId;
    this.invalidated = true;
    return this.getSnapshot(true);
  }

  async getSnapshot(force = false): Promise<WorkspaceSnapshot> {
    if (!force && !this.invalidated && this.snapshot) return this.snapshot;

    let workspaceDirs = [...(await this.ide.getWorkspaceDirs())].sort();
    // VS Code can briefly report no folders immediately after laptop resume
    // while the extension host reconnects. Do not replace a known workspace
    // with an empty snapshot until it has had one short chance to recover.
    if (force && workspaceDirs.length === 0 && this.snapshot?.roots.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.resumeRetryDelayMs),
      );
      workspaceDirs = [...(await this.ide.getWorkspaceDirs())].sort();
    }
    const currentFile = await this.ide.getCurrentFile().catch(() => undefined);
    const trusted = this.ide.isWorkspaceTrusted
      ? await this.ide.isWorkspaceTrusted().catch(() => false)
      : false;

    const roots = await Promise.all(
      workspaceDirs.map(async (uri) => ({
        uri,
        id: digest(uri).slice(0, 16),
        name: getUriPathBasename(uri) || "workspace",
        branch: await this.ide.getBranch(uri).catch(() => undefined),
      })),
    );

    const currentLocation =
      currentFile && !currentFile.isUntitled
        ? findUriInDirs(currentFile.path, workspaceDirs)
        : undefined;
    const activeRoot = roots.find(
      (root) => root.uri === currentLocation?.foundInDir,
    );
    // A root the user picked explicitly wins, until it is closed.
    const manualRoot = roots.find((root) => root.id === this.manualRootId);
    if (this.manualRootId && !manualRoot) this.manualRootId = undefined;
    const selectedRoot =
      manualRoot ?? activeRoot ?? (roots.length === 1 ? roots[0] : undefined);
    this.activeRootUri = selectedRoot?.uri;

    const [manifests, instructions] = await Promise.all([
      this.collectArtifacts(roots, MANIFESTS),
      this.collectArtifacts(
        roots,
        Object.fromEntries(
          INSTRUCTION_FILES.map((path) => [path, "instructions"]),
        ),
      ),
    ]);
    const indexState = this.getIndexState();
    const index = roots.map((root) => ({
      rootId: root.id,
      status: toIndexState(indexState?.status),
      progress: indexState?.progress,
    }));

    const comparable = {
      roots: roots.map(({ uri: _uri, ...root }) => root),
      activeRootId: selectedRoot?.id,
      activeFile:
        currentLocation?.foundInDir && currentLocation.relativePathOrBasename
          ? {
              rootId: digest(currentLocation.foundInDir).slice(0, 16),
              uri: currentLocation.relativePathOrBasename,
            }
          : undefined,
      manifests,
      instructions,
      index,
      trusted,
      capabilities: [
        "workspace-context",
        "codebase-index",
        ...(trusted ? ["workspace-tools"] : []),
      ],
    };
    const fingerprint = digest(JSON.stringify(comparable));
    const previousFingerprint = this.snapshot
      ? digest(
          JSON.stringify({
            roots: this.snapshot.roots,
            activeRootId: this.snapshot.activeRootId,
            activeFile: this.snapshot.activeFile,
            manifests: this.snapshot.manifests,
            instructions: this.snapshot.instructions,
            index: this.snapshot.index,
            trusted: this.snapshot.trusted,
            capabilities: this.snapshot.capabilities,
          }),
        )
      : undefined;
    if (fingerprint !== previousFingerprint) this.revision += 1;

    this.snapshot = {
      id: digest(workspaceDirs.join("|") || "no-workspace").slice(0, 24),
      revision: this.revision,
      ...comparable,
      createdAt: Date.now(),
    };
    this.invalidated = false;
    return this.snapshot;
  }

  private async collectArtifacts(
    roots: Array<{ id: string; uri: string }>,
    candidates: Record<string, string>,
  ): Promise<WorkspaceArtifactSnapshot[]> {
    const artifacts = await Promise.all(
      roots.flatMap((root) =>
        Object.entries(candidates).map(async ([relativePath, kind]) => {
          const uri = joinPathsToUri(root.uri, relativePath);
          try {
            if (!(await this.ide.fileExists(uri))) return undefined;
            if (this.ide.getFileStats) {
              const stats = await this.ide.getFileStats([uri]);
              if (stats[uri]?.size > MAX_METADATA_BYTES) return undefined;
            }
            const content = await this.ide.readFile(uri);
            if (Buffer.byteLength(content, "utf8") > MAX_METADATA_BYTES) {
              return undefined;
            }
            return {
              rootId: root.id,
              uri: relativePath,
              kind,
              digest: digest(content),
            } satisfies WorkspaceArtifactSnapshot;
          } catch {
            return undefined;
          }
        }),
      ),
    );
    return artifacts.filter(
      (item): item is WorkspaceArtifactSnapshot => item !== undefined,
    );
  }
}
