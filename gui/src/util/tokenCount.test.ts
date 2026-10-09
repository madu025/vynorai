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
    // the test setup preloads the tokenizer, like the app does after startup
    resetTokenizerForTests();
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

describe("waitForTokenizer", () => {
  it("returns within its limit even when the exact tokenizer is slow to load", async () => {
    vi.resetModules();
    vi.doMock("core/llm/countTokens", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return { countTokens: () => 1 };
    });
    const fresh = await import("./tokenCount");
    fresh.resetTokenizerForTests();
    const started = Date.now();
    await fresh.waitForTokenizer(150);
    expect(Date.now() - started).toBeLessThan(1_000);
    // still estimating, and a later call can pick up the exact counter
    expect(fresh.countTokens("a".repeat(35))).toBe(10);
    vi.doUnmock("core/llm/countTokens");
  });
});

describe("estimate for non-Latin text", () => {
  it("counts every non-ASCII character as a token, so Sinhala is not under-counted", () => {
    resetTokenizerForTests();
    const sinhala = "සිංහල අකුරු".replace(" ", "");
    expect(estimateTokenCount(sinhala)).toBe([...sinhala].length);
    expect(estimateTokenCount("日本語のテキスト")).toBe(8);
    // mixed: 7 ASCII chars (2 tokens) + 2 others
    expect(estimateTokenCount("abcdefgක්")).toBe(2 + [..."ක්"].length);
  });
});
