import type { ApplyState } from "core";
import { describe, expect, it } from "vitest";
import { collectChangedFiles } from "./ChangesStrip";

const state = (over: Partial<ApplyState>): ApplyState => ({
  streamId: "s",
  filepath: "file:///w/src/a.ts",
  status: "done",
  ...over,
});

describe("collectChangedFiles", () => {
  it("shows one row per file in the state of its latest edit", () => {
    const files = collectChangedFiles([
      state({ streamId: "1", status: "closed" }),
      state({ streamId: "2", filepath: "file:///w/b.ts", status: "done" }),
      state({ streamId: "3", status: "done" }),
    ]);
    expect(files.map((f) => [f.name, f.state, f.streamId])).toEqual([
      ["b.ts", "review", "2"],
      ["a.ts", "review", "3"],
    ]);
  });

  it("tells accepted, rejected and still-applying files apart", () => {
    const files = collectChangedFiles([
      state({ filepath: "file:///w/a.ts", status: "closed" }),
      state({ filepath: "file:///w/b.ts", status: "closed", rejected: true }),
      state({ filepath: "file:///w/c.ts", status: "streaming" }),
    ]);
    expect(files.map((f) => f.state)).toEqual([
      "accepted",
      "rejected",
      "applying",
    ]);
  });

  it("ignores states that have no file and decodes encoded names", () => {
    const files = collectChangedFiles([
      state({ filepath: undefined }),
      state({ filepath: "file:///w/My%20Folder/app%20main.ts" }),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("app main.ts");
  });

  it("caps the list at the 30 most recent files", () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      state({ filepath: `file:///w/f${i}.ts`, streamId: String(i) }),
    );
    const files = collectChangedFiles(many);
    expect(files).toHaveLength(30);
    expect(files.at(-1)?.name).toBe("f44.ts");
  });
});
