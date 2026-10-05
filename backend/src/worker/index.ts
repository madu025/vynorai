import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { initDb } from "../db.js";
import {
  billingGet as dbGet,
  billingRun as dbRun,
} from "../services/billingDb.js";
import { getRedis } from "../services/redisStore.js";
import {
  claimBackgroundTask,
  enqueueBackgroundTask,
  removeBackgroundTask,
  requeueExpiredBackgroundLeases,
  renewBackgroundLease,
  restoreBackgroundLease,
} from "../services/backgroundQueue.js";
import {
  deleteBackgroundArtifact,
  readBackgroundArtifact,
  storeBackgroundBuffer,
} from "../services/backgroundArtifacts.js";
import {
  appendBackgroundEvent,
  recordBackgroundLedger,
  settleBackgroundTaskReservation,
  type TaskRow,
} from "../services/backgroundTasks.js";
import { decryptCredential } from "../services/credentialVault.js";
import { mintBackgroundModelToken } from "../services/backgroundModelToken.js";
import type { BackgroundProofPackV1 } from "../services/backgroundTypes.js";
import { sendBackgroundPush } from "../services/backgroundNotifications.js";
import { cancelSandbox, launchSandbox } from "./launcherClient.js";
import { assertSafePatch, readSandboxFile } from "./outputSafety.js";

const workerId = `${os.hostname()}:${process.pid}`;
const leaseMs = 90_000;
const pollMs = 1_500;

async function prepareTask(
  taskId: string,
): Promise<{ task: TaskRow; staging: string }> {
  const task = await dbGet<TaskRow>(
    "SELECT * FROM background_tasks WHERE id = ?",
    [taskId],
  );
  if (!task || task.status !== "queued" || !task.upload_artifact_id)
    throw new Error("TASK_NOT_CLAIMABLE");
  const claimed = await dbRun(
    `UPDATE background_tasks SET status = 'running', worker_id = ?, lease_id = ?,
     started_at = COALESCE(started_at, CURRENT_TIMESTAMP), heartbeat_at = CURRENT_TIMESTAMP,
     updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'`,
    [workerId, `${workerId}:${Date.now()}`, task.id],
  );
  if (claimed.changes === 0) throw new Error("TASK_NOT_CLAIMABLE");
  const root = path.resolve(
    process.env.BG_STAGING_DIR || "/var/lib/vynor-background/staging",
  );
  const staging = path.join(root, task.id);
  if (!staging.startsWith(`${root}${path.sep}`))
    throw new Error("INVALID_STAGING_PATH");
  await fs.promises.mkdir(staging, { recursive: true, mode: 0o700 });
  const archive = await readBackgroundArtifact(
    task.upload_artifact_id,
    Number(process.env.BG_MAX_UPLOAD_BYTES || 100 * 1024 * 1024),
  );
  await fs.promises.writeFile(path.join(staging, "project.zip"), archive, {
    flag: "wx",
    mode: 0o600,
  });
  const prompt = decryptCredential(
    (
      await dbGet<{ prompt: string }>(
        "SELECT prompt FROM background_tasks WHERE id = ?",
        [task.id],
      )
    )?.prompt,
  );
  if (!prompt) throw new Error("TASK_PROMPT_UNAVAILABLE");
  await fs.promises.writeFile(path.join(staging, "prompt.txt"), prompt, {
    flag: "wx",
    mode: 0o600,
  });
  await fs.promises.mkdir(path.join(staging, "output"), { mode: 0o700 });
  return { task: { ...task, status: "running" }, staging };
}

