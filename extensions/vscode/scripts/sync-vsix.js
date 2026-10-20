const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const extensionRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
);
const buildDir = path.join(extensionRoot, "build");
// CI stamps the build with the commit ("1.2.69-abc1234") and packages it for one
// platform, so vsce names it "vynorai-linux-x64-1.2.69-abc1234.vsix". The exact
// "vynorai-<version>.vsix" wins; otherwise exactly one such variant is accepted.
const escapedVersion = packageJson.version.replace(/\./g, "\\.");
const variantPattern = new RegExp(
  `^vynorai-(?:([a-z0-9]+-[a-z0-9]+)-)?(${escapedVersion}(?:-[0-9a-f]{7})?)\\.vsix$`,
);
const variants = (
  fs.existsSync(buildDir) ? fs.readdirSync(buildDir) : []
).filter((file) => variantPattern.test(file));
const artifactName =
  fs.existsSync(path.join(buildDir, `vynorai-${packageJson.version}.vsix`)) ||
  variants.length !== 1
    ? `vynorai-${packageJson.version}.vsix`
    : variants[0];
const version = variantPattern.exec(artifactName)[2];
const installName = `vynorai.vynorai-${version}`;
// A platform build may be installed as "<id>-<version>" or "<id>-<version>-<platform>",
// depending on the VS Code version; these are this version's folders in a directory.
function installedDirs(extensionsDir) {
  if (!fs.existsSync(extensionsDir)) return [];
  return fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.toLowerCase() === installName.toLowerCase() ||
          (entry.name
            .toLowerCase()
            .startsWith(`${installName}-`.toLowerCase()) &&
            /^[a-z0-9]+-[a-z0-9]+$/i.test(
              entry.name.slice(installName.length + 1),
            ))),
    )
    .map((entry) => path.join(extensionsDir, entry.name));
}
function installedDir(extensionsDir) {
  return (
    installedDirs(extensionsDir).find((dir) =>
      fs.existsSync(path.join(dir, "package.json")),
    ) || path.join(extensionsDir, installName)
  );
}
const artifactPath = path.join(buildDir, artifactName);
const stagedDir = path.join(extensionRoot, "e2e", "vsix");
const stagedPath = path.join(stagedDir, artifactName);
const args = new Set(process.argv.slice(2));

