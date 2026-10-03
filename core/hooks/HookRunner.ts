import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getContinueGlobalPath } from "../util/paths";
import { HOOK_EVENTS, HookEvent, HookPayload, HookRunResult } from "./types";

export interface HookCommand {
  command: string;
  matcher?: string;
  timeoutSeconds: number;
  source: "user" | "project";
}

export type HooksConfig = Record<HookEvent, HookCommand[]>;

const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;
const OUTPUT_CAP = 10_000;
export const HOOKS_FILE = "hooks.json";
export const PROJECT_HOOKS_PATH = path.join(".vynorai", HOOKS_FILE);

function emptyConfig(): HooksConfig {
  return { UserPromptSubmit: [], PreToolUse: [], PostToolUse: [], Stop: [] };
}

function toCommand(
  entry: any,
  matcher: unknown,
  source: HookCommand["source"],
): HookCommand | null {
  if (!entry || typeof entry.command !== "string" || !entry.command.trim())
    return null;
  if (entry.type !== undefined && entry.type !== "command") return null;
  const timeout = Number(entry.timeout);
  return {
    command: entry.command,
    matcher:
      typeof matcher === "string" && matcher.trim() ? matcher : undefined,
    timeoutSeconds:
      Number.isFinite(timeout) && timeout > 0
        ? Math.min(timeout, MAX_TIMEOUT_S)
        : DEFAULT_TIMEOUT_S,
    source,
  };
}

/**
 * Parse a hooks file. Accepts the flat form
 *   { "hooks": { "PreToolUse": [{ "matcher": "run_terminal_command", "command": "...", "timeout": 10 }] } }
 * and the Claude Code nested form
 *   { "hooks": { "PreToolUse": [{ "matcher": "...", "hooks": [{ "type": "command", "command": "..." }] }] } }
 */
export function parseHooksConfig(
  raw: unknown,
  source: HookCommand["source"],
): HooksConfig {
  const config = emptyConfig();
  const hooks = (raw as any)?.hooks;
  if (!hooks || typeof hooks !== "object") return config;
  for (const event of HOOK_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    for (const entry of entries) {
      if (Array.isArray(entry?.hooks)) {
        for (const inner of entry.hooks) {
          const cmd = toCommand(inner, entry.matcher, source);
          if (cmd) config[event].push(cmd);
        }
      } else {
        const cmd = toCommand(entry, entry?.matcher, source);
        if (cmd) config[event].push(cmd);
      }
    }
  }
  return config;
}

/** `matcher` is a regex over the tool name ("Edit|Write", "run_.*"); empty or "*" matches all. */
export function matchesTool(
  matcher: string | undefined,
  toolName: string | undefined,
): boolean {
  if (!matcher || matcher === "*") return true;
  if (!toolName) return false;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return matcher === toolName;
  }
}

interface CommandOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export function runHookCommand(
  command: string,
  payload: HookPayload,
  cwd: string,
  timeoutSeconds: number,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (outcome: CommandOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const isWindows = process.platform === "win32";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        // POSIX: own process group, so a timeout can kill the shell's children too.
        detached: !isWindows,
        env: {
          ...process.env,
          VYNORAI_HOOK_EVENT: payload.event,
          VYNORAI_PROJECT_DIR: cwd,
        },
      });
    } catch (error) {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        spawnError: String(error),
      });
      return;
    }
    // Killing only the shell would leave its children running and holding the
    // pipes open, so a hung hook would still block the turn.
    const killTree = () => {
      if (!child.pid) return;
      try {
        if (isWindows) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      finish({ code: null, stdout, stderr, timedOut });
    }, timeoutSeconds * 1000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error.message,
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      finish({
        code,
        stdout: stdout.slice(0, OUTPUT_CAP),
        stderr: stderr.slice(0, OUTPUT_CAP),
        timedOut,
      });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(payload));
  });
}

export interface HookRunnerDeps {
  /** Workspace folder URIs (file://...). The first is the hooks' working directory. */
  getWorkspaceDirs(): Promise<string[]>;
  /** Project hooks only run in a trusted workspace. */
  isWorkspaceTrusted(): Promise<boolean>;
  /** Ask the user to allow a project's hook commands; resolves true to allow. */
  confirmProjectHooks(file: string, commands: string[]): Promise<boolean>;
  /** Override for tests. */
  globalDir?: string;
}

