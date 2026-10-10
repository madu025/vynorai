import { describe, expect, it } from "vitest";
import { replyLanguageGuidance } from "./replyLanguage";

describe("replyLanguageGuidance", () => {
  it("adds nothing for auto or unset, so existing prompts are unchanged", () => {
    expect(replyLanguageGuidance(undefined)).toBe("");
    expect(replyLanguageGuidance("auto")).toBe("");
    expect(replyLanguageGuidance("xx" as any)).toBe("");
  });

  it("names the language and keeps code in English", () => {
    const si = replyLanguageGuidance("si");
    expect(si).toContain("Sinhala");
    expect(si).toMatch(/code, commands, file paths, identifiers/);
    expect(replyLanguageGuidance("ta")).toContain("Tamil");
    expect(replyLanguageGuidance("en")).toContain("English");
  });

  it("is a pure function of the setting (stable prompt prefix)", () => {
    expect(replyLanguageGuidance("si")).toBe(replyLanguageGuidance("si"));
  });
});
