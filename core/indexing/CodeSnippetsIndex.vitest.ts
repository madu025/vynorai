import { describe, expect, it } from "vitest";
import { testIde } from "../test/fixtures";
import {
  CodeSnippetsCodebaseIndex,
  extractScriptBlocks,
} from "./CodeSnippetsIndex";

const index = new CodeSnippetsCodebaseIndex(testIde);
const titles = async (file: string, code: string) =>
  (await index.getSnippetsInFile(file, code)).map((s) => s.title);

describe("code map signatures", () => {
  it("PHP methods carry their parameters (Laravel controllers)", async () => {
    const snippets = await index.getSnippetsInFile(
      "file:///app/Http/Controllers/UserController.php",
      `<?php\nclass UserController extends Controller {\n  public function store(Request $request): Response {}\n}\n`,
    );
    expect(snippets.map((s) => s.title)).toEqual(["UserController", "store"]);
    expect(snippets[1].signature).toContain("Request $request");
  });

  it("indexes Kotlin, Swift and Scala", async () => {
    expect(
      await titles(
        "file:///src/UserService.kt",
        `class UserService {\n  fun find(id: Int): User? { return null }\n}`,
      ),
    ).toEqual(["UserService", "find"]);
    expect(
      await titles(
        "file:///src/Foo.swift",
        `class Foo {\n  func run(x: Int) -> Int { return x }\n}`,
      ),
    ).toEqual(["Foo", "run"]);
    expect(
      await titles(
        "file:///src/A.scala",
        `class A {\n  def run(y: Int): Int = y\n}`,
      ),
    ).toEqual(["A", "run"]);
  });

  it("indexes the script of Vue and Svelte files at the right lines", async () => {
    const vue = `<template>\n  <div />\n</template>\n<script setup lang="ts">\nfunction save(user: User) {}\n</script>\n`;
    const snippets = await index.getSnippetsInFile(
      "file:///src/UserForm.vue",
      vue,
    );
    expect(snippets.map((s) => s.title)).toEqual(["save"]);
    expect(snippets[0].startLine).toBe(4);
    expect(
      await titles(
        "file:///src/App.svelte",
        `<script>\nfunction go(a) {}\n</script>\n<h1>Hi</h1>`,
      ),
    ).toEqual(["go"]);
  });

  it("finds every script block and its language", () => {
    const blocks = extractScriptBlocks(
      `<script>\nexport default {}\n</script>\n<script setup lang="ts">\nconst a = 1\n</script>`,
    );
    expect(blocks.map((b) => [b.lang, b.lineOffset])).toEqual([
      ["js", 0],
      ["ts", 3],
    ]);
  });
});
