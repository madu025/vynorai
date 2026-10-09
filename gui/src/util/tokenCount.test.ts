import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countTokens,
  ensureTokenizerLoaded,
  estimateTokenCount,
  resetTokenizerForTests,
} from "./tokenCount";

afterEach(() => resetTokenizerForTests());

describe("tokenCount", () => {
  it("estimates cautiously before the exact tokenizer has loaded", () => {
    // 350 characters: chars/3.5 = 100, above the plain chars/4 = 88
    const text = "a".repeat(350);
    expect(estimateTokenCount(text)).toBe(100);
    expect(countTokens(text)).toBe(100);
    expect(
      estimateTokenCount([
        { type: "text", text: "a".repeat(35) },
        { type: "imageUrl", imageUrl: { url: "data:..." } } as any,
      ]),
    ).toBe(10);
  });

  it("switches to the exact counter once it is loaded", async () => {
    const exact = vi.fn(() => 7);
    vi.doMock("core/llm/countTokens", () => ({ countTokens: exact }));
    resetTokenizerForTests();
    const before = countTokens("hello world", "gpt-4");
    await ensureTokenizerLoaded();
    expect(before).toBe(estimateTokenCount("hello world"));
    expect(countTokens("hello world", "gpt-4")).toBe(7);
    expect(exact).toHaveBeenCalledWith("hello world", "gpt-4");
    vi.doUnmock("core/llm/countTokens");
  });

  it("loads only once however often it is requested", async () => {
    const first = ensureTokenizerLoaded();
    expect(ensureTokenizerLoaded()).toBe(first);
    await first;
  });
});
