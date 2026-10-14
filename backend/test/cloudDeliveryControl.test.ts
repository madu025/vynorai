import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-cloud-delivery-"));
const originalCwd = process.cwd();
let dbm: typeof import("../src/db.js");
let control: typeof import("../src/services/cloudDeliveryControl.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.DB_DRIVER = "sqlite";
  delete process.env.DATABASE_URL;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  control = await import("../src/services/cloudDeliveryControl.js");
});

after(async () => {
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
});

const sha = "a".repeat(64);
const baseInput = {
  taskId: "task-cloud-1",
  owner: "vynor",
  repo: "VynorAI",
  baseBranch: "main",
  headBranch: "cloud/task-cloud-1",
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  mode: "pr_only" as const,
  verificationDigest: sha,
};

test("cloud delivery control persists ordered state and matching approval", async () => {
  let manifest = await control.createAndPersistCloudDeliveryManifest(baseInput);
  for (const state of ["sandboxed", "verified", "awaiting_approval"] as const) {
    manifest = await control.transitionAndPersistCloudDelivery(
      manifest.runId,
      state,
    );
  }

  await assert.rejects(
    () =>
      control.approveAndPersistCloudDelivery(manifest.runId, {
        actor: "admin@vynor.lk",
        scope: "cloud-pr",
        approvedAt: new Date().toISOString(),
        receiptDigest: "d".repeat(64),
      }),
    /CLOUD_APPROVAL_EVIDENCE_MISMATCH/,
  );

  manifest = await control.approveAndPersistCloudDelivery(manifest.runId, {
    actor: "admin@vynor.lk",
    scope: "cloud-pr",
    approvedAt: new Date().toISOString(),
    receiptDigest: sha,
  });
  assert.equal(manifest.state, "approved");
  assert.deepEqual(
    (await control.getCloudDeliveryManifest(manifest.runId))?.transitions.map(
      (entry) => entry.state,
    ),
    ["created", "sandboxed", "verified", "awaiting_approval", "approved"],
  );
});

test("cloud delivery rejects invalid revisions and out-of-order transitions", async () => {
  assert.throws(
    () =>
      control.createCloudDeliveryManifest({
        ...baseInput,
        baseSha: "not-a-sha",
      }),
    /INVALID_CLOUD_REVISION/,
  );
  const manifest = control.createCloudDeliveryManifest(baseInput);
  assert.throws(
    () => control.transitionCloudDelivery(manifest, "pr_created"),
    /INVALID_CLOUD_TRANSITION_created_TO_pr_created/,
  );
  assert.throws(
    () => control.transitionCloudDelivery(manifest, "approved"),
    /INVALID_CLOUD_TRANSITION_created_TO_approved/,
  );
});

test("PR-only mode cannot cross the deployment gate", async () => {
  let manifest = await control.createAndPersistCloudDeliveryManifest(baseInput);
  for (const state of ["sandboxed", "verified", "awaiting_approval"] as const)
    manifest = await control.transitionAndPersistCloudDelivery(
      manifest.runId,
      state,
    );
  manifest = await control.approveAndPersistCloudDelivery(manifest.runId, {
    actor: "admin@vynor.lk",
    scope: "cloud-pr",
    approvedAt: new Date().toISOString(),
    receiptDigest: sha,
  });
  manifest = await control.transitionAndPersistCloudDelivery(
    manifest.runId,
    "pushed",
  );
  manifest = await control.transitionAndPersistCloudDelivery(
    manifest.runId,
    "pr_created",
  );
  await assert.rejects(
    () =>
      control.transitionAndPersistCloudDelivery(
        manifest.runId,
        "staging_deployed",
        {
          artifactDigest: sha,
          deploymentTarget: "staging",
          healthDigest: sha,
          ready: true,
          smokePassed: true,
          logErrorsFree: true,
        },
      ),
    /CLOUD_STAGING_NOT_ENABLED/,
  );
});
