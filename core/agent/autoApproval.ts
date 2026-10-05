import path from "node:path";

/**
 * Risk-based auto-approval (the "Auto" permission mode).
 *
 * Asking before every edit and every command made the agent wait on the user
 * from the first step. Work that stays inside the workspace and can be undone
 * (reads, edits, running tests/builds/scripts, deleting files in the project)
 * runs on its own; only what is hard to undo or leaves the project asks:
 * publishing (git push, deploys), installing packages, network transfers,
 * elevated or system-level commands, and anything that touches paths outside
 * the workspace or secret files.
 */
export type ApprovalDecision = "auto" | "ask";

export interface ApprovalVerdict {
  decision: ApprovalDecision;
  reason?: string;
}

const AUTO: ApprovalVerdict = { decision: "auto" };
const ask = (reason: string): ApprovalVerdict => ({ decision: "ask", reason });

/** Commands that publish, deploy, install or reach other machines. */
const ASK_COMMAND_PATTERNS: Array<[RegExp, string]> = [
  [/\bgit\s+push\b/i, "publishes to a remote"],
  [
    /\bgit\s+(?:reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|restore\s|stash\s+(?:drop|clear)|rebase|filter-branch|branch\s+-D)\b/i,
    "discards git history or changes",
  ],
  [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|uninstall|update|upgrade|publish|link)\b/i,
    "changes installed packages",
  ],
  [/\bnpx\s+(?:-y|--yes)\b/i, "downloads and runs a package"],
  [
    /\b(?:pip|pip3|poetry|uv|cargo|gem|go|composer|dotnet|choco|winget|scoop|brew|apt|apt-get|yum|dnf)\s+(?:install|add|remove|uninstall|update|upgrade|publish|get)\b/i,
    "changes installed packages",
  ],
  [/\b(?:sudo|su|runas|doas)\b/i, "runs with elevated rights"],
  [/\b(?:ssh|scp|sftp|rsync|ftp)\b/i, "reaches another machine"],
  [
    /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i,
    "makes network requests",
  ],
  [
    /\b(?:docker\s+(?:push|login|system\s+prune|rm|rmi)|kubectl|helm|terraform\s+(?:apply|destroy)|vercel|netlify|firebase\s+deploy|gh\s+(?:pr|release|repo)\s+(?:create|merge|delete))\b/i,
    "deploys or changes remote resources",
  ],
  [
    /\b(?:setx|reg\s+(?:add|delete)|Set-ItemProperty\s+-Path\s+HK|chmod\s+-R|chown|icacls|takeown)\b/i,
    "changes system settings or permissions",
  ],
  [
    /\b(?:Stop-Process|taskkill|kill|pkill|killall)\b/i,
    "stops other processes",
  ],
  [
    /\b(?:shutdown|reboot|mkfs|diskpart)\b|\bformat\s+[a-zA-Z]:/i,
    "changes the machine",
  ],
];

/** Deleting / moving commands whose targets must stay inside the workspace. */
const PATH_MUTATING =
  /\b(?:rm|rmdir|del|erase|rd|Remove-Item|ri|mv|move|Move-Item|cp|copy|Copy-Item|xcopy|robocopy)\b/i;

const DELETING = /\b(?:rm|rmdir|del|erase|rd|Remove-Item|ri)\b/i;

function isWindowsAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("~") || isWindowsAbsolute(p);
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when an absolute path lies inside one of the workspace roots. */
export function isInsideWorkspace(target: string, roots: string[]): boolean {
  const t = normalize(target);
  return roots.some((root) => {
    const r = normalize(root);
    return r !== "" && (t === r || t.startsWith(`${r}/`));
  });
}

/** Path-like tokens in a command (skips flags and quoted text markers). */
function pathTokens(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|[^\s;|&]+/g) ?? [])
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter((t) => t && !t.startsWith("-"));
}

function escapesWorkspace(command: string, roots: string[]): string | null {
  for (const token of pathTokens(command)) {
    if (/(^|[\\/])\.\.([\\/]|$)/.test(token)) return token;
    if (isAbsolutePath(token) && !isInsideWorkspace(token, roots)) return token;
  }
  return null;
}

export function classifyCommand(
  command: string,
  workspaceRoots: string[],
): ApprovalVerdict {
  const cmd = command.trim();
  if (!cmd) return AUTO;
  for (const [pattern, reason] of ASK_COMMAND_PATTERNS) {
    if (pattern.test(cmd)) return ask(`This command ${reason}.`);
  }
  // Wildcards at a root ("rm -rf *", "del /s *") wipe the project.
  if (PATH_MUTATING.test(cmd)) {
    if (
      DELETING.test(cmd) &&
      /(?:^|\s)(?:\*|\.|\.\/\*|\/\*|\\\*)(?:\s|$)/.test(cmd)
    ) {
      return ask("This command deletes or moves the whole folder.");
    }
    const outside = escapesWorkspace(cmd, workspaceRoots);
    if (outside) {
      return ask(`This command changes ${outside}, outside the workspace.`);
    }
  }
  // Writing (redirection) to a file outside the workspace.
  const redirect = cmd.match(/>{1,2}\s*("[^"]+"|'[^']+'|[^\s;|&]+)/);
  if (redirect) {
    const target = redirect[1].replace(/^["']|["']$/g, "");
    if (
      (isAbsolutePath(target) && !isInsideWorkspace(target, workspaceRoots)) ||
      /(^|[\\/])\.\.([\\/]|$)/.test(target)
    ) {
      return ask(`This command writes to ${target}, outside the workspace.`);
    }
  }
  return AUTO;
}

/** Files whose content is credentials; editing them always asks. */
const SENSITIVE_FILE =
  /(?:^|[\\/])(?:\.env(?:\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|id_rsa[\w.]*|id_ed25519[\w.]*|credentials(?:\.json)?|secrets?\.[\w]+|[\w.-]+\.(?:pem|key|p12|pfx|keystore))$/i;

export function classifyFileEdit(
  filepath: string | undefined,
  workspaceRoots: string[],
): ApprovalVerdict {
  if (!filepath) return AUTO;
  let p = filepath.trim();
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname).replace(
        /^\/([a-zA-Z]:)/,
        "$1",
      );
    } catch {
      // Keep the raw value.
    }
  }
  if (SENSITIVE_FILE.test(p)) {
    return ask(`${path.basename(p)} may contain secrets.`);
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) {
    return ask(`${p} is outside the workspace.`);
  }
  if (isAbsolutePath(p) && !isInsideWorkspace(p, workspaceRoots)) {
    return ask(`${p} is outside the workspace.`);
  }
  return AUTO;
}
