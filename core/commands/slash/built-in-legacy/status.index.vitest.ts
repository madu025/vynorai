import { describe, expect, it, vi } from "vitest";

const shared = { disableIndexing: undefined as boolean | undefined };
vi.mock("../../../util/GlobalContext.js", () => ({
  GlobalContext: class {
    getSharedConfig() {
      return shared;
    }
  },
}));

import { StatusCommand } from "./status";

async function status(disableIndexing: boolean) {
  const ide = {
    getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///w/alpha"]),
    getCurrentFile: vi.fn().mockResolvedValue(undefined),
    getBranch: vi.fn().mockResolvedValue("main"),
    isWorkspaceTrusted: vi.fn().mockResolvedValue(true),
  };
  const parts: string[] = [];
  for await (const part of StatusCommand.run({
    ide,
    config: {
      selectedModelByRole: { chat: { title: "VynorAI Auto" } },
      disableIndexing,
      rules: [],
    },
  } as any)) {
    if (typeof part === "string") parts.push(part);
  }
  return parts.join("");
}

describe("/status explains why indexing is off", () => {
  it("says nothing extra while indexing is enabled", async () => {
    shared.disableIndexing = true; // irrelevant when the loaded config has it enabled
    expect(await status(false)).toContain("Codebase index: enabled");
  });

  it("points at the shared settings when they are the cause", async () => {
    shared.disableIndexing = true;
    const text = await status(true);
    expect(text).toContain(
      "Codebase index: disabled (turned off in the shared settings",
    );
    expect(text).toContain("index/globalContext.json");
    expect(text).toContain("do not override it");
  });

  it("blames the config when the shared settings are not the cause", async () => {
    shared.disableIndexing = undefined;
    expect(await status(true)).toContain(
      "disabled (config sets disableIndexing)",
    );
  });
});
