import * as fs from "fs";
import * as path from "path";

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

/** Accepts `{permissions:{...}}` or the lists at the top level. Bad input yields no rules. */
export function parsePermissionRules(text: string): PermissionRules {
  try {
    const json = JSON.parse(text);
    const source =
      json && typeof json === "object" && json.permissions
        ? json.permissions
        : json;
    if (!source || typeof source !== "object") {
      return { allow: [], ask: [], deny: [] };
    }
    return {
      allow: strings(source.allow),
      ask: strings(source.ask),
      deny: strings(source.deny),
    };
  } catch {
    return { allow: [], ask: [], deny: [] };
  }
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

/** Loads project rules (every workspace root) and user rules (global folder). */
export async function loadPermissionRules(
  ide: Pick<IDE, "getWorkspaceDirs" | "fileExists" | "readFile">,
  globalDir?: string,
): Promise<PermissionRules> {
  const found: PermissionRules[] = [];
  for (const dir of (await ide.getWorkspaceDirs()) ?? []) {
    const uri = joinPathsToUri(dir, `.vynorai/${PERMISSIONS_FILE}`);
    try {
      if (await ide.fileExists(uri)) {
        found.push(parsePermissionRules(await ide.readFile(uri)));
      }
    } catch {
      // unreadable file: no rules from it
    }
  }
  if (globalDir) {
    try {
      const file = path.join(globalDir, PERMISSIONS_FILE);
      if (fs.existsSync(file)) {
        found.push(parsePermissionRules(fs.readFileSync(file, "utf8")));
      }
    } catch {
      // ignore
    }
  }
  return mergePermissionRules(found);
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

/** `*` matches `star`; `**` always matches across separators. */
function globToRegExp(glob: string, star: string): RegExp {
  const source = escapeRegExp(glob)
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, star)
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

/** Shell separators and substitutions, so `git status && rm -rf x` is checked per command. */
export function splitCommands(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n|\$\(|`|\)/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function commandMatches(specifier: string, command: string): boolean {
  const spec = specifier.replace(/\s+/g, " ").trim();
  const test = (candidate: string): boolean => {
    if (spec.endsWith(":*")) {
      const prefix = spec.slice(0, -2);
      return candidate === prefix || candidate.startsWith(`${prefix} `);
    }
    if (spec.includes("*")) return globToRegExp(spec, ".*").test(candidate);
    return candidate === spec;
  };
  return (
    test(command.trim().replace(/\s+/g, " ")) ||
    splitCommands(command).some(test)
  );
}

function pathCandidates(filepath: string, roots: string[]): string[] {
  const normalized = filepath.replace(/\\/g, "/").replace(/^\.\//, "");
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
    return regex.test(path.posix.basename(filepath.replace(/\\/g, "/")));
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
