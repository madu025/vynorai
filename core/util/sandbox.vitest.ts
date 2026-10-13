import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSandboxedCommand,
  guardPowerShellPipelines,
  sanitizeSandboxEnvironment,
} from "./sandbox";

const originalStrict = process.env.VYNOR_REQUIRE_STRICT_SANDBOX;

afterEach(() => {
  if (originalStrict === undefined)
    delete process.env.VYNOR_REQUIRE_STRICT_SANDBOX;
  else process.env.VYNOR_REQUIRE_STRICT_SANDBOX = originalStrict;
});

describe("sandbox boundary", () => {
  it("removes credential-bearing environment variables", () => {
    const result = sanitizeSandboxEnvironment({
      PATH: "safe",
      OPENAI_API_KEY: "secret",
      SESSION_TOKEN: "secret",
      DATABASE_PASSWORD: "secret",
    });
    expect(result).toEqual({ PATH: "safe" });
  });

  it("rejects a working directory outside the workspace allowlist", () => {
    expect(() =>
      buildSandboxedCommand({
        cwd: process.platform === "win32" ? "C:\\outside" : "/outside",
        command: "echo safe",
        allowedWorkspaceDirs: [
          process.platform === "win32" ? "C:\\workspace" : "/workspace",
        ],
      }),
    ).toThrow("outside the allowed workspace");
  });

  it("fails closed when strict isolation is required but unavailable", () => {
    if (process.platform === "linux" || process.platform === "darwin") return;
    process.env.VYNOR_REQUIRE_STRICT_SANDBOX = "true";
    expect(() =>
      buildSandboxedCommand({
        cwd: process.cwd(),
        command: "echo safe",
        allowedWorkspaceDirs: [process.cwd()],
      }),
    ).toThrow("Strict OS isolation is unavailable");
  });

  it("guards every unquoted PowerShell pipeline stage", () => {
    const guarded = guardPowerShellPipelines(
      "npm test 2>&1 | tail -n 60 | Select-Object -Last 20",
    );
    expect(guarded.match(/& \{ (?:npm|tail|Select-Object)/g)).toHaveLength(3);
    expect(guardPowerShellPipelines('Write-Output "a | b"')).toBe(
      'Write-Output "a | b"',
    );
  });

  it("propagates a failed command from inside a pipeline", () => {
    const command =
      process.platform === "win32"
        ? "cmd /c exit 7 | cmd /c exit 0"
        : "bash -c 'exit 7' | tail -n 1";
    const sandboxed = buildSandboxedCommand({
      cwd: process.cwd(),
      command,
      allowedWorkspaceDirs: [process.cwd()],
    });
    const result = spawnSync(sandboxed.shell, sandboxed.args, {
      cwd: process.cwd(),
      env: sandboxed.env,
    });
    expect(result.status).not.toBe(0);
  });
});
