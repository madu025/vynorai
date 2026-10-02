import { describe, expect, it } from "vitest";

import { skillFrontmatterSchema } from "./loadMarkdownSkills";

describe("markdown skill permission manifest", () => {
  it("accepts only bounded, unique, known capabilities", () => {
    expect(
      skillFrontmatterSchema.parse({
        name: "review",
        description: "Review code",
        permissions: ["workspace-read", "network"],
      }).permissions,
    ).toEqual(["workspace-read", "network"]);
    expect(() =>
      skillFrontmatterSchema.parse({
        name: "bad",
        description: "bad",
        permissions: ["admin"],
      }),
    ).toThrow();
    expect(() =>
      skillFrontmatterSchema.parse({
        name: "duplicate",
        description: "duplicate",
        permissions: ["workspace-read", "workspace-read"],
      }),
    ).toThrow();
  });

  it("defaults legacy skills to no declared permissions", () => {
    expect(
      skillFrontmatterSchema.parse({ name: "legacy", description: "Legacy" })
        .permissions,
    ).toEqual([]);
  });
});
