import crypto from "node:crypto";
import * as vscode from "vscode";
import { SecretStorage } from "../stubs/SecretStorage";
import {
  classifyBackgroundPatchPath,
  classifyBackgroundUploadPath,
} from "core/agent/backgroundUploadPolicy";

const API_BASE = process.env.VYNORAI_API_BASE || "https://vynor.lk/v1";
const SECRET_NAME = "VYNORAI_API_KEY";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface UploadFile {
  relative: string;
  bytes: Uint8Array;
  digest: string;
}

export class BackgroundAgentManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async create(prompt: string): Promise<any> {
    if (!vscode.workspace.isTrusted)
      throw new Error(
        "Trust this workspace before uploading a background task.",
      );
    const root = this.singleWorkspace();
    const files = await this.collectFiles(root);
    const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
    const confirmation = await vscode.window.showWarningMessage(
      `Upload ${files.length.toLocaleString()} filtered files (${formatBytes(totalBytes)}) to VynorAI for an isolated background task? Secret files, dependencies, builds, and Git data are excluded.`,
      {
        modal: true,
        detail:
          "The encrypted upload and result artifacts are retained for up to 7 days. No local credentials or environment files are included.",
      },
      "Upload and run",
    );
    if (confirmation !== "Upload and run")
      throw new Error("BACKGROUND_CREATE_CANCELED");
    const manifest = files.map((file) => ({
      path: file.relative,
      bytes: file.bytes.length,
      sha256: file.digest,
    }));
    const manifestJson = canonical(manifest);
    const manifestDigest = sha256(manifestJson);
    const projectFingerprint = sha256(`${root.name}\n${manifestJson}`);
    const zip = createZip(files);
    const language = /[\u0D80-\u0DFF]/.test(prompt) ? "si" : "en";
    const stacks = detectStacks(new Set(files.map((file) => file.relative)));
    const input = {
      prompt,
      language,
      projectFingerprint,
      manifestDigest,
      fileCount: files.length,
      uploadBytes: zip.length,
      stacks,
    };
    const estimate = await this.request("/background/tasks/estimate", {
      method: "POST",
      json: input,
    });
    if (!estimate.entitlement?.enabled)
      throw new Error("Background agents require a Pro or Ultra plan.");
    const quote = estimate.quote;
    const capCredits = quote.suggestedCapCredits;
    const task = await this.request("/background/tasks", {
      method: "POST",
      json: {
        input,
        quoteId: quote.quoteId,
        quoteSignature: estimate.signature,
        capCredits,
        idempotencyKey: crypto.randomUUID(),
        consentAccepted: true,
        policyVersion: estimate.policyVersion,
      },
    });
    await this.request(task.uploadUrl.replace(/^\/v1/, ""), {
      method: "PUT",
      body: zip,
      contentType: "application/zip",
    });
    void vscode.window.showInformationMessage(
      "VynorAI background task queued.",
    );
    return task;
  }

  async availability(): Promise<{ available: boolean; reason?: any }> {
    try {
      const result = await this.request("/background/availability", {
        method: "GET",
      });
      return { available: result?.available === true, reason: result?.reason };
    } catch {
      return { available: false, reason: "unavailable" };
    }
  }
  async list(): Promise<any> {
    return this.request("/background/tasks?limit=50", { method: "GET" });
  }
  async detail(taskId: string): Promise<any> {
    return this.request(`/background/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
    });
  }
  async cancel(taskId: string): Promise<any> {
    return this.request(
      `/background/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST", json: {} },
    );
  }

  watch(taskId: string, onReview: () => Promise<unknown>): void {
    const started = Date.now();
    const timer = setInterval(() => {
      void this.detail(taskId)
        .then(async (detail) => {
          const status = detail?.task?.status;
          if (!["completed", "failed", "canceled", "purged"].includes(status))
            return;
          clearInterval(timer);
          const checks = detail?.task?.proof?.verification || [];
          const passed = checks.filter(
            (item: any) => item.classification === "passed",
          ).length;
          const highestRisk = detail?.task?.proof?.risks?.find(
            (item: any) => item.severity === "high",
          )?.summary;
          const action = await vscode.window.showInformationMessage(
            `VynorAI background task ${status}. ${passed}/${checks.length} checks passed${highestRisk ? `; risk: ${highestRisk}` : ""}.`,
            ...(status === "completed" ? ["Review Changes"] : []),
          );
          if (action === "Review Changes") await onReview();
        })
        .catch(() => {
          if (Date.now() - started > 48 * 60 * 60_000) clearInterval(timer);
        });
    }, 15_000);
  }

  async downloadValidatedPatch(taskId: string): Promise<any> {
    const bundle = await this.request(
      `/background/tasks/${encodeURIComponent(taskId)}/patch`,
      { method: "GET", raw: true },
    );
    const parsed = JSON.parse(Buffer.from(bundle).toString("utf8"));
    if (
      parsed.version !== 1 ||
      parsed.taskId !== taskId ||
      !Array.isArray(parsed.files)
    )
      throw new Error("Invalid background patch bundle.");
    const signature = parsed.signature;
    if (
      signature?.algorithm !== "Ed25519" ||
      typeof signature.digest !== "string" ||
      typeof signature.value !== "string"
    )
      throw new Error("Background patch is not signed.");
    const unsigned = { ...parsed };
    delete unsigned.signature;
    const digest = crypto
      .createHash("sha256")
      .update(JSON.stringify(unsigned))
      .digest();
    if (digest.toString("hex") !== signature.digest)
      throw new Error("Background patch digest mismatch.");
    const key = await this.request("/background/patch-public-key", {
      method: "GET",
    });
    if (key.keyId !== signature.keyId || key.algorithm !== "Ed25519")
      throw new Error("Unknown background patch signing key.");
    const publicKey = Buffer.from(String(key.publicKey), "base64").toString(
      "utf8",
    );
    if (
      !crypto.verify(
        null,
        digest,
        publicKey,
        Buffer.from(signature.value, "base64"),
      )
    )
      throw new Error("Background patch signature verification failed.");
    const root = this.singleWorkspace().uri;
    for (const file of parsed.files) {
      if (!["create", "modify", "delete"].includes(file.operation))
        throw new Error("Unknown operation in background patch.");
      // The sandboxed agent can be steered by repository content, so a
      // signed patch is still untrusted: refuse paths that escape the
      // workspace or would run code / touch credentials on this machine.
      const decision = classifyBackgroundPatchPath(file.path);
      if (decision !== "ok")
        throw new Error(
          decision === "unsafe"
            ? `Unsafe path in background patch: ${JSON.stringify(file.path)}`
            : `Background patch tried to change a ${decision} file (${file.path}); nothing was applied.`,
        );
      const uri = vscode.Uri.joinPath(root, ...file.path.split("/"));
      let current = Buffer.alloc(0);
      try {
        current = Buffer.from(await vscode.workspace.fs.readFile(uri));
      } catch {}
      if (sha256(current) !== file.baseSha256) file.conflicted = true;
      if (
        file.operation !== "delete" &&
        sha256(Buffer.from(String(file.content), "utf8")) !== file.resultSha256
      )
        throw new Error(`Patch digest mismatch: ${file.path}`);
    }
    return parsed;
  }

  private singleWorkspace(): vscode.WorkspaceFolder {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length !== 1)
      throw new Error(
        "Background tasks currently require exactly one workspace folder.",
      );
    return folders[0];
  }

  private async collectFiles(
    root: vscode.WorkspaceFolder,
  ): Promise<UploadFile[]> {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, "**/*"),
      "{**/.git/**,**/node_modules/**,**/vendor/**,**/dist/**,**/build/**,**/coverage/**,**/.next/**,**/.venv/**}",
      20_001,
    );
    if (uris.length > 20_000)
      throw new Error("Project has more than 20,000 uploadable files.");
    const files: UploadFile[] = [];
    let total = 0;
    for (const uri of uris) {
      const relative = vscode.workspace
        .asRelativePath(uri, false)
        .replace(/\\/g, "/");
      if (classifyBackgroundUploadPath(relative) !== "include") continue;
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > MAX_FILE_BYTES)
        continue;
      const bytes = await vscode.workspace.fs.readFile(uri);
      total += bytes.length;
      if (total > MAX_UPLOAD_BYTES)
        throw new Error("Filtered project exceeds the 100 MB upload limit.");
      files.push({ relative, bytes, digest: sha256(bytes) });
    }
    if (!files.length)
      throw new Error("No safe project files were found to upload.");
    return files.sort((a, b) => a.relative.localeCompare(b.relative));
  }

  private async request(
    pathname: string,
    options: {
      method: string;
      json?: unknown;
      body?: Uint8Array;
      contentType?: string;
      raw?: boolean;
    },
  ): Promise<any> {
    const apiKey = await new SecretStorage(this.context).get(SECRET_NAME);
    if (!apiKey)
      throw new Error("Sign in to VynorAI before using background agents.");
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": options.contentType || "application/json",
        "x-vynor-client": "vscode-background",
      },
      body: options.body
        ? Buffer.from(options.body)
        : options.json === undefined
          ? undefined
          : JSON.stringify(options.json),
    });
    if (!response.ok) {
      const payload: any = await response.json().catch(() => ({}));
      throw new Error(
        payload?.error?.message ||
          payload?.error ||
          `Background API ${response.status}`,
      );
    }
    return options.raw
      ? new Uint8Array(await response.arrayBuffer())
      : response.json();
  }
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function detectStacks(files: Set<string>): string[] {
  const stacks: string[] = [];
  if ([...files].some((file) => /(^|\/)package\.json$/.test(file)))
    stacks.push("node");
  if ([...files].some((file) => /(^|\/)composer\.json$/.test(file)))
    stacks.push("php");
  if (
    [...files].some((file) =>
      /(^|\/)(pyproject\.toml|requirements\.txt)$/.test(file),
    )
  )
    stacks.push("python");
  return stacks;
}
function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createZip(files: UploadFile[]): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.relative, "utf8");
    const data = Buffer.from(file.bytes);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
