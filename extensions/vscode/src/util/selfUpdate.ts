/**
 * Updates without a marketplace. Every 6 hours (and shortly after start) the
 * extension asks vynor.lk for the latest release; if it is newer, the user is
 * offered the update. The .vsix is downloaded over HTTPS, checked against the
 * published SHA-256, and installed with the editor's own VSIX installer.
 *
 * Works in VS Code and its forks (Antigravity, Cursor, Windsurf, Qoder).
 * Disable with the setting "vynorai.autoUpdateCheck".
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const LATEST_URL = "https://vynor.lk/api/extension/latest";
const CHECK_EVERY_MS = 6 * 3600_000;
const SKIPPED_KEY = "vynorai.skippedVersion";

interface Release {
  version: string;
  url: string;
  sha256: string;
  notes?: string;
}

/** True when `a` is a newer x.y.z than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

async function fetchLatest(): Promise<Release | null> {
  try {
    const res = await fetch(LATEST_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Release;
    if (
      typeof data.version !== "string" ||
      !/^https:\/\/vynor\.lk\/download\/vynorai-\d+\.\d+\.\d+\.vsix$/.test(
        data.url,
      ) ||
      !/^[a-f0-9]{64}$/.test(data.sha256)
    )
      return null;
    return data;
  } catch {
    return null;
  }
}

async function downloadVerified(
  release: Release,
  dir: string,
): Promise<string> {
  const res = await fetch(release.url, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.sha256)
    throw new Error(
      "Downloaded file failed the integrity check; not installed.",
    );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vynorai-${release.version}.vsix`);
  fs.writeFileSync(file, bytes);
  return file;
}

async function installRelease(
  context: vscode.ExtensionContext,
  release: Release,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Updating VynorAI to ${release.version}…`,
    },
    async () => {
      const file = await downloadVerified(
        release,
        path.join(context.globalStorageUri.fsPath, "updates"),
      );
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        vscode.Uri.file(file),
      );
    },
  );
  const reload = await vscode.window.showInformationMessage(
    `VynorAI ${release.version} is installed. Reload to start using it.`,
    "Reload Now",
  );
  if (reload === "Reload Now")
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

async function checkForUpdate(
  context: vscode.ExtensionContext,
  manual: boolean,
): Promise<void> {
  const current = String(context.extension.packageJSON.version ?? "0.0.0");
  const latest = await fetchLatest();
  if (!latest) {
    // Unreachable server: don't claim the installed version is the latest.
    if (manual)
      void vscode.window.showWarningMessage(
        "Couldn't reach vynor.lk to check for updates. Try again later.",
      );
    return;
  }
  if (!isNewer(latest.version, current)) {
    if (manual)
      void vscode.window.showInformationMessage(
        `VynorAI ${current} is the latest version.`,
      );
    return;
  }
  if (!manual && context.globalState.get(SKIPPED_KEY) === latest.version)
    return;

  const notes = latest.notes ? ` ${latest.notes}` : "";
  const choice = await vscode.window.showInformationMessage(
    `VynorAI ${latest.version} is available (you have ${current}).${notes}`,
    "Update",
    "Later",
    "Skip This Version",
  );
  if (choice === "Skip This Version")
    await context.globalState.update(SKIPPED_KEY, latest.version);
  if (choice !== "Update") return;
  try {
    await installRelease(context, latest);
  } catch (e: any) {
    const open = await vscode.window.showErrorMessage(
      `VynorAI update failed: ${e?.message ?? e}`,
      "Download Manually",
    );
    if (open)
      void vscode.env.openExternal(
        vscode.Uri.parse("https://vynor.lk/download"),
      );
  }
}

export function setupSelfUpdate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("vynorai.checkForUpdates", () =>
      checkForUpdate(context, true),
    ),
  );
  const enabled = () =>
    vscode.workspace
      .getConfiguration("vynorai")
      .get<boolean>("autoUpdateCheck", true);
  const run = () => {
    if (enabled()) void checkForUpdate(context, false);
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, CHECK_EVERY_MS);
  context.subscriptions.push({
    dispose: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  });
}