function fail(message) {
  console.error(`VSIX sync failed: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function run(command, commandArgs, options = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let executable = command;
  let executableArgs = commandArgs;
  let windowsVerbatimArguments = false;
  if (process.platform === "win32" && command.endsWith(".cmd")) {
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    executable = process.env.ComSpec || "cmd.exe";
    executableArgs = [
      "/d",
      "/s",
      "/c",
      `call ${[command, ...commandArgs].map(quote).join(" ")}`,
    ];
    windowsVerbatimArguments = true;
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: extensionRoot,
    env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
    windowsVerbatimArguments,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    if (options.capture && result.stderr) console.error(result.stderr.trim());
    fail(`${command} exited with status ${result.status}`);
  }
  return result.stdout || "";
}

function assertSafeExtensionsDir(dir) {
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  const home = path.resolve(os.homedir());
  if (resolved === root || resolved === home || resolved === extensionRoot) {
    fail(`refusing unsafe extensions directory: ${resolved}`);
  }
  return resolved;
}

if (!fs.existsSync(artifactPath)) {
  fail(`canonical artifact is missing: ${artifactPath}`);
}

const artifactHash = sha256(artifactPath);
const identity = {
  extension: "VynorAI.vynorai",
  version,
  file: artifactName,
  sha256: artifactHash,
};

function stageArtifact() {
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.copyFileSync(artifactPath, stagedPath);
  fs.writeFileSync(
    path.join(stagedDir, "canonical-vsix.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  if (sha256(stagedPath) !== artifactHash)
    fail("staged artifact checksum mismatch");
}

function installE2e() {
  stageArtifact();
  const extensionsDir = assertSafeExtensionsDir(
    process.env.VYNOR_E2E_EXTENSIONS_DIR ||
      path.join(extensionRoot, "e2e", ".test-extensions"),
  );
  const storage = path.resolve(
    process.env.VYNOR_E2E_STORAGE || path.join(extensionRoot, "e2e", "storage"),
  );
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.mkdirSync(storage, { recursive: true });

  const extest = path.join(
    extensionRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "extest.cmd" : "extest",
  );
  if (!fs.existsSync(extest)) fail(`extest is missing: ${extest}`);
  // extest does not replace a folder of the same version: it reports success
  // and leaves the old files. A day of benchmark runs tested a build from
  // hours earlier that way, while the marker below named the new VSIX. Remove
  // the folder first, so what is there afterwards can only be this VSIX.
  for (const sameVersionDir of installedDirs(extensionsDir)) {
    fs.rmSync(sameVersionDir, { recursive: true, force: true });
    if (fs.existsSync(sameVersionDir)) {
      fail(
        `could not remove ${sameVersionDir}; close the E2E VS Code and try again`,
      );
    }
  }
  // VS Code also keeps a registry of what is installed. With the version
  // still listed there it extracts nothing and reports success.
  const registry = path.join(extensionsDir, "extensions.json");
  if (fs.existsSync(registry)) {
    const entries = JSON.parse(fs.readFileSync(registry, "utf8"));
    fs.writeFileSync(
      registry,
      JSON.stringify(
        entries.filter(
          (entry) =>
            String(entry?.identifier?.id).toLowerCase() !== "vynorai.vynorai",
        ),
      ),
    );
  }
  // extest passes the folders to VS Code unquoted. With a space in the path
  // ("D:\My Project\...") the install went to "D:\My" and reported success.
  // The E2E VS Code's own CLI, called through run(), gets quoted arguments.
  const codeCli = path.join(
    storage,
    process.platform === "win32" ? "VSCode-win32-x64-archive" : "",
    "bin",
    process.platform === "win32" ? "code.cmd" : "code",
  );
  if (fs.existsSync(codeCli)) {
    run(codeCli, [
      "--install-extension",
      artifactPath,
      "--force",
      "--extensions-dir",
      extensionsDir,
      "--user-data-dir",
      path.join(storage, "settings-cli"),
    ]);
  } else {
    run(extest, [
      "install-vsix",
      "-f",
      artifactPath,
      "--extensions_dir",
      extensionsDir,
      "--storage",
      storage,
    ]);
  }

  const expectedDir = installedDir(extensionsDir);
  let installedPackage = path.join(expectedDir, "package.json");
  if (!fs.existsSync(installedPackage)) {
    const defaultInstall = installedDir(
      path.join(os.homedir(), ".vscode", "extensions"),
    );
    if (fs.existsSync(path.join(defaultInstall, "package.json"))) {
      fs.cpSync(defaultInstall, expectedDir, { recursive: true });
    }
  }
  if (!fs.existsSync(installedPackage)) {
    const found = fs.existsSync(extensionsDir)
      ? fs.readdirSync(extensionsDir).filter((name) => /vynorai/i.test(name))
      : [];
    fail(
      `extest did not install ${version} at ${expectedDir} (found: ${found.join(", ") || "none"})`,
    );
  }
  const installedVersion = JSON.parse(
    fs.readFileSync(installedPackage, "utf8"),
  ).version;
  if (installedVersion !== version) {
    fail(`E2E installed ${installedVersion}; expected ${version}`);
  }

  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^vynorai\.vynorai-\d+\.\d+\.\d+$/.test(entry.name) &&
      entry.name !== installName
    ) {
      fs.rmSync(path.join(extensionsDir, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
  // run-e2e.js reads the file name and folder from here instead of guessing them.
  fs.writeFileSync(
    path.join(extensionsDir, ".vynor-canonical-vsix.json"),
    `${JSON.stringify({ ...identity, folder: path.basename(expectedDir) }, null, 2)}\n`,
  );
}

function defaultEditorCli() {
  if (process.env.VYNOR_EDITOR_CLI) return process.env.VYNOR_EDITOR_CLI;
  if (process.platform !== "win32") return "code";
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Antigravity IDE",
      "bin",
      "antigravity-ide.cmd",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Antigravity",
      "bin",
      "antigravity.cmd",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Microsoft VS Code Insiders",
      "bin",
      "code-insiders.cmd",
    ),
    path.join(
      process.env.ProgramFiles || "",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
    path.join(process.env.ProgramFiles || "", "Qoder IDE", "bin", "qoder.cmd"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "code.cmd";
}

function localExtensionRoots() {
  const candidates = [
    ".vscode/extensions",
    ".vscode-insiders/extensions",
    ".qoder/extensions",
    ".cursor/extensions",
    ".windsurf/extensions",
    ".antigravity/extensions",
    ".antigravity-ide/extensions",
  ].map((relative) => path.join(os.homedir(), relative));
  return candidates.filter((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    return fs
      .readdirSync(candidate, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          /^vynorai\.vynorai-\d+\.\d+\.\d+$/.test(entry.name),
      );
  });
}

function cleanOldVynorVersions(extensionsDir) {
  const safeDir = assertSafeExtensionsDir(extensionsDir);
  for (const entry of fs.readdirSync(safeDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^vynorai\.vynorai-\d+\.\d+\.\d+$/.test(entry.name) &&
      entry.name !== installName
    ) {
      try {
        fs.rmSync(path.join(safeDir, entry.name), {
          recursive: true,
          force: true,
        });
      } catch (err) {
        console.warn(
          `Could not remove old version ${entry.name}: ${err.message}`,
        );
      }
    }
  }
}

function installLocal() {
  const editorCli = defaultEditorCli();
  const roots = localExtensionRoots();
  if (roots.length === 0) {
    run(editorCli, ["--install-extension", artifactPath, "--force"]);
  } else {
    for (const extensionsDir of roots) {
      run(editorCli, [
        "--install-extension",
        artifactPath,
        "--force",
        "--extensions-dir",
        extensionsDir,
      ]);
      const installedPackage = path.join(
        installedDir(extensionsDir),
        "package.json",
      );
      if (!fs.existsSync(installedPackage)) {
        fail(`editor did not install ${version} in ${extensionsDir}`);
      }
      cleanOldVynorVersions(extensionsDir);
    }
  }
  const installed = run(editorCli, ["--list-extensions", "--show-versions"], {
    capture: true,
  });
  const expected = `vynorai.vynorai@${version}`.toLowerCase();
  if (!installed.toLowerCase().split(/\r?\n/).includes(expected)) {
    fail(`editor CLI did not activate ${expected}`);
  }
}

if (args.size === 0) {
  fail("use --stage, --e2e, --local, or --all");
}
if (args.has("--stage")) stageArtifact();
if (args.has("--e2e") || args.has("--all")) installE2e();
if (args.has("--local") || args.has("--all")) installLocal();

console.log(`Canonical VynorAI ${version} synchronized (${artifactHash}).`);
