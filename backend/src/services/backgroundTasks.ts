import crypto from "crypto";
import type { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { getPlan } from "../config.js";
import {
  billingAll as dbAll,
  billingGet as dbGet,
  billingRun as dbRun,
} from "./billingDb.js";
import {
  storeBackgroundArtifact,
  deleteBackgroundArtifact,
  readBackgroundArtifact,
} from "./backgroundArtifacts.js";
import {
  enqueueBackgroundTask,
  queuePosition,
  removeBackgroundTask,
} from "./backgroundQueue.js";
import {
  consumeEstimateQuote,
  estimateInputDigest,
  verifyEstimateQuote,
} from "./backgroundQuote.js";
import {
  BACKGROUND_POLICY_VERSION,
  TERMINAL_BACKGROUND_STATUSES,
  type BackgroundEstimateInput,
  type BackgroundEstimateQuote,
  type BackgroundTaskStatus,
} from "./backgroundTypes.js";
import { encryptCredential } from "./credentialVault.js";
import {
  getActiveSubscription,
  releaseQuotaReservation,
  reserveQuotaAtomic,
  settleQuotaReservation,
  type QuotaReservation,
} from "./monthlyQuota.js";
import { sanitizePayload, sanitizeText } from "./secretSanitizer.js";
import { getRedis } from "./redisStore.js";

const ACTIVE_STATUSES = [
  "awaiting_upload",
  "queued",
  "running",
  "cancel_requested",
];

interface TaskRow {
  id: string;
  user_id: string;
  status: BackgroundTaskStatus;
  language: "si" | "en" | "other";
  project_fingerprint: string;
  manifest_digest: string;
  estimate_credits: number;
  cap_credits: number;
  used_credits: number;
  model_credits: number;
  compute_credits: number;
  refund_credits: number;
  quota_reservation_id?: string;
  priority: number;
  upload_artifact_id?: string;
  patch_artifact_id?: string;
  proof_artifact_id?: string;
  proof?: string;
  failure_reason?: string;
  queued_at?: string;
  heartbeat_at?: string;
  started_at?: string;
  ended_at?: string;
  purge_after?: string;
  purged_at?: string;
  created_at: string;
  updated_at: string;
}

async function activePlanId(userId: string): Promise<string> {
  const subscription = await getActiveSubscription<{ plan_name: string }>(
    userId,
  );
  return subscription?.plan_name || "free";
}

function publicTask(row: TaskRow): Record<string, unknown> {
  let proof: unknown;
  try {
    proof = row.proof ? JSON.parse(row.proof) : undefined;
  } catch {
    proof = undefined;
  }
  return {
    id: row.id,
    status: row.status,
    language: row.language,
    projectFingerprint: row.project_fingerprint,
    manifestDigest: row.manifest_digest,
    estimateCredits: Number(row.estimate_credits),
    capCredits: Number(row.cap_credits),
    billing: {
      usedCredits: Number(row.used_credits),
      modelCredits: Number(row.model_credits),
      computeCredits: Number(row.compute_credits),
      refundCredits: Number(row.refund_credits),
    },
    proof,
    failureReason: row.failure_reason || undefined,
    patchAvailable: Boolean(row.patch_artifact_id && !row.purged_at),
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    purgeAfter: row.purge_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBackgroundEntitlement(userId: string) {
  const planId = await activePlanId(userId);
  const plan = getPlan(planId);
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const usage = await dbGet<{ count: number }>(
    "SELECT COUNT(*) AS count FROM background_tasks WHERE user_id = ? AND created_at >= ?",
    [userId, periodStart.toISOString()],
  );
  const running = await dbGet<{ count: number }>(
    `SELECT COUNT(*) AS count FROM background_tasks WHERE user_id = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`,
    [userId, ...ACTIVE_STATUSES],
  );
  return {
    planId,
    ...plan.background,
    usedThisMonth: Number(usage?.count || 0),
    activeTasks: Number(running?.count || 0),
  };
}

export async function createBackgroundTask(
  args: Parameters<typeof createBackgroundTaskUnlocked>[0],
): Promise<Awaited<ReturnType<typeof createBackgroundTaskUnlocked>>> {
  const redis = await getRedis();
  if (!redis) throw new Error("BACKGROUND_QUEUE_UNAVAILABLE");
  const key = `vynor:bg:v1:create-lock:${args.userId}`;
  const token = crypto.randomUUID();
  if (!(await redis.set(key, token, { NX: true, PX: 15_000 })))
    throw new Error("BACKGROUND_CREATE_IN_PROGRESS");
  try {
    return await createBackgroundTaskUnlocked(args);
  } finally {
    await redis
      .eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        { keys: [key], arguments: [token] },
      )
      .catch(() => {});
  }
}

export async function reconcileExpiredBackgroundUploads(
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - 30 * 60_000).toISOString();
  const rows = await dbAll<TaskRow>(
    "SELECT * FROM background_tasks WHERE status = 'awaiting_upload' AND created_at < ? LIMIT 100",
    [cutoff],
  );
  let released = 0;
  for (const task of rows) {
    const claimed = await dbRun(
      "UPDATE background_tasks SET status = 'failed', failure_reason = 'upload_expired', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'awaiting_upload'",
      [task.id],
    );
    if (!claimed.changes) continue;
    await releaseTaskReservation(task);
    await appendBackgroundEvent(
      task.id,
      "failed",
      "Upload window expired before execution; reserved credits were released",
      {},
    );
    released += 1;
  }
  return released;
}

export function scheduleBackgroundReconciliation(): void {
  const run = () =>
    void reconcileExpiredBackgroundUploads().catch((error) =>
      console.error(
        "[Background] reconciliation failed:",
        error instanceof Error ? error.message : "unknown",
      ),
    );
  setTimeout(run, 60_000).unref();
  setInterval(run, 5 * 60_000).unref();
}

async function createBackgroundTaskUnlocked(args: {
  userId: string;
  input: BackgroundEstimateInput;
  quoteId: string;
  quoteSignature: string;
  capCredits: number;
  idempotencyKey: string;
  consentAccepted: boolean;
  policyVersion: string;
  client: string;
  ipDigest: string;
}): Promise<{
  task: Record<string, unknown>;
  uploadUrl: string;
  uploadExpiresAt: string;
  reused: boolean;
}> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(args.idempotencyKey))
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  const existing = await dbGet<TaskRow>(
    "SELECT * FROM background_tasks WHERE user_id = ? AND idempotency_key = ?",
    [args.userId, args.idempotencyKey],
  );
  if (existing)
    return {
      task: publicTask(existing),
      uploadUrl: `/v1/background/tasks/${existing.id}/upload`,
      uploadExpiresAt: new Date(
        new Date(existing.created_at).getTime() + 30 * 60_000,
      ).toISOString(),
      reused: true,
    };

  const entitlement = await getBackgroundEntitlement(args.userId);
  if (!entitlement.enabled) throw new Error("BACKGROUND_NOT_INCLUDED");
  if (entitlement.usedThisMonth >= entitlement.tasksPerMonth)
    throw new Error("BACKGROUND_MONTHLY_LIMIT");
  if (entitlement.activeTasks >= entitlement.maxConcurrency)
    throw new Error("BACKGROUND_CONCURRENCY_LIMIT");
  if (!args.consentAccepted || args.policyVersion !== BACKGROUND_POLICY_VERSION)
    throw new Error("BACKGROUND_CONSENT_REQUIRED");

  const quote = await consumeEstimateQuote(args.quoteId);
  if (
    !quote ||
    quote.userId !== args.userId ||
    !verifyEstimateQuote(quote, args.quoteSignature)
  )
    throw new Error("INVALID_OR_EXPIRED_QUOTE");
  if (quote.inputDigest !== estimateInputDigest(args.input))
    throw new Error("QUOTE_INPUT_MISMATCH");
  if (
    !Number.isInteger(args.capCredits) ||
    args.capCredits < quote.minimumCapCredits ||
    args.capCredits > quote.maximumCapCredits
  )
    throw new Error("INVALID_CREDIT_CAP");

  const taskId = uuidv4();
  const reservation = await reserveQuotaAtomic(
    args.userId,
    entitlement.planId,
    quote.totalCredits,
    { type: "background_task", id: taskId },
  );
  if (!reservation) throw new Error("INSUFFICIENT_CREDITS");
  const prompt = encryptCredential(args.input.prompt);
  if (!prompt) {
    await releaseQuotaReservation(reservation);
    throw new Error("DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  }
  try {
    await dbRun(
      `INSERT INTO background_tasks
       (id, user_id, status, prompt, language, project_fingerprint, manifest_digest,
        estimate_credits, cap_credits, quota_reservation_id, quote_id, idempotency_key, priority, purge_after)
       VALUES (?, ?, 'awaiting_upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        args.userId,
        prompt,
        args.input.language,
        args.input.projectFingerprint,
        args.input.manifestDigest,
        quote.totalCredits,
        args.capCredits,
        reservation.id || null,
        quote.quoteId,
        args.idempotencyKey,
        entitlement.priority === "high" ? 100 : 0,
        new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      ],
    );
    await dbRun(
      `INSERT INTO background_consent (user_id, policy_version, client, ip_digest)
       VALUES (?, ?, ?, ?) ON CONFLICT(user_id, policy_version) DO NOTHING`,
      [
        args.userId,
        args.policyVersion,
        args.client.slice(0, 64),
        args.ipDigest,
      ],
    );
    await appendBackgroundEvent(
      taskId,
      "created",
      "Background task created and awaiting encrypted upload",
      { estimateCredits: quote.totalCredits, capCredits: args.capCredits },
    );
    await recordBackgroundLedger(
      taskId,
      args.userId,
      "reserve",
      quote.totalCredits,
      `${taskId}:reserve`,
    );
  } catch (error) {
    await releaseQuotaReservation(reservation);
    throw error;
  }
  const row = await requireOwnedTask(args.userId, taskId);
  return {
    task: publicTask(row),
    uploadUrl: `/v1/background/tasks/${taskId}/upload`,
    uploadExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    reused: false,
  };
}

export async function uploadBackgroundProject(
  userId: string,
  taskId: string,
  body: Readable,
): Promise<Record<string, unknown>> {
  const task = await requireOwnedTask(userId, taskId);
  if (task.status !== "awaiting_upload") {
    if (task.upload_artifact_id)
      return {
        task: publicTask(task),
        queuePosition: await queuePosition(task.id),
        reused: true,
      };
    throw new Error("UPLOAD_NOT_ALLOWED");
  }
  const artifact = await storeBackgroundArtifact(
    task.id,
    "upload",
    body,
    Number(process.env.BG_MAX_UPLOAD_BYTES || 100 * 1024 * 1024),
  );
  try {
    const queuedAt = new Date().toISOString();
    await dbRun(
      "UPDATE background_tasks SET status = 'queued', upload_artifact_id = ?, queued_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'awaiting_upload'",
      [artifact.id, queuedAt, task.id],
    );
    await enqueueBackgroundTask(
      task.id,
      Number(task.priority) > 0,
      new Date(queuedAt).getTime(),
    );
    await appendBackgroundEvent(
      task.id,
      "queued",
      "Encrypted project accepted and queued",
      { bytes: artifact.bytes, sha256: artifact.sha256 },
    );
    return {
      task: publicTask(await requireOwnedTask(userId, taskId)),
      artifact,
      queuePosition: await queuePosition(task.id),
    };
  } catch (error) {
    await dbRun(
      "UPDATE background_tasks SET status = 'awaiting_upload', upload_artifact_id = NULL WHERE id = ?",
      [task.id],
    ).catch(() => {});
    await deleteBackgroundArtifact(artifact.id).catch(() => {});
    throw error;
  }
}

export async function listBackgroundTasks(
  userId: string,
  limit = 20,
  status?: string,
  cursor?: string,
) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const params: unknown[] = [userId];
  let where = "user_id = ?";
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }
  if (cursor) {
    where += " AND created_at < ?";
    params.push(cursor);
  }
  params.push(safeLimit + 1);
  const rows = await dbAll<TaskRow>(
    `SELECT * FROM background_tasks WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  const hasMore = rows.length > safeLimit;
  const page = rows.slice(0, safeLimit);
  return {
    tasks: page.map(publicTask),
    nextCursor: hasMore ? page[page.length - 1]?.created_at : null,
  };
}

export async function getBackgroundTask(
  userId: string,
  taskId: string,
  afterSequence = 0,
) {
  const task = await requireOwnedTask(userId, taskId);
  const events = await dbAll(
    "SELECT sequence, event_type, message, data, created_at FROM background_task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 200",
    [taskId, Math.max(0, afterSequence)],
  );
  return {
    task: publicTask(task),
    queuePosition:
      task.status === "queued" ? await queuePosition(task.id) : null,
    events: events.map(parseEvent),
  };
}

export async function cancelBackgroundTask(userId: string, taskId: string) {
  const task = await requireOwnedTask(userId, taskId);
  if (TERMINAL_BACKGROUND_STATUSES.has(task.status))
    return { task: publicTask(task), signaled: false };
  if (task.status === "running" || task.status === "cancel_requested") {
    await dbRun(
      "UPDATE background_tasks SET status = 'cancel_requested', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [task.id],
    );
    await appendBackgroundEvent(
      task.id,
      "cancel_requested",
      "Cancellation requested",
      {},
    );
    return {
      task: publicTask(await requireOwnedTask(userId, taskId)),
      signaled: true,
    };
  }
  await removeBackgroundTask(task.id).catch(() => {});
  await dbRun(
    "UPDATE background_tasks SET status = 'canceled', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [task.id],
  );
  await releaseTaskReservation(task);
  await appendBackgroundEvent(
    task.id,
    "canceled",
    "Task canceled before execution",
    {},
  );
  return {
    task: publicTask(await requireOwnedTask(userId, taskId)),
    signaled: false,
  };
}

export async function purgeBackgroundTask(userId: string, taskId: string) {
  await cancelBackgroundTask(userId, taskId);
  const task = await requireOwnedTask(userId, taskId);
  for (const id of [
    task.upload_artifact_id,
    task.patch_artifact_id,
    task.proof_artifact_id,
  ])
    if (id) await deleteBackgroundArtifact(id).catch(() => {});
  const now = new Date().toISOString();
  await dbRun(
    "UPDATE background_tasks SET status = 'purged', prompt = NULL, proof = NULL, deleted_at = ?, purged_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [now, now, task.id],
  );
  return { taskId, purgedAt: now, workspaceDeletedAt: task.ended_at || now };
}

export async function getBackgroundPatch(
  userId: string,
  taskId: string,
): Promise<Buffer> {
  const task = await requireOwnedTask(userId, taskId);
  if (!task.patch_artifact_id || task.purged_at)
    throw new Error("PATCH_NOT_AVAILABLE");
  return readBackgroundArtifact(
    task.patch_artifact_id,
    Number(process.env.BG_MAX_PATCH_BYTES || 50 * 1024 * 1024),
  );
}

export async function appendBackgroundEvent(
  taskId: string,
  eventType: string,
  message: string,
  data: unknown,
): Promise<number> {
  const cleanMessage = sanitizeText(message).text.slice(0, 2_000);
  const cleanData = JSON.stringify(sanitizePayload(data).sanitized).slice(
    0,
    16_000,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await dbGet<{ sequence: number }>(
      "SELECT MAX(sequence) AS sequence FROM background_task_events WHERE task_id = ?",
      [taskId],
    );
    const sequence = Number(last?.sequence || 0) + 1;
    try {
      await dbRun(
        "INSERT INTO background_task_events (id, task_id, sequence, event_type, message, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          uuidv4(),
          taskId,
          sequence,
          eventType.slice(0, 64),
          cleanMessage,
          cleanData,
        ],
      );
      return sequence;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("EVENT_APPEND_FAILED");
}

async function requireOwnedTask(
  userId: string,
  taskId: string,
): Promise<TaskRow> {
  const row = await dbGet<TaskRow>(
    "SELECT * FROM background_tasks WHERE id = ? AND user_id = ?",
    [taskId, userId],
  );
  if (!row) throw new Error("BACKGROUND_TASK_NOT_FOUND");
  return row;
}

function parseEvent(row: any) {
  try {
    return { ...row, data: JSON.parse(row.data) };
  } catch {
    return { ...row, data: {} };
  }
}

async function releaseTaskReservation(task: TaskRow): Promise<void> {
  if (!task.quota_reservation_id) return;
  const hold = await dbGet<{ tokens: number; requests: number }>(
    "SELECT tokens, requests FROM quota_reservations WHERE id = ?",
    [task.quota_reservation_id],
  );
  if (!hold) return;
  const reservation: QuotaReservation = {
    id: task.quota_reservation_id,
    userId: task.user_id,
    reservedTokens: Number(hold.tokens),
    reservedRequests: Number(hold.requests),
    settled: false,
    ownerType: "background_task",
    ownerId: task.id,
  };
  await releaseQuotaReservation(reservation);
  await recordBackgroundLedger(
    task.id,
    task.user_id,
    "release",
    Number(task.estimate_credits),
    `${task.id}:release`,
  );
}

export async function settleBackgroundTaskReservation(
  task: TaskRow,
  netCredits: number,
): Promise<void> {
  if (!task.quota_reservation_id) return;
  const hold = await dbGet<{ tokens: number; requests: number }>(
    "SELECT tokens, requests FROM quota_reservations WHERE id = ?",
    [task.quota_reservation_id],
  );
  if (!hold) return;
  await settleQuotaReservation(
    {
      id: task.quota_reservation_id,
      userId: task.user_id,
      reservedTokens: Number(hold.tokens),
      reservedRequests: Number(hold.requests),
      settled: false,
      ownerType: "background_task",
      ownerId: task.id,
    },
    netCredits,
  );
}

export async function recordBackgroundLedger(
  taskId: string,
  userId: string,
  eventType: string,
  credits: number,
  idempotencyKey: string,
  metadata: unknown = {},
): Promise<void> {
  await dbRun(
    `INSERT INTO background_billing_ledger (id, task_id, user_id, event_type, credits, idempotency_key, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    [
      uuidv4(),
      taskId,
      userId,
      eventType,
      Math.floor(credits),
      idempotencyKey,
      JSON.stringify(metadata),
    ],
  );
}

export function hashClientIp(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(`${process.env.BG_IP_HASH_SALT || "local"}:${ip}`)
    .digest("hex");
}

export type { TaskRow, BackgroundEstimateQuote };
