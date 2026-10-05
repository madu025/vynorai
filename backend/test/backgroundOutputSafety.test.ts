import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertSafePatch,
  patchPathProblem,
  readSandboxFile,
} from "../src/worker/outputSafety.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-out-"));

test("sandbox output is read only as a bounded plain file", async () => {
  const file = path.join(dir, "proof.json");
  fs.writeFileSync(file, '{"ok":true}');
  assert.equal((await readSandboxFile(file, 1024)).toString(), '{"ok":true}');
  await assert.rejects(readSandboxFile(file, 4), /TOO_LARGE/);
  await assert.rejects(readSandboxFile(dir, 1024), /NOT_A_FILE|EISDIR/);
});

test("a symlinked output file is refused", async (t) => {
  const link = path.join(dir, "patch.json");
  try {
    fs.symlinkSync(path.join(dir, "proof.json"), link);
  } catch {
    t.skip("symlinks need privileges on this OS");
    return;
  }
  await assert.rejects(readSandboxFile(link, 1024));
});

test("patch paths that escape, run code or touch secrets are refused", () => {
  for (const p of [
    "src/app.ts",
    "app/Http/Controllers/UserController.php",
    "github/notes.md",
  ])
    assert.equal(patchPathProblem(p), null, p);
  for (const p of [
    "../x",
    "a/../../x",
    "..\\..\\x",
    "C:/Windows/x",
    "C:\\x",
    "/etc/passwd",
    "a//b",
    "./a",
    "file.txt:stream",
    "evil. ",
  ])
    assert.equal(patchPathProblem(p), "unsafe", p);
  for (const p of [
    ".git/hooks/pre-commit",
    ".GIT/config",
    ".vscode/tasks.json",
    ".github/workflows/deploy.yml",
    ".husky/pre-push",
  ])
    assert.equal(patchPathProblem(p), "protected", p);
  for (const p of [".env", "config/.env.production", "certs/server.key"])
    assert.equal(patchPathProblem(p), "secret", p);
  assert.throws(
    () => assertSafePatch({ files: [{ path: ".git/hooks/post-merge" }] }),
    /PATCH_PATH_PROTECTED/,
  );
  assert.doesNotThrow(() => assertSafePatch({ files: [{ path: "a.ts" }] }));
});
