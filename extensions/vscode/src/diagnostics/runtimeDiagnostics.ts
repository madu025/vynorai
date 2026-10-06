import * as vscode from "vscode";

const FILE_NAME = "runtime-diagnostics.json";
const MAX_REPORTS = 50;
const MAX_REPORT_BYTES = 16 * 1024;
let writeQueue: Promise<void> = Promise.resolve();

function diagnosticsUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, FILE_NAME);
}

async function readReports(
  context: vscode.ExtensionContext,
): Promise<unknown[]> {
  try {
    const bytes = await vscode.workspace.fs.readFile(diagnosticsUri(context));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(parsed)) return [];
    const seenErrors = new Set<string>();
    return parsed
      .slice()
      .reverse()
      .filter((report) => {
        if (!report || typeof report !== "object") return true;
        const value = report as Record<string, any>;
        if (value.category !== "model-response") return true;
        const identity =
          typeof value.fingerprint === "string"
            ? value.fingerprint
            : JSON.stringify([
                value.category,
                value.error?.name,
                value.error?.message,
                value.model?.title,
                value.session?.id,
              ]);
        if (seenErrors.has(identity)) return false;
        seenErrors.add(identity);
        return true;
      })
      .reverse();
  } catch {
    return [];
  }
}

function sanitize(value: unknown, key = ""): unknown {
  if (
    /prompt|content|api.?key|authorization|password|secret|token/i.test(key)
  ) {
    return "[OMITTED]";
  }
  if (typeof value === "string") {
    return value
      .replace(
        /file\+\.vscode-resource\.vscode-cdn\.net\/[^\s)]+/gi,
        "[LOCAL_RESOURCE]",
      )
      .replace(/[A-Za-z]%3A(?:%5C|\/)[^\s)]+/gi, "[LOCAL_PATH]")
      .replace(
        /(bearer|api[_-]?key|token|password)\s*[:=]\s*[^\s,;]+/gi,
        "$1: [REDACTED]",
      )
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/[A-Za-z]:\\[^\n]+/g, "[LOCAL_PATH]")
      .replace(/\/(?:Users|home)\/[^\s)]+/g, "[LOCAL_PATH]")
      .slice(0, 2400);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey),
      ]),
    );
  }
  return value;
}

async function writeRuntimeDiagnostic(
  context: vscode.ExtensionContext,
  reportJson: string,
): Promise<void> {
  if (new TextEncoder().encode(reportJson).byteLength > MAX_REPORT_BYTES)
    return;
  try {
    const parsed = sanitize(JSON.parse(reportJson));
    const reports = await readReports(context);
    const fingerprint =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).fingerprint
        : undefined;
    if (
      typeof fingerprint === "string" &&
      reports.some(
        (report) =>
          report &&
          typeof report === "object" &&
          (report as Record<string, unknown>).fingerprint === fingerprint,
      )
    ) {
      return;
    }
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(
      diagnosticsUri(context),
      new TextEncoder().encode(
        JSON.stringify([...reports, parsed].slice(-MAX_REPORTS), null, 2),
      ),
    );
  } catch {
    // Diagnostics are best-effort and must never interrupt the agent.
  }
}

export function recordRuntimeDiagnostic(
  context: vscode.ExtensionContext,
  reportJson: string,
): Promise<void> {
  // Lifecycle start/finish and an error can arrive together. Serialize the
  // read-modify-write operation so one report cannot overwrite another.
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => writeRuntimeDiagnostic(context, reportJson));
  return writeQueue;
}

export async function copyRuntimeDiagnostics(
  context: vscode.ExtensionContext,
): Promise<void> {
  const reports = await readReports(context);
  const extension = vscode.extensions.getExtension("VynorAI.vynorai");
  const bundle = {
    generatedAt: new Date().toISOString(),
    extensionVersion: extension?.packageJSON?.version ?? "unknown",
    ide: { name: vscode.env.appName, version: vscode.version },
    reportCount: reports.length,
    reports,
    privacy:
      "Prompts, file contents, credentials, and absolute local paths are omitted.",
  };
  await vscode.env.clipboard.writeText(JSON.stringify(bundle, null, 2));
  void vscode.window.showInformationMessage(
    reports.length
      ? `Copied ${reports.length} VynorAI diagnostic report(s).`
      : "No VynorAI runtime errors have been recorded yet.",
  );
}
