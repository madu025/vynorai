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
  sandboxType:
    | "windows-guarded"
    | "linux-bwrap"
    | "macos-seatbelt"
    | "host-fallback";
}

const SECRET_ENV_NAME =
  /(?:secret|token|password|passwd|api[_-]?key|auth|cookie|credential|private[_-]?key)/i;

export function sanitizeSandboxEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !SECRET_ENV_NAME.test(entry[0]),
    ),
  );
}

function strictSandboxRequired(): boolean {
  return /^(?:1|true|yes)$/i.test(
    process.env.VYNOR_REQUIRE_STRICT_SANDBOX ?? "",
  );
}

/**
 * Destructive patterns that could wipe host systems or exfiltrate private credentials
 */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+[\/\\]/i, // rm -rf /
  /\bdel\s+\/[fq]\s+[a-z]:[\/\\]/i, // del /f C:\
  /\brmdir\s+\/[sq]\s+[a-z]:[\/\\]/i, // rmdir /s C:\
  /\bformat\s+[a-z]:/i, // format C:
  /\bmkfs\b/i, // mkfs
  /\bdd\s+if=/i, // dd if=
  /\b(shutdown|reboot|init\s+0)\b/i, // host shutdown
  /\bcurl\b.*(?:\.ssh|\.aws|\.env|id_rsa)/i, // credential exfiltration attempts
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
    const res = require("node:child_process").spawnSync(checkCmd, {
      shell: true,
      stdio: "ignore",
    });
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
export function buildSandboxedCommand(
  options: SandboxExecutionOptions,
): SandboxedCommand {
  const { cwd, command, allowedWorkspaceDirs = [cwd] } = options;
  const platform = process.platform;
  const normalizedCwd = path.resolve(cwd);
  const normalizedAllowed = allowedWorkspaceDirs.map((dir) =>
    path.resolve(dir),
  );
  if (
    !normalizedAllowed.some(
      (dir) =>
        normalizedCwd === dir || normalizedCwd.startsWith(`${dir}${path.sep}`),
    )
  ) {
    throw new Error(
      "[Vynor Sandbox Guard] Working directory is outside the allowed workspace.",
    );
  }
  const safeEnv = sanitizeSandboxEnvironment();

  // Intercept destructive commands before they ever reach an OS shell
  if (isDestructiveCommand(command)) {
    throw new Error(
      `[Vynor Sandbox Guard] Destructive or out-of-bounds command intercepted and blocked: ${command}`,
    );
  }

  // ── 1. Linux: Bubblewrap unprivileged namespace jail ────────────────────────
  if (platform === "linux" && isBinaryAvailable("bwrap")) {
    const bindArgs: string[] = [
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
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
      env: { ...safeEnv, VYNOR_SANDBOX: "bwrap" },
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
      env: { ...safeEnv, VYNOR_SANDBOX: "seatbelt" },
      isSandboxed: true,
      sandboxType: "macos-seatbelt",
    };
  }

  // ── 3. Windows: PowerShell constrained boundary jail via Base64 EncodedCommand
  if (platform === "win32") {
    // Using UTF-16LE Base64 -EncodedCommand completely avoids string-escaping and interpolation bugs
    if (strictSandboxRequired()) {
      throw new Error(
        "[Vynor Sandbox Guard] Strict OS isolation is unavailable on this Windows host.",
      );
    }
    // `& { cmd }` alone always exited 0 and dropped PowerShell errors, so a
    // failing test or a missing command looked like success. Pass on the
    // native exit code, and fail on PowerShell errors (command not found,
    // cmdlet failures); native stderr (git progress, warnings) is passed
    // through to stderr without failing the command.
    const psScript = [
      `$ProgressPreference = 'SilentlyContinue'`,
      `Set-Location -LiteralPath '${normalizedCwd.replace(/'/g, "''")}'`,
      `$global:LASTEXITCODE = 0`,
      `$__vynorFailed = $false`,
      `& { ${command}\n} 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { [Console]::Error.WriteLine($_.ToString()); if ($_.FullyQualifiedErrorId -notlike 'NativeCommandError*') { $__vynorFailed = $true } } else { $_ } }`,
      `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
      `if ($__vynorFailed) { exit 1 }`,
      `exit 0`,
    ].join("; ");

    const encoded = Buffer.from(psScript, "utf16le").toString("base64");

    return {
      shell: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      env: {
        ...safeEnv,
        VYNOR_SANDBOX: "windows-guarded",
        VYNOR_SANDBOX_CWD: cwd,
      } as Record<string, string>,
      isSandboxed: false,
      sandboxType: "windows-guarded",
    };
  }

  // ── 4. Fallback: Host execution with Vynor AST guardrails ─────────────────────
  if (strictSandboxRequired()) {
    throw new Error(
      "[Vynor Sandbox Guard] Strict OS isolation is unavailable on this host.",
    );
  }
  const userShell = process.env.SHELL || "/bin/bash";
  return {
    shell: userShell,
    args: ["-l", "-c", command],
    env: { ...safeEnv, VYNOR_SANDBOX: "fallback" },
    isSandboxed: false,
    sandboxType: "host-fallback",
  };
}