async function runTask(taskId: string): Promise<void> {
  let task: TaskRow | undefined;
  let staging: string | undefined;
  const heartbeat = setInterval(() => {
    void renewBackgroundLease(taskId, leaseMs);
    void dbRun(
      "UPDATE background_tasks SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'",
      [taskId],
    );
    void dbGet<{ status: string }>(
      "SELECT status FROM background_tasks WHERE id = ?",
      [taskId],
    )
      .then((row) => {
        if (row?.status === "cancel_requested") return cancelSandbox(taskId);
      })
      .catch(() => {});
  }, 30_000);
  heartbeat.unref();
  try {
    ({ task, staging } = await prepareTask(taskId));
    await appendBackgroundEvent(
      task.id,
      "running",
      "Isolated gVisor sandbox starting",
      { workerId },
    );
    const token = mintBackgroundModelToken(task.id, task.user_id);
    const result = await launchSandbox({
      version: 1,
      taskId: task.id,
      inputArchive: path.join(staging, "project.zip"),
      outputDirectory: path.join(staging, "output"),
      modelRelayUrl:
        process.env.BG_SANDBOX_MODEL_URL ||
        "http://vynor-bg-egress:8080/model/v1/chat/completions",
      modelToken: token,
      cacheKey: crypto
        .createHash("sha256")
        .update(`${task.user_id}:${task.manifest_digest}`)
        .digest("hex"),
      limits: {
        runtimeSeconds: Number(process.env.BG_TASK_TIMEOUT_MINUTES || 45) * 60,
        memoryMb: Math.min(1536, Number(process.env.BG_TASK_MEMORY_MB || 1536)),
        cpus: Math.min(1, Number(process.env.BG_TASK_CPUS || 1)),
        pids: Math.min(512, Number(process.env.BG_TASK_PIDS || 512)),
        diskMb: Math.min(2048, Number(process.env.BG_TASK_DISK_MB || 2048)),
      },
    });
    await finalizeTask(task, staging, result);
  } catch (error) {
    const reason = (
      error instanceof Error ? error.message : "WORKER_ERROR"
    ).slice(0, 128);
    if (task) await finalizeFailure(task, reason);
    else
      await dbRun(
        "UPDATE background_tasks SET status = 'queued', worker_id = NULL, lease_id = NULL WHERE id = ? AND status = 'running'",
        [taskId],
      ).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    await removeBackgroundTask(taskId).catch(() => {});
    if (task?.upload_artifact_id)
      await deleteBackgroundArtifact(task.upload_artifact_id).catch(() => {});
    if (staging) await safeRemoveStaging(staging);
  }
}

