import { describe, expect, it } from "vitest";

import { panelCommandFromEditor, parsePanelCommand } from "./panelCommands";

describe("parsePanelCommand", () => {
  it("recognises the panel commands, with and without an argument", () => {
    expect(parsePanelCommand("/clear")).toEqual({ name: "clear", arg: "" });
    expect(parsePanelCommand("  /Compact focus on the auth bug ")).toEqual({
      name: "compact",
      arg: "focus on the auth bug",
    });
    expect(parsePanelCommand("/plan add rate limiting")).toEqual({
      name: "plan",
      arg: "add rate limiting",
    });
  });

  it("leaves everything else for the model", () => {
    expect(parsePanelCommand("please /clear my cache")).toBeUndefined();
    expect(parsePanelCommand("/clearance")).toBeUndefined();
    expect(parsePanelCommand("/status")).toBeUndefined();
    expect(parsePanelCommand("")).toBeUndefined();
  });
});

describe("panelCommandFromEditor", () => {
  const doc = (...content: any[]) => ({ type: "doc", content });
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  });

  it("reads a command picked from the slash menu (prompt block + text)", () => {
    const block = { type: "prompt-block", attrs: { item: { name: "plan" } } };
    expect(
      panelCommandFromEditor(doc(block, paragraph("add caching"))),
    ).toEqual({
      name: "plan",
      arg: "add caching",
    });
    expect(panelCommandFromEditor(doc(block, paragraph("")))).toEqual({
      name: "plan",
      arg: "",
    });
  });

  it("reads a command typed as plain text", () => {
    expect(panelCommandFromEditor(doc(paragraph("/clear")))).toEqual({
      name: "clear",
      arg: "",
    });
  });

  it("ignores other slash commands and ordinary prompts", () => {
    const status = {
      type: "prompt-block",
      attrs: { item: { name: "status" } },
    };
    expect(panelCommandFromEditor(doc(status, paragraph("")))).toBeUndefined();
    expect(
      panelCommandFromEditor(doc(paragraph("explain /clear"))),
    ).toBeUndefined();
  });
});
