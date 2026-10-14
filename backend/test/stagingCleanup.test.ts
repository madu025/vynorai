import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanupStaleStaging } from "../src/worker/stagingCleanup.js";

const oldTask = "11111111-1111-4111-8111-111111111111";
const activeTask = "22222222-2222-4222-8222-222222222222";
const youngTask = "33333333-3333-4333-8333-333333333333";

test("staging cleanup removes only old inactive task directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vynor-staging-"));
  const now = Date.now();
  await Promise.all(
    [oldTask, activeTask, youngTask].map((id) =>
      fs.mkdir(path.join(root, id), { recursive: true }),
    ),
  );
  await fs.writeFile(path.join(root, "keep.txt"), "not a task directory");
  await fs.utimes(
    path.join(root, oldTask),
    new Date(now - 3_600_000),
    new Date(now - 3_600_000),
  );
  const result = await cleanupStaleStaging({
    root,
    activeTaskIds: new Set([activeTask]),
    now,
    graceMs: 60_000,
  });
  assert.deepEqual(result.removed, [oldTask]);
  assert.deepEqual(result.skippedActive, [activeTask]);
  assert.deepEqual(result.skippedYoung, [youngTask]);
  assert.equal(
    await fs.stat(path.join(root, "keep.txt")).then(() => true),
    true,
  );
  await assert.rejects(fs.stat(path.join(root, oldTask)));
  await fs.rm(root, { recursive: true, force: true });
});

test("staging cleanup never removes an active task even when it is old", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vynor-staging-"));
  const now = Date.now();
  await fs.mkdir(path.join(root, activeTask));
  await fs.utimes(
    path.join(root, activeTask),
    new Date(now - 3_600_000),
    new Date(now - 3_600_000),
  );
  const result = await cleanupStaleStaging({
    root,
    activeTaskIds: new Set([activeTask]),
    now,
    graceMs: 0,
  });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.skippedActive, [activeTask]);
  await fs.rm(root, { recursive: true, force: true });
});