async function finalizeTask(
  task: TaskRow,
  staging: string,
  result: Awaited<ReturnType<typeof launchSandbox>>,
) {
  const output = path.join(staging, "output");
  const proofRaw = await readSandboxFile(
    path.join(output, "proof.json"),
    2 * 1024 * 1024,
  );
  const proof = JSON.parse(proofRaw.toString("utf8")) as BackgroundProofPackV1;
  if (proof.version !== 1 || proof.taskId !== task.id)
    throw new Error("INVALID_PROOF_PACK");
  const unsignedPatchRaw = await readSandboxFile(
    path.join(output, "patch.json"),
    Number(process.env.BG_MAX_PATCH_BYTES || 50 * 1024 * 1024),
  );
  const patchBundle = JSON.parse(unsignedPatchRaw.toString("utf8"));
  // Never sign a patch that writes git hooks, editor tasks, CI workflows,
  // credentials or paths outside the project; the IDE checks again.
  assertSafePatch(patchBundle);
  const privateKey = Buffer.from(
    requiredWorkerSecret("BG_PATCH_SIGNING_PRIVATE_KEY_BASE64"),
    "base64",
  ).toString("utf8");
  const signedDigest = crypto
    .createHash("sha256")
    .update(unsignedPatchRaw)
    .digest();
  patchBundle.signature = {
    algorithm: "Ed25519",
    keyId: process.env.BG_PATCH_SIGNING_KEY_ID || "vynor-bg-1",
    digest: signedDigest.toString("hex"),
    value: crypto.sign(null, signedDigest, privateKey).toString("base64"),
  };
  const patchRaw = Buffer.from(JSON.stringify(patchBundle));
  const patch = await storeBackgroundBuffer(
    task.id,
    "patch",
    patchRaw,
    Number(process.env.BG_MAX_PATCH_BYTES || 50 * 1024 * 1024),
  );
  const elapsedSeconds = Math.max(
    1,
    (new Date(result.finishedAt).getTime() -
      new Date(result.startedAt).getTime()) /
      1000,
  );
  const compute =
    Math.ceil(elapsedSeconds / 60) *
    Math.ceil(Number(process.env.BG_COMPUTE_CREDITS_PER_HOUR || 100_000) / 60);
  const latest = (await dbGet<TaskRow>(
    "SELECT * FROM background_tasks WHERE id = ?",
    [task.id],
  ))!;
  const allowedCompute = Math.max(
    0,
    Math.min(
      compute,
      Number(latest.cap_credits) - Number(latest.model_credits),
    ),
  );
  const completed = result.exitCode === 0 && proof.status === "completed";
  const canceled = result.reason === "canceled" || proof.status === "canceled";
  const gross = Number(latest.model_credits) + allowedCompute;
  const refund = completed || canceled ? 0 : Math.floor(gross * 0.5);
  const net = gross - refund;
  proof.billing = {
    estimateCredits: Number(latest.estimate_credits),
    capCredits: Number(latest.cap_credits),
    modelCredits: Number(latest.model_credits),
    computeCredits: allowedCompute,
    grossUsedCredits: gross,
    refundCredits: refund,
    netChargedCredits: net,
  };
  proof.deletionReceipt = {
    workspaceDeletedAt: result.workspaceDeletedAt,
    retainedUntil:
      latest.purge_after ||
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    artifactIds: [patch.id],
  };
  const finalProofRaw = Buffer.from(JSON.stringify(proof));
  const proofArtifact = await storeBackgroundBuffer(
    task.id,
    "proof",
    finalProofRaw,
    2 * 1024 * 1024,
  );
  proof.deletionReceipt.artifactIds.push(proofArtifact.id);
  await settleBackgroundTaskReservation(latest, net);
  await recordBackgroundLedger(
    task.id,
    task.user_id,
    "settle",
    net,
    `${task.id}:settle`,
    { gross, refund },
  );
  await dbRun(
    `UPDATE background_tasks SET status = ?, used_credits = ?, compute_credits = ?, refund_credits = ?,
     patch_artifact_id = ?, proof_artifact_id = ?, proof = ?, failure_reason = ?, ended_at = ?,
     workspace_deleted_at = ?, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('running','cancel_requested')`,
    [
      completed ? "completed" : canceled ? "canceled" : "failed",
      net,
      allowedCompute,
      refund,
      patch.id,
      proofArtifact.id,
      JSON.stringify(proof),
      completed ? null : result.reason.slice(0, 128),
      result.finishedAt,
      result.workspaceDeletedAt,
      task.id,
    ],
  );
  await appendBackgroundEvent(
    task.id,
    completed ? "completed" : "failed",
    completed
      ? "Background task completed with Proof Pack"
      : "Background task failed; eligible usage received a 50% refund",
    { netCredits: net, refundCredits: refund },
  );
  const checks = proof.verification || [];
  await sendBackgroundPush(task.user_id, {
    taskId: task.id,
    status: completed ? "completed" : canceled ? "canceled" : "failed",
    passed: checks.filter((item) => item.classification === "passed").length,
    total: checks.length,
    highestRisk: proof.risks.find((item) => item.severity === "high")?.summary,
  });
}

async function finalizeFailure(task: TaskRow, reason: string) {
  const latest =
    (await dbGet<TaskRow>("SELECT * FROM background_tasks WHERE id = ?", [
      task.id,
    ])) || task;
  const gross =
    Number(latest.model_credits || 0) + Number(latest.compute_credits || 0);
  const refund = Math.floor(gross * 0.5);
  const net = gross - refund;
  await settleBackgroundTaskReservation(latest, net);
  await recordBackgroundLedger(
    task.id,
    task.user_id,
    "settle",
    net,
    `${task.id}:settle`,
    { gross, refund, reason },
  );
  await dbRun(
    "UPDATE background_tasks SET status = 'failed', used_credits = ?, refund_credits = ?, failure_reason = ?, ended_at = CURRENT_TIMESTAMP, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('running','cancel_requested')",
    [net, refund, reason, task.id],
  );
  await appendBackgroundEvent(
    task.id,
    "failed",
    "Worker or sandbox failure; eligible usage received a 50% refund",
    { code: reason, refundCredits: refund },
  );
}

async function finalizeCanceled(task: TaskRow, reason: string) {
  const latest =
    (await dbGet<TaskRow>("SELECT * FROM background_tasks WHERE id = ?", [
      task.id,
    ])) || task;
  const gross =
    Number(latest.model_credits || 0) + Number(latest.compute_credits || 0);
  await settleBackgroundTaskReservation(latest, gross);
  await recordBackgroundLedger(
    task.id,
    task.user_id,
    "settle",
    gross,
    `${task.id}:settle`,
    { gross, refund: 0, reason },
  );
  await dbRun(
    "UPDATE background_tasks SET status = 'canceled', used_credits = ?, refund_credits = 0, failure_reason = ?, ended_at = CURRENT_TIMESTAMP, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('running','cancel_requested')",
    [gross, reason, task.id],
  );
  await appendBackgroundEvent(
    task.id,
    "canceled",
    "Task canceled; actual usage was charged and unused credits released",
    { netCredits: gross },
  );
}

