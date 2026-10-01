import { createHash, randomUUID } from "crypto";
import * as vscode from "vscode";

export type AgentCheckpointSummary = {
  id: string;
  fileUri: string;
  fileName: string;
  createdAt: number;
  label: string;
};

type StoredCheckpoint = AgentCheckpointSummary & {
  beforeContent: string | null;
  afterHash?: string;
};

const MAX_CHECKPOINTS = 20;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function hash(content: string | null): string {
  return createHash("sha256").update(content ?? "<missing>").digest("hex");
}

export class AgentCheckpointManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get checkpointDir(): vscode.Uri {
    const workspaceScope = (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri.toString())
      .sort()
      .join("|");
    const scopeHash = createHash("sha256")
      .update(workspaceScope || "no-workspace")
      .digest("hex")
      .slice(0, 16);
    return vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "agent-checkpoints",
      scopeHash,
    );
  }

  private ensureWorkspaceFile(fileUri: string): vscode.Uri {
    const uri = vscode.Uri.parse(fileUri, true);
    if (uri.scheme !== "file" || !vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("Checkpoints are limited to files inside the current workspace.");
    }
    return uri;
  }

  private async readCurrentContent(uri: vscode.Uri): Promise<string | null> {
    const openDocument = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (openDocument) return openDocument.getText();
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return null;
      }
      throw error;
    }
  }

  async create(fileUri: string, label = "Agent edit"): Promise<string | undefined> {
    let uri: vscode.Uri;
    try {
      uri = this.ensureWorkspaceFile(fileUri);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_FILE_BYTES) return undefined;
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        return undefined;
      }
      uri = vscode.Uri.parse(fileUri, true);
      if (!vscode.workspace.getWorkspaceFolder(uri)) return undefined;
    }
    const beforeContent = await this.readCurrentContent(uri);
    if (beforeContent !== null && Buffer.byteLength(beforeContent, "utf8") > MAX_FILE_BYTES) {
      return undefined;
    }
    const checkpoint: StoredCheckpoint = {
      id: randomUUID(),
      fileUri: uri.toString(),
      fileName: vscode.workspace.asRelativePath(uri, false),
      createdAt: Date.now(),
      label,
      beforeContent,
    };
    await vscode.workspace.fs.createDirectory(this.checkpointDir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(this.checkpointDir, `${checkpoint.id}.json`),
      new TextEncoder().encode(JSON.stringify(checkpoint)),
    );
    await this.prune();
    return checkpoint.id;
  }

  async finalize(id: string | undefined): Promise<void> {
    if (!id) return;
    const checkpoint = await this.read(id);
    if (!checkpoint) return;
    const uri = this.ensureWorkspaceFile(checkpoint.fileUri);
    checkpoint.afterHash = hash(await this.readCurrentContent(uri));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(this.checkpointDir, `${id}.json`),
      new TextEncoder().encode(JSON.stringify(checkpoint)),
    );
  }

  async list(): Promise<AgentCheckpointSummary[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.checkpointDir);
      const checkpoints = await Promise.all(
        entries
          .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".json"))
          .map(([name]) => this.read(name.slice(0, -5))),
      );
      return checkpoints
        .filter((item): item is StoredCheckpoint => !!item)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ beforeContent: _beforeContent, afterHash: _afterHash, ...summary }) => summary);
    } catch {
      return [];
    }
  }

  async restore(id: string): Promise<{ restored: boolean; reason?: string }> {
    const checkpoint = await this.read(id);
    if (!checkpoint) return { restored: false, reason: "Checkpoint not found." };
    const uri = this.ensureWorkspaceFile(checkpoint.fileUri);
    const currentContent = await this.readCurrentContent(uri);
    if (checkpoint.afterHash && hash(currentContent) !== checkpoint.afterHash) {
      const choice = await vscode.window.showWarningMessage(
        `${checkpoint.fileName} changed after this checkpoint. Restore anyway?`,
        { modal: true },
        "Restore Anyway",
      );
      if (choice !== "Restore Anyway") {
        return { restored: false, reason: "Restore canceled to protect newer changes." };
      }
    }

    if (checkpoint.beforeContent === null) {
      if (currentContent !== null) await vscode.workspace.fs.delete(uri, { useTrash: true });
    } else {
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        checkpoint.beforeContent,
      );
      if (!(await vscode.workspace.applyEdit(edit))) {
        return { restored: false, reason: "VS Code rejected the restore edit." };
      }
      await document.save();
    }
    return { restored: true };
  }

  private async read(id: string): Promise<StoredCheckpoint | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.checkpointDir, `${id}.json`),
      );
      return JSON.parse(new TextDecoder().decode(bytes)) as StoredCheckpoint;
    } catch {
      return undefined;
    }
  }

  private async prune(): Promise<void> {
    const checkpoints = await this.list();
    await Promise.all(
      checkpoints.slice(MAX_CHECKPOINTS).map((checkpoint) =>
        vscode.workspace.fs.delete(
          vscode.Uri.joinPath(this.checkpointDir, `${checkpoint.id}.json`),
        ),
      ),
    );
  }
}
