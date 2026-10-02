import { describe, expect, it } from "vitest";

import { discoverPackageScripts } from "./VerificationDiscovery";

describe("discoverPackageScripts", () => {
  it("returns bounded high-confidence commands without script bodies", () => {
    const result = discoverPackageScripts(
      JSON.stringify({
        scripts: {
          test: "secret-token=do-not-return vitest",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          build: "vite build",
          deploy: "dangerous-command",
        },
      }),
      "pnpm",
      { id: "root-1", name: "app" },
    );

    expect(result.map((item) => item.command)).toEqual([
      "pnpm run test",
      "pnpm run typecheck",
      "pnpm run lint",
      "pnpm run build",
    ]);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(result.every((item) => item.requiresApproval)).toBe(true);
  });

  it("ignores malformed manifests", () => {
    expect(
      discoverPackageScripts("not-json", "npm", {
        id: "root-1",
        name: "app",
      }),
    ).toEqual([]);
  });
});
