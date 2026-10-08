const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Codex and some Electron-based tools set this for their own child processes.
// If it reaches the VS Code binary, Electron starts as Node instead of the
// editor, so ChromeDriver only reports a misleading DevToolsActivePort error.
const env = { ...process.env, NODE_ENV: "e2e" };
delete env.ELECTRON_RUN_AS_NODE;
// The extension resolves a relative CONTINUE_GLOBAL_DIR against VS Code's own
// working directory, where the parent folder does not exist, so activation
// fails and no command is ever registered. Hand it an absolute path.
for (const name of ["CONTINUE_GLOBAL_DIR", "VYNORAI_GLOBAL_DIR"]) {
  if (env[name]) env[name] = path.resolve(env[name]);
}

const testFile = process.env.TEST_FILE || "./e2e/_output/tests/*.test.js";
const extensionsDir =
  process.env.VYNOR_E2E_EXTENSIONS_DIR || "./e2e/.test-extensions";
const storage = process.env.VYNOR_E2E_STORAGE || "./e2e/storage";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function assertCanonicalE2eInstall() {
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
  const version = packageJson.version;
  const artifact = path.resolve(`./build/vynorai-${version}.vsix`);
  const installedRoot = path.resolve(extensionsDir);
  const installedPackage = path.join(
    installedRoot,
    `vynorai.vynorai-${version}`,
    "package.json",
  );
  const markerFile = path.join(installedRoot, ".vynor-canonical-vsix.json");

  if (!fs.existsSync(artifact)) {
    throw new Error(`Canonical VSIX is missing: ${artifact}`);
  }
  if (!fs.existsSync(installedPackage) || !fs.existsSync(markerFile)) {
    throw new Error(
      `E2E does not have canonical VynorAI ${version}. Run npm run e2e:install-vsix.`,
    );
  }
  const installedVersion = JSON.parse(
    fs.readFileSync(installedPackage, "utf8"),
  ).version;
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  const artifactHash = sha256(artifact);
  if (
    installedVersion !== version ||
    marker.version !== version ||
    marker.sha256 !== artifactHash
  ) {
    throw new Error(
      `E2E VSIX drift detected (source=${version}, installed=${installedVersion}, expected sha256=${artifactHash}, installed sha256=${marker.sha256}). Run npm run e2e:install-vsix.`,
    );
  }
}

assertCanonicalE2eInstall();

const result = spawnSync(
  npx,
  [
    "extest",
    "run-tests",
    testFile,
    "--code_settings",
    "settings.json",
    "--extensions_dir",
    extensionsDir,
    "--storage",
    storage,
  ],
  {
    env,
    stdio: "inherit",
    // Windows command shims such as npx.cmd require cmd.exe to launch.
    shell: process.platform === "win32",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
