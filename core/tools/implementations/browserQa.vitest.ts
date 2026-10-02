import { describe, expect, it } from "vitest";
import {
  browserQaBaselineKey,
  parseBrowserQaActions,
  redactBrowserQaUrl,
  validateBrowserQaUrl,
} from "./browserQa";

describe("Browser QA origin policy", () => {
  it("accepts HTTP(S) URLs", () => {
    expect(validateBrowserQaUrl("http://localhost:3000/path").origin).toBe(
      "http://localhost:3000",
    );
    expect(validateBrowserQaUrl("https://example.com").protocol).toBe("https:");
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com"])(
    "rejects unsafe protocol %s",
    (url) => expect(() => validateBrowserQaUrl(url)).toThrow(),
  );

  it("rejects credentials embedded in URLs", () => {
    expect(() =>
      validateBrowserQaUrl("https://user:secret@example.com"),
    ).toThrow();
  });
});

describe("Browser QA bounded workflow", () => {
  it("accepts valid actions without retaining extra fields", () => {
    expect(
      parseBrowserQaActions([{ type: "click", selector: "#save" }]),
    ).toEqual([
      { type: "click", selector: "#save", timeoutMs: 3000, value: undefined },
    ]);
  });

  it("rejects unbounded or malformed actions", () => {
    expect(() => parseBrowserQaActions(new Array(21).fill({}))).toThrow();
    expect(() =>
      parseBrowserQaActions([{ type: "type", selector: "#name" }]),
    ).toThrow();
    expect(() =>
      parseBrowserQaActions([
        { type: "click", selector: "#x", timeoutMs: 6000 },
      ]),
    ).toThrow();
  });

  it("creates deterministic, viewport-specific baseline keys", () => {
    const url = new URL("https://example.com/dashboard?secret=ignored");
    expect(browserQaBaselineKey(url, "desktop")).toHaveLength(64);
    expect(browserQaBaselineKey(url, "desktop")).toBe(
      browserQaBaselineKey(
        new URL("https://example.com/dashboard?x=2"),
        "desktop",
      ),
    );
    expect(browserQaBaselineKey(url, "desktop")).not.toBe(
      browserQaBaselineKey(url, "mobile"),
    );
  });

  it("redacts query strings and fragments from evidence", () => {
    expect(
      redactBrowserQaUrl("https://example.com/callback?token=secret#session"),
    ).toBe("https://example.com/callback");
  });
});
