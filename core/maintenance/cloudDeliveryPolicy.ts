import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type CloudDeliveryMode =
  | "pr_only"
  | "staging_auto_deploy"
  | "production_canary"
  | "production_auto_deploy";

export type CloudDeliveryAction =
  | "push_branch"
  | "create_pr"
  | "deploy_staging"
  | "deploy_canary"
  | "deploy_production"
  | "rollback";

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
  createdAt: string;
  updatedAt: string;
}

const SHA = /^[a-f0-9]{40,64}$/i;
const UUID = /^[0-9a-f-]{36}$/i;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,190}$/;
const OWNER_REPO = /^[A-Za-z0-9_.-]{1,100}$/;

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

function nonEmpty(value: string, label: string, max = 256): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`INVALID_CLOUD_${label}`);
  return text;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertApproval(approval: CloudDeliveryApproval): void {
  nonEmpty(approval.actor, "APPROVAL_ACTOR", 160);
  nonEmpty(approval.scope, "APPROVAL_SCOPE", 500);
  if (!Number.isFinite(Date.parse(approval.approvedAt)))
    throw new Error("INVALID_CLOUD_APPROVAL_TIME");
  if (!SHA.test(approval.receiptDigest))
    throw new Error("INVALID_CLOUD_APPROVAL_DIGEST");
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
  if (!OWNER_REPO.test(input.owner) || !OWNER_REPO.test(input.repo))
    throw new Error("INVALID_CLOUD_REPOSITORY");
  if (!BRANCH.test(input.baseBranch) || !BRANCH.test(input.headBranch))
    throw new Error("INVALID_CLOUD_BRANCH");
  if (!SHA.test(input.baseSha) || !SHA.test(input.headSha))
    throw new Error("INVALID_CLOUD_REVISION");
  if (!SHA.test(input.verificationDigest))
    throw new Error("CLOUD_DELIVERY_VERIFICATION_REQUIRED");
  const runId = input.runId || randomUUID();
  if (!UUID.test(runId)) throw new Error("INVALID_CLOUD_RUN_ID");
  const now = input.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("INVALID_CLOUD_TIME");

  return {
    version: 1,
    policyVersion: "2026-10-14.v1",
    runId,
    taskId: nonEmpty(input.taskId, "TASK_ID"),
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
    logErrorsFree?: boolean;
  },
): CloudDeliveryManifest {
  if (!TRANSITIONS[manifest.state].includes(next))
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
    if (next === "staging_deployed" && evidence?.logErrorsFree !== true)
      throw new Error("CLOUD_STAGING_LOG_ERRORS");
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
  return {
    ...manifest,
    state: next,
    artifactDigest: evidence?.artifactDigest || manifest.artifactDigest,
    artifactAttestationDigest:
      evidence?.artifactAttestationDigest || manifest.artifactAttestationDigest,
    deploymentTarget: evidence?.deploymentTarget || manifest.deploymentTarget,
    healthDigest: evidence?.healthDigest || manifest.healthDigest,
    updatedAt: new Date().toISOString(),
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

export function assertCloudDeliveryAction(
  manifest: CloudDeliveryManifest,
  action: CloudDeliveryAction,
): void {
  if (action !== "rollback" && !manifest.approval)
    throw new Error("CLOUD_ACTION_REQUIRES_APPROVAL");
  const allowed: Record<CloudDeliveryAction, CloudDeliveryState[]> = {
    push_branch: ["approved"],
    create_pr: ["pushed"],
    deploy_staging: ["pr_created"],
    deploy_canary: ["staging_deployed"],
    deploy_production: ["canary_verified"],
    rollback: [
      "approved",
      "pushed",
      "pr_created",
      "staging_deployed",
      "canary_verified",
      "deployed",
      "failed",
    ],
  };
  if (!allowed[action].includes(manifest.state))
    throw new Error(`CLOUD_ACTION_NOT_ALLOWED_${action}_${manifest.state}`);
  if (action === "deploy_staging" && manifest.mode === "pr_only")
    throw new Error("CLOUD_STAGING_NOT_ENABLED");
  if (
    (action === "deploy_canary" || action === "deploy_production") &&
    manifest.mode === "pr_only"
  )
    throw new Error("CLOUD_DEPLOYMENT_NOT_ENABLED");
  if (
    (action === "deploy_staging" ||
      action === "deploy_canary" ||
      action === "deploy_production") &&
    (!manifest.artifactDigest ||
      !manifest.artifactAttestationDigest ||
      !manifest.deploymentTarget ||
      !manifest.healthDigest)
  )
    throw new Error("CLOUD_DEPLOYMENT_EVIDENCE_REQUIRED");
}

export class CloudDeliveryManifestStore {
  constructor(private readonly directory: string) {}

  async write(manifest: CloudDeliveryManifest): Promise<string> {
    if (!UUID.test(manifest.runId)) throw new Error("INVALID_CLOUD_RUN_ID");
    await fs.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${manifest.runId}.json`);
    const temporary = `${target}.tmp`;
    await fs.writeFile(
      temporary,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporary, target);
    return target;
  }
}
