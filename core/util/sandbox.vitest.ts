import { afterEach, describe, expect, it } from "vitest";
import { buildSandboxedCommand, sanitizeSandboxEnvironment } from "./sandbox";

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
});
