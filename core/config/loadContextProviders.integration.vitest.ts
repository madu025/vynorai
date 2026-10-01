import { describe, expect, it } from "vitest";
import { loadConfigContextProviders } from "./loadContextProviders";

describe("VynorAI workspace context defaults", () => {
  it("loads tree and codebase providers without explicit user context config", () => {
    const result = loadConfigContextProviders(undefined, false, "vscode");
    const titles = result.providers.map(
      (provider) => provider.description.title,
    );

    expect(result.errors).toEqual([]);
    expect(titles).toEqual(
      expect.arrayContaining(["currentFile", "rules", "tree", "codebase"]),
    );
  });

  it("does not enable indexing providers for JetBrains hosts", () => {
    const result = loadConfigContextProviders(undefined, false, "jetbrains");
    const titles = result.providers.map(
      (provider) => provider.description.title,
    );

    expect(titles).not.toContain("tree");
    expect(titles).not.toContain("codebase");
  });
});
