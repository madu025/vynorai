import { createHash, randomUUID } from "node:crypto";
import { billingGet, billingAll, billingRun } from "./billingDb.js";
import { assertStagingEvidence } from "./cloudDeploymentGate.js";

export type CloudDeliveryMode =
  | "pr_only"
  | "staging_auto_deploy"
  | "production_canary"
  | "production_auto_deploy";

export type CloudDeliveryState =
  | "created"
  | "sandboxed"
  | "verified"
  | "awaiting_approval"
  | "approved"
  | "pushed"
  | "pr_created"
  | "staging_deployed"
  | "canary_verified"
  | "deployed"
  | "failed"
  | "rolled_back";

export interface CloudDeliveryApproval {
  actor: string;
  scope: string;
  approvedAt: string;
  receiptDigest: string;
}

export interface CloudDeliveryManifest {
  version: 1;
  policyVersion: "2026-10-14.v1";
  runId: string;
  taskId: string;
  repository: { owner: string; repo: string };
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  rollbackSha: string;
  mode: CloudDeliveryMode;
  state: CloudDeliveryState;
  verificationDigest: string;
  capabilityDigest: string;
  approval?: CloudDeliveryApproval;
  artifactDigest?: string;
  artifactAttestationDigest?: string;
  deploymentTarget?: string;
  healthDigest?: string;
  transitions: Array<{ state: CloudDeliveryState; at: string }>;
  createdAt: string;
  updatedAt: string;
}

const SHA = /^[a-f0-9]{40,64}$/i;
const UUID = /^[0-9a-f-]{36}$/i;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,190}$/;
const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}$/;
const MODES = new Set<CloudDeliveryMode>([
  "pr_only",
  "staging_auto_deploy",
  "production_canary",
  "production_auto_deploy",
]);
const STATES = new Set<CloudDeliveryState>([
  "created",
  "sandboxed",
  "verified",
  "awaiting_approval",
  "approved",
  "pushed",
  "pr_created",
  "staging_deployed",
  "canary_verified",
  "deployed",
  "failed",
  "rolled_back",
]);
const TRANSITIONS: Record<CloudDeliveryState, CloudDeliveryState[]> = {
  created: ["sandboxed", "failed"],
  sandboxed: ["verified", "failed"],
  verified: ["awaiting_approval", "failed"],
  awaiting_approval: ["approved", "failed"],
  approved: ["pushed", "failed", "rolled_back"],
  pushed: ["pr_created", "failed", "rolled_back"],
  pr_created: ["staging_deployed", "failed", "rolled_back"],
  staging_deployed: ["canary_verified", "failed", "rolled_back"],
  canary_verified: ["deployed", "failed", "rolled_back"],
  deployed: ["rolled_back"],
  failed: ["rolled_back"],
  rolled_back: [],
};

