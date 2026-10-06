const { spawnSync } = require("child_process");

// Codex and some Electron-based tools set this for their own child processes.
// If it reaches the VS Code binary, Electron starts as Node instead of the
// editor, so ChromeDriver only reports a misleading DevToolsActivePort error.
const env = { ...process.env, NODE_ENV: "e2e" };
delete env.ELECTRON_RUN_AS_NODE;

const testFile = process.env.TEST_FILE || "./e2e/_output/tests/*.test.js";
const extensionsDir =
  process.env.VYNOR_E2E_EXTENSIONS_DIR || "./e2e/.test-extensions";
const storage = process.env.VYNOR_E2E_STORAGE || "./e2e/storage";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

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