async function safeRemoveStaging(staging: string) {
  const root = path.resolve(
    process.env.BG_STAGING_DIR || "/var/lib/vynor-background/staging",
  );
  const resolved = path.resolve(staging);
  if (!resolved.startsWith(`${root}${path.sep}`) || resolved === root)
    throw new Error("REFUSED_STAGING_DELETE");
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

async function workerSlot(slot: number) {
  while (true) {
    try {
      if (!(await hostCanAdmitTask())) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      const taskId = await claimBackgroundTask(
        `${workerId}:${slot}`,
        leaseMs,
        Number(process.env.BG_MAX_CONCURRENCY || 2),
      );
      if (taskId) await runTask(taskId);
      else await new Promise((resolve) => setTimeout(resolve, pollMs));
    } catch (error) {
      console.error(
        "[BackgroundWorker] slot error:",
        error instanceof Error ? error.message : "unknown",
      );
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

async function hostCanAdmitTask(): Promise<boolean> {
  const availableMb = os.freemem() / 1024 / 1024;
  if (availableMb < Number(process.env.BG_MIN_AVAILABLE_MB || 1800))
    return false;
  const root = path.resolve(
    process.env.BG_STAGING_DIR || "/var/lib/vynor-background/staging",
  );
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const disk = await fs.promises.statfs(root);
  const availableDiskMb =
    (Number(disk.bavail) * Number(disk.bsize)) / 1024 / 1024;
  return (
    availableDiskMb >= Number(process.env.BG_MIN_AVAILABLE_DISK_MB || 4096)
  );
}

async function reconcile() {
  const expired = await requeueExpiredBackgroundLeases();
  for (const taskId of expired) {
    const task = await dbGet<TaskRow>(
      "SELECT * FROM background_tasks WHERE id = ?",
      [taskId],
    );
    if (!task || !["running", "cancel_requested"].includes(task.status))
      continue;
    if (
      task.status === "running" &&
      task.heartbeat_at &&
      Date.now() - new Date(task.heartbeat_at).getTime() < 75_000
    ) {
      await restoreBackgroundLease(taskId, leaseMs);
      continue;
    }
    if (task.status === "cancel_requested") {
      await finalizeCanceled(task, "stale_worker_after_cancel");
      continue;
    }
    await dbRun(
      "UPDATE background_tasks SET status = 'queued', worker_id = NULL, lease_id = NULL, failure_reason = 'stale_worker_requeued' WHERE id = ? AND status = 'running'",
      [taskId],
    );
    await enqueueBackgroundTask(taskId, Number(task.priority) > 0);
  }
}

async function start() {
  if (process.env.BG_ENABLED !== "true")
    throw new Error("BG_ENABLED must be true to start the worker");
  for (const name of [
    "DATA_ENCRYPTION_KEY",
    "BG_ARTIFACT_MASTER_KEY",
    "BG_MODEL_TOKEN_SECRET",
    "BG_PATCH_SIGNING_PRIVATE_KEY_BASE64",
  ])
    if (!process.env[name])
      throw new Error(`${name} is required by the background worker`);
  await initDb();
  if (!(await getRedis()))
    throw new Error("Redis is required for the background worker");
  await reconcile();
  setInterval(
    () =>
      void reconcile().catch((error) =>
        console.error("[BackgroundWorker] reconcile failed:", error.message),
      ),
    30_000,
  ).unref();
  const slots = Math.max(
    1,
    Math.min(2, Number(process.env.BG_MAX_CONCURRENCY || 2)),
  );
  await Promise.all(
    Array.from({ length: slots }, (_, slot) => workerSlot(slot)),
  );
}

function requiredWorkerSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the background worker`);
  return value;
}

start().catch((error) => {
  console.error(
    "[BackgroundWorker] fatal:",
    error instanceof Error ? error.message : "unknown",
  );
  process.exit(1);
});
