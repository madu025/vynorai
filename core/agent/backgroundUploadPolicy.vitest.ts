import { describe, expect, it } from "vitest";
import { classifyBackgroundUploadPath } from "./backgroundUploadPolicy";

describe("background upload policy", () => {
  it("includes ordinary source and lock files", () => {
    expect(classifyBackgroundUploadPath("src/index.ts")).toBe("include");
    expect(classifyBackgroundUploadPath("package-lock.json")).toBe("include");
  });

  it("excludes credentials and environment files", () => {
    for (const file of [
      ".env",
      "config/.env.production",
      ".npmrc",
      "id_ed25519",
      "certs/prod.pem",
      "credentials.json",
    ])
      expect(classifyBackgroundUploadPath(file)).toBe("secret");
  });

  it("excludes generated trees and unsafe paths", () => {
    expect(classifyBackgroundUploadPath("node_modules/pkg/index.js")).toBe(
      "generated",
    );
    expect(classifyBackgroundUploadPath("../../outside.txt")).toBe("unsafe");
    expect(classifyBackgroundUploadPath("C:/outside.txt")).toBe("unsafe");
  });
});