function text(value: unknown, label: string, max = 256): string {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new Error(`INVALID_CLOUD_${label}`);
  return result;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertApproval(approval: CloudDeliveryApproval): void {
  text(approval.actor, "APPROVAL_ACTOR", 160);
  text(approval.scope, "APPROVAL_SCOPE", 500);
  const approvedAt = Date.parse(approval.approvedAt);
  if (!Number.isFinite(approvedAt))
    throw new Error("INVALID_CLOUD_APPROVAL_TIME");
  if (approvedAt > Date.now() + 60_000)
    throw new Error("CLOUD_APPROVAL_TIME_IN_FUTURE");
  if (Date.now() - approvedAt > 24 * 60 * 60 * 1000)
    throw new Error("CLOUD_APPROVAL_EXPIRED");
  if (!SHA.test(approval.receiptDigest))
    throw new Error("INVALID_CLOUD_APPROVAL_DIGEST");
}

function assertManifestInput(input: {
  taskId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  mode: CloudDeliveryMode;
  verificationDigest: string;
  capabilityDigest?: string;
  runId?: string;
  now?: string;
}): void {
  if (!OWNER_REPO.test(input.owner) || !OWNER_REPO.test(input.repo))
    throw new Error("INVALID_CLOUD_REPOSITORY");
  if (!BRANCH.test(input.baseBranch) || !BRANCH.test(input.headBranch))
    throw new Error("INVALID_CLOUD_BRANCH");
  if (!SHA.test(input.baseSha) || !SHA.test(input.headSha))
    throw new Error("INVALID_CLOUD_REVISION");
  if (!SHA.test(input.verificationDigest))
    throw new Error("CLOUD_DELIVERY_VERIFICATION_REQUIRED");
  if (input.capabilityDigest && !SHA.test(input.capabilityDigest))
    throw new Error("INVALID_CLOUD_CAPABILITY_DIGEST");
  if (input.runId && !UUID.test(input.runId))
    throw new Error("INVALID_CLOUD_RUN_ID");
  if (input.now && !Number.isFinite(Date.parse(input.now)))
    throw new Error("INVALID_CLOUD_TIME");
  if (!MODES.has(input.mode)) throw new Error("INVALID_CLOUD_MODE");
}

export function createCloudDeliveryManifest(input: {
  taskId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  mode: CloudDeliveryMode;
  verificationDigest: string;
  capabilityDigest?: string;
  runId?: string;
  now?: string;
}): CloudDeliveryManifest {
  assertManifestInput(input);
  const runId = input.runId || randomUUID();
  const now = input.now || new Date().toISOString();
  return {
    version: 1,
    policyVersion: "2026-10-14.v1",
    runId,
    taskId: text(input.taskId, "TASK_ID"),
    repository: { owner: input.owner, repo: input.repo },
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    baseSha: input.baseSha,
    headSha: input.headSha,
    rollbackSha: input.baseSha,
    mode: input.mode,
    state: "created",
    verificationDigest: input.verificationDigest,
    capabilityDigest:
      input.capabilityDigest || digest("default-deny-cloud-capabilities"),
    transitions: [{ state: "created", at: now }],
    createdAt: now,
    updatedAt: now,
  };
}

export function transitionCloudDelivery(
  manifest: CloudDeliveryManifest,
  next: CloudDeliveryState,
  evidence?: {
    artifactDigest?: string;
    artifactAttestationDigest?: string;
    deploymentTarget?: string;
    healthDigest?: string;
    ready?: boolean;
    smokePassed?: boolean;
    logErrorsFree?: boolean;
  },
): CloudDeliveryManifest {
  if (!STATES.has(next) || !TRANSITIONS[manifest.state].includes(next))
    throw new Error(`INVALID_CLOUD_TRANSITION_${manifest.state}_TO_${next}`);
  if (next === "approved" && !manifest.approval)
    throw new Error("CLOUD_APPROVAL_ENDPOINT_REQUIRED");
  if (next === "staging_deployed" && manifest.mode === "pr_only")
    throw new Error("CLOUD_STAGING_NOT_ENABLED");
  if (
    next === "staging_deployed" ||
    next === "canary_verified" ||
    next === "deployed"
  ) {
    const artifactDigest = evidence?.artifactDigest || manifest.artifactDigest;
    const artifactAttestationDigest =
      evidence?.artifactAttestationDigest || manifest.artifactAttestationDigest;
    if (!artifactDigest || !SHA.test(artifactDigest))
      throw new Error("CLOUD_ARTIFACT_EVIDENCE_REQUIRED");
    if (!artifactAttestationDigest || !SHA.test(artifactAttestationDigest))
      throw new Error("CLOUD_ARTIFACT_ATTESTATION_REQUIRED");
    if (manifest.artifactDigest && artifactDigest !== manifest.artifactDigest)
      throw new Error("CLOUD_ARTIFACT_EVIDENCE_MISMATCH");
    if (
      manifest.artifactAttestationDigest &&
      artifactAttestationDigest !== manifest.artifactAttestationDigest
    )
      throw new Error("CLOUD_ARTIFACT_ATTESTATION_MISMATCH");
    if (!evidence?.deploymentTarget || evidence.deploymentTarget.length > 128)
      throw new Error("CLOUD_DEPLOYMENT_TARGET_REQUIRED");
    if (!evidence?.healthDigest || !SHA.test(evidence.healthDigest))
      throw new Error("CLOUD_HEALTH_EVIDENCE_REQUIRED");
    if (next === "staging_deployed")
      assertStagingEvidence({
        artifactDigest,
        deploymentTarget: evidence.deploymentTarget,
        healthDigest: evidence.healthDigest,
        ready: evidence.ready === true,
        smokePassed: evidence.smokePassed === true,
        logErrorsFree: evidence.logErrorsFree === true,
      });
    if (
      (next === "canary_verified" &&
        !["production_canary", "production_auto_deploy"].includes(
          manifest.mode,
        )) ||
      (next === "deployed" && manifest.mode !== "production_auto_deploy")
    )
      throw new Error("CLOUD_DEPLOYMENT_MODE_NOT_ALLOWED");
  }
  if ((next === "pushed" || next === "pr_created") && !manifest.approval)
    throw new Error("CLOUD_ACTION_REQUIRES_APPROVAL");
  const now = new Date().toISOString();
  return {
    ...manifest,
    state: next,
    artifactDigest: evidence?.artifactDigest || manifest.artifactDigest,
    artifactAttestationDigest:
      evidence?.artifactAttestationDigest || manifest.artifactAttestationDigest,
    deploymentTarget: evidence?.deploymentTarget || manifest.deploymentTarget,
    healthDigest: evidence?.healthDigest || manifest.healthDigest,
    transitions: [...manifest.transitions, { state: next, at: now }],
    updatedAt: now,
  };
}

export function approveCloudDelivery(
  manifest: CloudDeliveryManifest,
  approval: CloudDeliveryApproval,
): CloudDeliveryManifest {
  if (manifest.state !== "awaiting_approval")
    throw new Error("CLOUD_APPROVAL_NOT_REQUESTED");
  assertApproval(approval);
  if (approval.receiptDigest !== manifest.verificationDigest)
    throw new Error("CLOUD_APPROVAL_EVIDENCE_MISMATCH");
  return transitionCloudDelivery({ ...manifest, approval }, "approved");
}

function rowToManifest(row: any): CloudDeliveryManifest {
  const manifest: CloudDeliveryManifest = {
    version: 1,
    policyVersion: row.policy_version,
    runId: row.run_id,
    taskId: row.task_id,
    repository: { owner: row.repository_owner, repo: row.repository_name },
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    rollbackSha: row.rollback_sha,
    mode: row.mode,
    state: row.state,
    verificationDigest: row.verification_digest,
    capabilityDigest: row.capability_digest,
    artifactDigest: row.artifact_digest || undefined,
    artifactAttestationDigest: row.artifact_attestation_digest || undefined,
    deploymentTarget: row.deployment_target || undefined,
    healthDigest: row.health_digest || undefined,
    transitions: JSON.parse(row.transitions || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.approval_actor) {
    manifest.approval = {
      actor: row.approval_actor,
      scope: row.approval_scope,
      approvedAt: row.approval_at,
      receiptDigest: row.approval_receipt_digest,
    };
  }
  return manifest;
}

export async function saveCloudDeliveryManifest(
  manifest: CloudDeliveryManifest,
): Promise<void> {
  await billingRun(
    `INSERT INTO cloud_delivery_manifests (
      run_id, task_id, policy_version, repository_owner, repository_name,
      base_branch, head_branch, base_sha, head_sha, rollback_sha, mode, state,
      verification_digest, capability_digest, approval_actor, approval_scope,
      approval_at, approval_receipt_digest, artifact_digest, deployment_target,
      artifact_attestation_digest, health_digest, transitions, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      state = excluded.state,
      approval_actor = excluded.approval_actor,
      approval_scope = excluded.approval_scope,
      approval_at = excluded.approval_at,
      approval_receipt_digest = excluded.approval_receipt_digest,
      artifact_digest = excluded.artifact_digest,
      artifact_attestation_digest = excluded.artifact_attestation_digest,
      deployment_target = excluded.deployment_target,
      health_digest = excluded.health_digest,
      transitions = excluded.transitions,
      updated_at = excluded.updated_at`,
    [
      manifest.runId,
      manifest.taskId,
      manifest.policyVersion,
      manifest.repository.owner,
      manifest.repository.repo,
      manifest.baseBranch,
      manifest.headBranch,
      manifest.baseSha,
      manifest.headSha,
      manifest.rollbackSha,
      manifest.mode,
      manifest.state,
      manifest.verificationDigest,
      manifest.capabilityDigest,
      manifest.approval?.actor || null,
      manifest.approval?.scope || null,
      manifest.approval?.approvedAt || null,
      manifest.approval?.receiptDigest || null,
      manifest.artifactDigest || null,
      manifest.artifactAttestationDigest || null,
      manifest.deploymentTarget || null,
      manifest.healthDigest || null,
      JSON.stringify(manifest.transitions),
      manifest.createdAt,
      manifest.updatedAt,
    ],
  );
}

async function updateCloudDeliveryManifest(
  manifest: CloudDeliveryManifest,
  expectedState: CloudDeliveryState,
): Promise<void> {
  const result = await billingRun(
    `UPDATE cloud_delivery_manifests SET
      state = ?, approval_actor = ?, approval_scope = ?, approval_at = ?,
      approval_receipt_digest = ?, artifact_digest = ?, artifact_attestation_digest = ?, deployment_target = ?,
      health_digest = ?, transitions = ?, updated_at = ?
     WHERE run_id = ? AND state = ?`,
    [
      manifest.state,
      manifest.approval?.actor || null,
      manifest.approval?.scope || null,
      manifest.approval?.approvedAt || null,
      manifest.approval?.receiptDigest || null,
      manifest.artifactDigest || null,
      manifest.artifactAttestationDigest || null,
      manifest.deploymentTarget || null,
      manifest.healthDigest || null,
      JSON.stringify(manifest.transitions),
      manifest.updatedAt,
      manifest.runId,
      expectedState,
    ],
  );
  if (result.changes !== 1) throw new Error("CLOUD_MANIFEST_CONFLICT");
}

export async function getCloudDeliveryManifest(
  runId: string,
): Promise<CloudDeliveryManifest | undefined> {
  if (!UUID.test(runId)) throw new Error("INVALID_CLOUD_RUN_ID");
  const row = await billingGet<any>(
    "SELECT * FROM cloud_delivery_manifests WHERE run_id = ?",
    [runId],
  );
  return row ? rowToManifest(row) : undefined;
}

export async function listCloudDeliveryManifests(
  limit = 50,
): Promise<CloudDeliveryManifest[]> {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 100)
    : 50;
  const rows = await billingAll<any>(
    `SELECT * FROM cloud_delivery_manifests ORDER BY updated_at DESC LIMIT ${safeLimit}`,
  );
  return rows.map(rowToManifest);
}

export async function createAndPersistCloudDeliveryManifest(
  input: Parameters<typeof createCloudDeliveryManifest>[0],
): Promise<CloudDeliveryManifest> {
  const manifest = createCloudDeliveryManifest(input);
  await saveCloudDeliveryManifest(manifest);
  return manifest;
}

export async function transitionAndPersistCloudDelivery(
  runId: string,
  next: CloudDeliveryState,
  evidence?: {
    artifactDigest?: string;
    artifactAttestationDigest?: string;
    deploymentTarget?: string;
    healthDigest?: string;
    ready?: boolean;
    smokePassed?: boolean;
    logErrorsFree?: boolean;
  },
): Promise<CloudDeliveryManifest> {
  const current = await getCloudDeliveryManifest(runId);
  if (!current) throw new Error("CLOUD_MANIFEST_NOT_FOUND");
  const nextManifest = transitionCloudDelivery(current, next, evidence);
  await updateCloudDeliveryManifest(nextManifest, current.state);
  return nextManifest;
}

export async function approveAndPersistCloudDelivery(
  runId: string,
  approval: CloudDeliveryApproval,
): Promise<CloudDeliveryManifest> {
  const current = await getCloudDeliveryManifest(runId);
  if (!current) throw new Error("CLOUD_MANIFEST_NOT_FOUND");
  const approved = approveCloudDelivery(current, approval);
  await updateCloudDeliveryManifest(approved, current.state);
  return approved;
}
