const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const extensionRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
);
const version = packageJson.version;
const artifactName = `vynorai-${version}.vsix`;
const artifactPath = path.join(extensionRoot, "build", artifactName);
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
  run(extest, [
    "install-vsix",
    "-f",
    artifactPath,
    "--extensions_dir",
    extensionsDir,
    "--storage",
    storage,
  ]);

  const expectedDir = path.join(extensionsDir, `vynorai.vynorai-${version}`);
  let installedPackage = path.join(expectedDir, "package.json");
  if (!fs.existsSync(installedPackage)) {
    const defaultInstall = path.join(
      os.homedir(),
      ".vscode",
      "extensions",
      `vynorai.vynorai-${version}`,
    );
    if (fs.existsSync(path.join(defaultInstall, "package.json"))) {
      fs.cpSync(defaultInstall, expectedDir, { recursive: true });
    }
  }
  if (!fs.existsSync(installedPackage)) {
    fail(`extest did not install ${version} at ${expectedDir}`);
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
      entry.name !== `vynorai.vynorai-${version}`
    ) {
      fs.rmSync(path.join(extensionsDir, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
  fs.writeFileSync(
    path.join(extensionsDir, ".vynor-canonical-vsix.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
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
      entry.name !== `vynorai.vynorai-${version}`
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
        extensionsDir,
        `vynorai.vynorai-${version}`,
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