/**
 * Loads user (~/.vynorai/hooks.json) and project (.vynorai/hooks.json) hooks
 * and runs the ones matching an event. Project hooks come from the repository
 * and run arbitrary commands, so they need a trusted workspace plus a one-time
 * approval of the exact file contents (re-asked whenever the file changes).
 */
export class HookRunner {
  private declinedHashes = new Set<string>();

  constructor(private readonly deps: HookRunnerDeps) {}

  private get globalDir(): string {
    return this.deps.globalDir ?? getContinueGlobalPath();
  }

  private get approvalsPath(): string {
    return path.join(this.globalDir, "approved-hooks.json");
  }

  private readJson(file: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  }

  private async workspaceRoot(): Promise<string | undefined> {
    const [first] = await this.deps.getWorkspaceDirs();
    if (!first) return undefined;
    try {
      return first.startsWith("file:") ? fileURLToPath(first) : first;
    } catch {
      return undefined;
    }
  }

  private async projectHooks(root: string): Promise<HooksConfig> {
    const file = path.join(root, PROJECT_HOOKS_PATH);
    if (!fs.existsSync(file)) return emptyConfig();
    if (!(await this.deps.isWorkspaceTrusted())) return emptyConfig();

    const text = fs.readFileSync(file, "utf8");
    const config = parseHooksConfig(this.readJson(file), "project");
    const commands = HOOK_EVENTS.flatMap((e) =>
      config[e].map((c) => c.command),
    );
    if (commands.length === 0) return emptyConfig();

    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const approvals =
      (this.readJson(this.approvalsPath) as Record<string, string>) ?? {};
    if (approvals[file] === hash) return config;
    if (this.declinedHashes.has(hash)) return emptyConfig();

    if (await this.deps.confirmProjectHooks(file, commands)) {
      approvals[file] = hash;
      fs.mkdirSync(this.globalDir, { recursive: true });
      fs.writeFileSync(this.approvalsPath, JSON.stringify(approvals, null, 2));
      return config;
    }
    this.declinedHashes.add(hash);
    return emptyConfig();
  }

  async load(): Promise<{ config: HooksConfig; cwd: string }> {
    const root = await this.workspaceRoot();
    const user = parseHooksConfig(
      this.readJson(path.join(this.globalDir, HOOKS_FILE)),
      "user",
    );
    const project = root ? await this.projectHooks(root) : emptyConfig();
    const config = emptyConfig();
    for (const event of HOOK_EVENTS)
      config[event] = [...user[event], ...project[event]];
    return { config, cwd: root ?? this.globalDir };
  }

  async run(payload: HookPayload): Promise<HookRunResult> {
    const result: HookRunResult = { blocked: false, warnings: [], ran: 0 };
    const { config, cwd } = await this.load();
    const commands = config[payload.event].filter((c) =>
      matchesTool(c.matcher, payload.toolName),
    );
    const contexts: string[] = [];

    for (const hook of commands) {
      const outcome = await runHookCommand(
        hook.command,
        payload,
        cwd,
        hook.timeoutSeconds,
      );
      result.ran += 1;
      if (outcome.code === 0) {
        if (outcome.stdout.trim()) contexts.push(outcome.stdout.trim());
        continue;
      }
      if (outcome.code === 2) {
        result.blocked = true;
        result.reason =
          outcome.stderr.trim() ||
          outcome.stdout.trim() ||
          `Blocked by hook: ${hook.command}`;
        break; // The first blocking hook decides.
      }
      const why = outcome.timedOut
        ? `timed out after ${hook.timeoutSeconds}s`
        : (outcome.spawnError ??
          `exited with code ${outcome.code}${outcome.stderr.trim() ? `: ${outcome.stderr.trim()}` : ""}`);
      result.warnings.push(`${payload.event} hook "${hook.command}" ${why}`);
    }

    if (contexts.length) result.context = contexts.join("\n\n");
    return result;
  }
}
