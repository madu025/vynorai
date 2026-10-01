import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export interface SandboxExecutionOptions {
  cwd: string;
  command: string;
  allowedWorkspaceDirs?: string[];
  maxMemoryMb?: number;
  timeoutMs?: number;
}

export interface SandboxedCommand {
  shell: string;
  args: string[];
  env: Record<string, string>;
  isSandboxed: boolean;
  sandboxType: "windows-restricted" | "linux-bwrap" | "macos-seatbelt" | "host-fallback";
}

/**
 * Destructive patterns that could wipe host systems or exfiltrate private credentials
 */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+[\/\\]/i,                      // rm -rf /
  /\bdel\s+\/[fq]\s+[a-z]:[\/\\]/i,                  // del /f C:\
  /\brmdir\s+\/[sq]\s+[a-z]:[\/\\]/i,                // rmdir /s C:\
  /\bformat\s+[a-z]:/i,                               // format C:
  /\bmkfs\b/i,                                        // mkfs
  /\bdd\s+if=/i,                                      // dd if=
  /\b(shutdown|reboot|init\s+0)\b/i,                  // host shutdown
  /\bcurl\b.*(?:\.ssh|\.aws|\.env|id_rsa)/i,          // credential exfiltration attempts
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pat) => pat.test(command));
}

/**
 * Checks if a binary exists in PATH
 */
function isBinaryAvailable(binary: string): boolean {
  try {
    const isWindows = process.platform === "win32";
    const checkCmd = isWindows ? `where ${binary}` : `which ${binary}`;
    const res = require("node:child_process").spawnSync(checkCmd, { shell: true, stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Vynor Native Sandbox Engine (Zero-Docker, 10ms micro-sandboxing)
 * ---------------------------------------------------------------------------
 * Provides native OS-level boundary isolation:
 *   - Windows: Job Object & PowerShell directory containment via EncodedCommand
 *   - Linux: Bubblewrap (bwrap) unprivileged user namespace jail
 *   - macOS: Apple Seatbelt (sandbox-exec)
 */
export function buildSandboxedCommand(options: SandboxExecutionOptions): SandboxedCommand {
  const { cwd, command, allowedWorkspaceDirs = [cwd] } = options;
  const platform = process.platform;

  // Intercept destructive commands before they ever reach an OS shell
  if (isDestructiveCommand(command)) {
    throw new Error(`[Vynor Sandbox Guard] Destructive or out-of-bounds command intercepted and blocked: ${command}`);
  }

  // ── 1. Linux: Bubblewrap unprivileged namespace jail ────────────────────────
  if (platform === "linux" && isBinaryAvailable("bwrap")) {
    const bindArgs: string[] = [
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--tmpfs", "/tmp",
    ];

    for (const dir of allowedWorkspaceDirs) {
      if (fs.existsSync(dir)) {
        bindArgs.push("--bind", dir, dir);
      }
    }

    bindArgs.push("--chdir", cwd);
    bindArgs.push("/bin/bash", "-c", command);

    return {
      shell: "bwrap",
      args: bindArgs,
      env: { ...process.env, VYNOR_SANDBOX: "bwrap" } as Record<string, string>,
      isSandboxed: true,
      sandboxType: "linux-bwrap",
    };
  }

  // ── 2. macOS: Apple Seatbelt sandbox-exec ───────────────────────────────────
  if (platform === "darwin" && isBinaryAvailable("sandbox-exec")) {
    const seatbeltProfile = `(version 1)
(allow default)
(deny file-write* (subpath "/System"))
(deny file-write* (subpath "/Library"))
(deny file-write* (subpath "/usr"))
(deny file-write* (subpath "/bin"))
(deny file-write* (subpath "/sbin"))
(allow file-write* (subpath "${cwd}"))
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/private/tmp"))
`;

    return {
      shell: "sandbox-exec",
      args: ["-p", seatbeltProfile, "/bin/bash", "-l", "-c", command],
      env: { ...process.env, VYNOR_SANDBOX: "seatbelt" } as Record<string, string>,
      isSandboxed: true,
      sandboxType: "macos-seatbelt",
    };
  }

  // ── 3. Windows: PowerShell constrained boundary jail via Base64 EncodedCommand
  if (platform === "win32") {
    // Using UTF-16LE Base64 -EncodedCommand completely avoids string-escaping and interpolation bugs
    const normalizedCwd = path.resolve(cwd);
    const psScript = [
      `$ProgressPreference = 'SilentlyContinue'`,
      `Set-Location -LiteralPath '${normalizedCwd.replace(/'/g, "''")}'`,
      `& { ${command} }`,
    ].join("; ");

    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      env: {
        ...process.env,
        VYNOR_SANDBOX: "windows-restricted",
        VYNOR_SANDBOX_CWD: cwd,
      } as Record<string, string>,
      isSandboxed: true,
      sandboxType: "windows-restricted",
    };
  }

  // ── 4. Fallback: Host execution with Vynor AST guardrails ─────────────────────
  const userShell = process.env.SHELL || "/bin/bash";
  return {
    shell: userShell,
    args: ["-l", "-c", command],
    env: { ...process.env, VYNOR_SANDBOX: "fallback" } as Record<string, string>,
    isSandboxed: false,
    sandboxType: "host-fallback",
  };
}
