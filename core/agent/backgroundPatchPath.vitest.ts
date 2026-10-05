import { describe, expect, it } from "vitest";
import { classifyBackgroundPatchPath } from "./backgroundUploadPolicy";

describe("classifyBackgroundPatchPath", () => {
  it("accepts ordinary project files", () => {
    for (const p of [
      "src/app.ts",
      "resources/views/home.blade.php",
      "README.md",
    ])
      expect(classifyBackgroundPatchPath(p), p).toBe("ok");
  });

  it("refuses paths that leave the workspace, including Windows forms", () => {
    for (const p of [
      "../x",
      "a/../../x",
      "..\\..\\x",
      "src\\..\\..\\x",
      "C:/x",
      "C:\\x",
      "/etc/passwd",
      "a//b",
      "./a",
      "file.txt:stream",
      "trailing.",
      "",
    ])
      expect(classifyBackgroundPatchPath(p), JSON.stringify(p)).toBe("unsafe");
  });

  it("refuses files that run code on the user's machine", () => {
    for (const p of [
      ".git/hooks/pre-commit",
      ".Git/config",
      ".vscode/tasks.json",
      ".idea/workspace.xml",
      ".devcontainer/devcontainer.json",
      ".husky/pre-push",
      ".github/workflows/ci.yml",
    ])
      expect(classifyBackgroundPatchPath(p), p).toBe("protected");
    expect(classifyBackgroundPatchPath(".github/ISSUE_TEMPLATE.md")).toBe("ok");
  });

  it("refuses credential files", () => {
    for (const p of [".env", "api/.env.local", "keys/id_rsa", "cert.pem"])
      expect(classifyBackgroundPatchPath(p), p).toBe("secret");
  });
});
