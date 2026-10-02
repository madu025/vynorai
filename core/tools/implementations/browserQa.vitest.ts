import { describe, expect, it } from "vitest";
import { validateBrowserQaUrl } from "./browserQa";

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
