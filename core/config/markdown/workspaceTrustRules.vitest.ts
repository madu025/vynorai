import { describe, expect, it } from "vitest";
import { IDE, RuleWithSource } from "../..";
import {
  gateWorkspaceRules,
  UNTRUSTED_RULES_MESSAGE,
} from "./workspaceTrustRules";

const ROOT = "file:///work/repo";

function rule(sourceFile: string | undefined, text = "x"): RuleWithSource {
  return { rule: text, source: "agentFile", sourceFile } as RuleWithSource;
}

function ide(trusted: boolean | undefined | "throws"): IDE {
  const base: Partial<IDE> = {
    getWorkspaceDirs: async () => [ROOT],
  };
  if (trusted !== undefined) {
    base.isWorkspaceTrusted = async () => {
      if (trusted === "throws") throw new Error("no trust api");
      return trusted;
    };
  }
  return base as IDE;
}

const projectFile = rule(`${ROOT}/CLAUDE.md`, "project");
const nestedRule = rule(`${ROOT}/.continue/rules/style.md`, "nested");
const globalFile = rule("file:///home/me/.claude/CLAUDE.md", "global");
const parentFile = rule("file:///work/AGENTS.md", "parent");
const noSource = rule(undefined, "built-in");
const all = [projectFile, nestedRule, globalFile, parentFile, noSource];

describe("gateWorkspaceRules", () => {
  it("keeps every rule in a trusted workspace", async () => {
    const result = await gateWorkspaceRules(ide(true), all);
    expect(result.rules).toEqual(all);
    expect(result.errors).toEqual([]);
  });

  it("keeps every rule when the IDE has no trust API", async () => {
    const result = await gateWorkspaceRules(ide(undefined), all);
    expect(result.rules).toEqual(all);
    expect(result.errors).toEqual([]);
  });

  it("drops the workspace's own files when it is not trusted", async () => {
    const result = await gateWorkspaceRules(ide(false), all);
    expect(result.rules).toEqual([globalFile, parentFile, noSource]);
    expect(result.errors).toEqual([
      { fatal: false, message: UNTRUSTED_RULES_MESSAGE },
    ]);
  });

  it("fails closed when the trust check throws", async () => {
    const result = await gateWorkspaceRules(ide("throws"), all);
    expect(result.rules).not.toContain(projectFile);
    expect(result.rules).not.toContain(nestedRule);
  });

  it("does not drop a sibling folder that only shares a name prefix", async () => {
    const sibling = rule("file:///work/repo-other/CLAUDE.md", "sibling");
    const result = await gateWorkspaceRules(ide(false), [sibling]);
    expect(result.rules).toEqual([sibling]);
    expect(result.errors).toEqual([]);
  });
});
