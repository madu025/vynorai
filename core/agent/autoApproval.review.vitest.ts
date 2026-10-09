import { describe, expect, it } from "vitest";
import { asksInAcceptEditsMode } from "./autoApproval";

describe("accept-edits mode", () => {
  it("runs reads and project edits, asks for everything else", () => {
    expect(asksInAcceptEditsMode("R0")).toBe(false);
    expect(asksInAcceptEditsMode("R2")).toBe(false);
    // commands, and also browser / MCP / web tools (R1), ask
    expect(asksInAcceptEditsMode("R3")).toBe(true);
    expect(asksInAcceptEditsMode("R1")).toBe(true);
  });
});
