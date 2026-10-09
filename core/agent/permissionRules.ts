import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import type { IDE } from "..";
import { joinPathsToUri } from "../util/uri";

/**
 * User-written permission rules, in the style of Claude Code:
 *
 *   { "permissions": { "ask": ["Bash(git push:*)"], "deny": ["Edit(.env*)", "Bash(rm:*)"] } }
 *
 * Read from `.vynorai/permissions.json` in each workspace root and from
 * `permissions.json` in the VynorAI global folder. Deny beats ask in every
 * scope. Rules only ever make the agent MORE careful: `deny` blocks a call and
 * `ask` forces an approval prompt. `allow` entries are parsed and kept for
 * later but do not relax anything yet.
 */
export interface PermissionRules {
  allow: string[];
  ask: string[];
  deny: string[];
}

export interface PermissionDecision {
  decision: "deny" | "ask";
  /** The rule text that matched, shown to the user. */
  rule: string;
}

export const PERMISSIONS_FILE = "permissions.json";

/** Claude Code style names mapped to VynorAI tool names. */
const TOOL_ALIASES: Record<string, string[]> = {
  bash: ["run_terminal_command"],
  read: ["read_file", "read_file_range", "read_currently_open_file"],
  edit: ["edit_existing_file", "single_find_and_replace", "multi_edit"],
  write: ["create_new_file"],
  grep: ["grep_search"],
  glob: ["file_glob_search"],
  webfetch: ["fetch_url_content"],
  websearch: ["search_web"],
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

/** Like parsePermissionRules, but says why a file produced no rules. */
export function parsePermissionRulesDetailed(text: string): {
  rules: PermissionRules;
  error?: string;
} {
  try {
    const json = JSON.parse(text);
    const source =
      json && typeof json === "object" && json.permissions
        ? json.permissions
        : json;
    if (!source || typeof source !== "object") {
      return {
        rules: { allow: [], ask: [], deny: [] },
        error: "expected an object with allow, ask and deny lists",
      };
    }
    return {
      rules: {
        allow: strings(source.allow),
        ask: strings(source.ask),
        deny: strings(source.deny),
      },
    };
  } catch (e) {
    return {
      rules: { allow: [], ask: [], deny: [] },
      error: e instanceof Error ? e.message : "invalid JSON",
    };
  }
}

/** Accepts `{permissions:{...}}` or the lists at the top level. Bad input yields no rules. */
export function parsePermissionRules(text: string): PermissionRules {
  return parsePermissionRulesDetailed(text).rules;
}

export function mergePermissionRules(all: PermissionRules[]): PermissionRules {
  const merged: PermissionRules = { allow: [], ask: [], deny: [] };
  for (const rules of all) {
    merged.allow.push(...rules.allow);
    merged.ask.push(...rules.ask);
    merged.deny.push(...rules.deny);
  }
  return merged;
}

export interface LoadedPermissionRules {
  rules: PermissionRules;
  /** Files that exist but could not be used, so their rules are NOT in effect. */
  problems: string[];
}

/** Loads project rules (every workspace root) and user rules (global folder). */
export async function loadPermissionRulesDetailed(
  ide: Pick<IDE, "getWorkspaceDirs" | "fileExists" | "readFile">,
  globalDir?: string,
): Promise<LoadedPermissionRules> {
  const found: PermissionRules[] = [];
  const problems: string[] = [];
  const take = (label: string, text: string) => {
    const parsed = parsePermissionRulesDetailed(text);
    if (parsed.error) problems.push(`${label}: ${parsed.error}`);
    found.push(parsed.rules);
  };
  for (const dir of (await ide.getWorkspaceDirs()) ?? []) {
    const uri = joinPathsToUri(dir, `.vynorai/${PERMISSIONS_FILE}`);
    try {
      if (await ide.fileExists(uri)) {
        take(`.vynorai/${PERMISSIONS_FILE}`, await ide.readFile(uri));
      }
    } catch (e) {
      problems.push(
        `.vynorai/${PERMISSIONS_FILE}: could not be read (${e instanceof Error ? e.message : e})`,
      );
    }
  }
  if (globalDir) {
    try {
      const file = path.join(globalDir, PERMISSIONS_FILE);
      if (fs.existsSync(file)) {
        take(
          `global ${PERMISSIONS_FILE}`,
          await fs.promises.readFile(file, "utf8"),
        );
      }
    } catch (e) {
      problems.push(
        `global ${PERMISSIONS_FILE}: could not be read (${e instanceof Error ? e.message : e})`,
      );
    }
  }
  return { rules: mergePermissionRules(found), problems };
}

export async function loadPermissionRules(
  ide: Pick<IDE, "getWorkspaceDirs" | "fileExists" | "readFile">,
  globalDir?: string,
): Promise<PermissionRules> {
  return (await loadPermissionRulesDetailed(ide, globalDir)).rules;
}

interface ParsedRule {
  tool: string;
  specifier?: string;
}

function parseRule(rule: string): ParsedRule | null {
  const match = rule.trim().match(/^([^()\s]+)\s*(?:\(([\s\S]*)\))?$/);
  if (!match) return null;
  return { tool: match[1], specifier: match[2]?.trim() };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

const DOUBLE_STAR = "\u0000";
const ANY_DIRS = "\u0001";

/** `*` matches `star`; `**` matches across separators; a `**` followed by `/` also matches zero directories. */
function globToRegExp(glob: string, star: string): RegExp {
  const source = escapeRegExp(glob)
    .replace(/\*\*\//g, ANY_DIRS)
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, star)
    .split(ANY_DIRS)
    .join("(?:.*/)?")
    .split(DOUBLE_STAR)
    .join(".*");
  return new RegExp(`^${source}$`);
}

function toolMatches(ruleTool: string, toolName: string): boolean {
  const aliased = TOOL_ALIASES[ruleTool.toLowerCase()];
  if (aliased) return aliased.includes(toolName);
  if (ruleTool.includes("*"))
    return globToRegExp(ruleTool, ".*").test(toolName);
  return ruleTool === toolName;
}

/**
 * Shell separators, background "&" and substitutions, so "git status && rm -rf x"
 * and "echo ok & rm -rf x" are checked per command.
 */
export function splitCommands(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||&|\r?\n|\r|\$\(|\u0060|\(|\)|\{|\}/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** Programs that only run another program: "sudo rm x" is really "rm x". */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "nohup",
  "time",
  "command",
  "exec",
  "nice",
  "ionice",
  "stdbuf",
  "setsid",
  "xargs",
  "timeout",
  "watch",
  "builtin",
]);

function programName(token: string): string {
  return token.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

/**
 * The command a segment really runs: leading VAR=value assignments and wrapper
 * programs (with their flags) removed, and an absolute path or .exe suffix cut
 * from the program, so "sudo -n /bin/rm -rf x" becomes "rm -rf x".
 */
export function normalizeCommand(segment: string): string {
  let tokens = segment.trim().split(/\s+/).filter(Boolean);
  for (let guard = 0; guard < 8 && tokens.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens = tokens.slice(1);
      continue;
    }
    if (!WRAPPERS.has(programName(tokens[0]).toLowerCase())) break;
    tokens = tokens.slice(1);
    while (
      tokens.length &&
      (tokens[0].startsWith("-") || /^\d+[smhd]?$/.test(tokens[0]))
    ) {
      tokens = tokens.slice(1);
    }
  }
  if (!tokens.length) return "";
  tokens[0] = programName(tokens[0]);
  return tokens.join(" ");
}

function commandMatches(specifier: string, command: string): boolean {
  const spec = specifier.replace(/\s+/g, " ").trim();
  const test = (candidate: string): boolean => {
    if (!candidate) return false;
    if (spec.endsWith(":*")) {
      const prefix = spec.slice(0, -2);
      return candidate === prefix || candidate.startsWith(`${prefix} `);
    }
    if (spec.includes("*")) return globToRegExp(spec, ".*").test(candidate);
    return candidate === spec;
  };
  const whole = command.trim().replace(/\s+/g, " ");
  const segments = splitCommands(command);
  return [whole, ...segments, ...segments.map(normalizeCommand)].some(test);
}

/** A tool may pass a file: URI; rules are written against plain paths. */
function toPlainPath(filepath: string): string {
  let plain = filepath;
  if (/^file:/i.test(plain)) {
    try {
      plain = fileURLToPath(plain);
    } catch {
      plain = decodeURIComponent(plain.replace(/^file:\/*/i, "/"));
    }
  }
  // Collapse "a/../b" so a rule cannot be dodged with ".." segments.
  const slashed = plain.replace(/\\/g, "/");
  return path.posix.normalize(slashed).replace(/^\.\//, "");
}

function pathCandidates(filepath: string, roots: string[]): string[] {
  const normalized = toPlainPath(filepath);
  const candidates = new Set([normalized, path.posix.basename(normalized)]);
  for (const root of roots) {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.toLowerCase().startsWith(`${r.toLowerCase()}/`)) {
      candidates.add(normalized.slice(r.length + 1));
    }
  }
  return [...candidates];
}

function pathMatches(
  specifier: string,
  filepath: string,
  roots: string[],
): boolean {
  const spec = specifier.replace(/\\/g, "/").replace(/^\.\//, "");
  const regex = globToRegExp(spec, "[^/]*");
  // A pattern without a slash (".env*") matches the file name in any folder.
  if (!spec.includes("/")) {
    return regex.test(path.posix.basename(toPlainPath(filepath)));
  }
  return pathCandidates(filepath, roots).some((c) => regex.test(c));
}

export interface PermissionCall {
  toolName: string;
  args: Record<string, unknown>;
  processedArgs?: Record<string, unknown>;
}

function primaryText(call: PermissionCall): string {
  const args = { ...call.args, ...(call.processedArgs ?? {}) };
  for (const key of ["command", "filepath", "url", "query", "pattern"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return JSON.stringify(call.args);
}

function ruleMatches(
  rule: string,
  call: PermissionCall,
  roots: string[],
): boolean {
  const parsed = parseRule(rule);
  if (!parsed || !toolMatches(parsed.tool, call.toolName)) return false;
  if (parsed.specifier === undefined || parsed.specifier === "") return true;

  if (call.toolName === "run_terminal_command") {
    const command = call.args.command;
    return typeof command === "string"
      ? commandMatches(parsed.specifier, command)
      : false;
  }
  const filepath = call.args.filepath ?? call.processedArgs?.filepath;
  if (typeof filepath === "string") {
    return pathMatches(parsed.specifier, filepath, roots);
  }
  return globToRegExp(parsed.specifier, ".*").test(primaryText(call));
}

/** Deny beats ask; no match returns undefined and leaves the normal policy alone. */
export function evaluatePermissionRules(
  rules: PermissionRules,
  call: PermissionCall,
  roots: string[] = [],
): PermissionDecision | undefined {
  const denied = rules.deny.find((rule) => ruleMatches(rule, call, roots));
  if (denied) return { decision: "deny", rule: denied };
  const asked = rules.ask.find((rule) => ruleMatches(rule, call, roots));
  if (asked) return { decision: "ask", rule: asked };
  return undefined;
}
