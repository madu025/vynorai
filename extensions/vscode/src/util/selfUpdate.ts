/**
 * Updates without a marketplace. Shortly after start, every 15 minutes, and
 * when the window regains focus, the extension asks vynor.lk for the latest
 * release; if it is newer it is installed (or offered, when
 * "vynorai.autoUpdate" is off). The .vsix is downloaded over HTTPS, checked
 * against the published SHA-256, and installed with the editor's own VSIX
 * installer.
 *
 * Every editor on the machine (VS Code, Antigravity, Cursor, Windsurf, Qoder)
 * runs its own copy of this code. They share one verified download in
 * ~/.vynorai/updates, so the first editor to notice a release downloads it and
 * the rest install from that file: all editors converge on the same version
 * within one check interval instead of drifting apart.
 * Disable with the setting "vynorai.autoUpdateCheck".
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const LATEST_URL = "https://vynor.lk/api/extension/latest";
const CHECK_EVERY_MS = 15 * 60_000;
const FOCUS_CHECK_MIN_GAP_MS = 10 * 60_000;
const SKIPPED_KEY = "vynorai.skippedVersion";

interface Release {
  version: string;
  url: string;
  sha256: string;
  notes?: string;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function isValidRelease(data: unknown): data is Release {
  if (!data || typeof data !== "object") return false;
  const release = data as Partial<Release>;
  if (
    typeof release.version !== "string" ||
    !VERSION_PATTERN.test(release.version) ||
    typeof release.url !== "string" ||
    typeof release.sha256 !== "string"
  ) {
    return false;
  }

  const expectedUrl = `https://vynor.lk/download/vynorai-${release.version}.vsix`;
  return (
    release.url === expectedUrl &&
    /^[a-f0-9]{64}$/.test(release.sha256) &&
    (release.notes === undefined || typeof release.notes === "string")
  );
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
    const data: unknown = await res.json();
    return isValidRelease(data) ? data : null;
  } catch {
    return null;
  }
}

/** One download directory shared by every editor on this machine. */
export function sharedUpdatesDir(): string {
  const root =
    process.env.VYNORAI_GLOBAL_DIR ||
    process.env.CONTINUE_GLOBAL_DIR ||
    path.join(os.homedir(), ".vynorai");
  return path.join(root, "updates");
}

function sha256File(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/**
 * A VSIX another editor already downloaded, if it matches the published
 * checksum. The server's SHA-256 stays the only authority: a stale or
 * tampered file in the shared folder is ignored, never installed.
 */
export function findCachedVsix(dir: string, release: Release): string | null {
  const file = path.join(dir, `vynorai-${release.version}.vsix`);
  try {
    if (fs.existsSync(file) && sha256File(file) === release.sha256) return file;
  } catch {
    // unreadable cache entry: download again
  }
  return null;
}

async function downloadVerified(
  release: Release,
  dir: string,
): Promise<string> {
  const cached = findCachedVsix(dir, release);
  if (cached) return cached;
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
  // Write then rename: another editor may be reading or writing the same file.
  const tmp = `${file}.${process.pid}.part`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  pruneOldVsix(dir, release.version);
  return file;
}

/** Keep the shared folder small: only the current VSIX is needed. */
function pruneOldVsix(dir: string, keepVersion: string): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (
        /^vynorai-\d+\.\d+\.\d+\.vsix$/.test(name) &&
        name !== `vynorai-${keepVersion}.vsix`
      )
        fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    // best effort
  }
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
      const file = await downloadVerified(release, sharedUpdatesDir());
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

/** Guards against two overlapping checks installing at once in this editor. */
let installing = false;

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
  const auto =
    !manual &&
    vscode.workspace
      .getConfiguration("vynorai")
      .get<boolean>("autoUpdate", true);
  if (
    !auto &&
    !manual &&
    context.globalState.get(SKIPPED_KEY) === latest.version
  )
    return;

  if (!auto) {
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
  }
  if (installing) return;
  installing = true;
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
  } finally {
    installing = false;
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
  const first = setTimeout(run, 15_000);
  const timer = setInterval(run, CHECK_EVERY_MS);
  // Editors left running in the background still catch up when brought to front.
  let lastFocusCheck = 0;
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (
        !state.focused ||
        Date.now() - lastFocusCheck < FOCUS_CHECK_MIN_GAP_MS
      )
        return;
      lastFocusCheck = Date.now();
      run();
    }),
  );
  context.subscriptions.push({
    dispose: () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  });
}
