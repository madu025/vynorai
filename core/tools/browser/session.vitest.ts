import { describe, expect, it } from "vitest";

import { browserTool } from "../definitions/browser";
import { isLocalUrl, validateBrowserUrl } from "./session";

describe("browser tool", () => {
  it("accepts only credential-free http(s) URLs", () => {
    expect(validateBrowserUrl("localhost:3000").href).toBe(
      "http://localhost:3000/",
    );
    expect(() => validateBrowserUrl("file:///etc/passwd")).toThrow();
    expect(() => validateBrowserUrl("https://user:pw@example.com")).toThrow();
  });

  it("recognises local dev servers", () => {
    expect(isLocalUrl("http://localhost:5173/")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalUrl("http://app.localhost")).toBe(true);
    expect(isLocalUrl("https://vynor.lk")).toBe(false);
  });

  it("asks before external sites and JavaScript, not for reads or localhost", () => {
    const policy = (args: Record<string, unknown>) =>
      browserTool.evaluateToolCallPolicy!("allowedWithPermission", args);
    expect(policy({ action: "snapshot" })).toBe("allowedWithoutPermission");
    expect(policy({ action: "logs" })).toBe("allowedWithoutPermission");
    expect(policy({ action: "open", url: "localhost:3000" })).toBe(
      "allowedWithoutPermission",
    );
    expect(policy({ action: "open", url: "https://example.com" })).toBe(
      "allowedWithPermission",
    );
    expect(policy({ action: "evaluate", expression: "1" })).toBe(
      "allowedWithPermission",
    );
    expect(
      browserTool.evaluateToolCallPolicy!("disabled", { action: "snapshot" }),
    ).toBe("disabled");
  });
});
