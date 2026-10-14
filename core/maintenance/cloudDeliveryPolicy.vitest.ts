import { describe, expect, it } from "vitest";
import {
  approveCloudDelivery,
  assertCloudDeliveryAction,
  createCloudDeliveryManifest,
  transitionCloudDelivery,
} from "./cloudDeliveryPolicy";

const SHA = "a".repeat(64);
const approval = {
  actor: "release-engineer@example.com",
  scope: "create PR for task cloud-task-1 only",
  approvedAt: "2026-10-14T00:00:00.000Z",
  receiptDigest: SHA,
};

function manifest() {
  return createCloudDeliveryManifest({
    taskId: "cloud-task-1",
    owner: "madu025",
    repo: "vynorai",
    baseBranch: "main",
    headBranch: "vynor/auto-fix/cloud-task-1",
    baseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    mode: "pr_only",
    verificationDigest: SHA,
    runId: "11111111-1111-4111-8111-111111111111",
  });
}

describe("cloud delivery policy", () => {
  it("fails closed when a verified run has no human approval", () => {
    const verified = transitionCloudDelivery(
      transitionCloudDelivery(manifest(), "sandboxed"),
      "verified",
    );
    const awaiting = transitionCloudDelivery(verified, "awaiting_approval");
    expect(() => assertCloudDeliveryAction(awaiting, "push_branch")).toThrow(
      "CLOUD_ACTION_REQUIRES_APPROVAL",
    );
  });

  it("requires approval evidence to match the verification receipt", () => {
    const awaiting = transitionCloudDelivery(
      transitionCloudDelivery(
        transitionCloudDelivery(manifest(), "sandboxed"),
        "verified",
      ),
      "awaiting_approval",
    );
    expect(() =>
      approveCloudDelivery(awaiting, {
        ...approval,
        receiptDigest: "d".repeat(64),
      }),
    ).toThrow("CLOUD_APPROVAL_EVIDENCE_MISMATCH");
  });

  it("allows only the ordered PR actions after matching approval", () => {
    const awaiting = transitionCloudDelivery(
      transitionCloudDelivery(
        transitionCloudDelivery(manifest(), "sandboxed"),
        "verified",
      ),
      "awaiting_approval",
    );
    const approved = approveCloudDelivery(awaiting, approval);
    assertCloudDeliveryAction(approved, "push_branch");
    const pushed = transitionCloudDelivery(approved, "pushed");
    assertCloudDeliveryAction(pushed, "create_pr");
    expect(() => assertCloudDeliveryAction(pushed, "deploy_staging")).toThrow(
      "CLOUD_ACTION_NOT_ALLOWED_deploy_staging_pushed",
    );
  });

  it("does not allow deployment actions in PR-only mode", () => {
    const awaiting = transitionCloudDelivery(
      transitionCloudDelivery(
        transitionCloudDelivery(manifest(), "sandboxed"),
        "verified",
      ),
      "awaiting_approval",
    );
    const approved = approveCloudDelivery(awaiting, approval);
    const pushed = transitionCloudDelivery(approved, "pushed");
    const pr = transitionCloudDelivery(pushed, "pr_created");
    expect(() => assertCloudDeliveryAction(pr, "deploy_staging")).toThrow(
      "CLOUD_STAGING_NOT_ENABLED",
    );
  });

  it("requires signed artifact, health and target evidence for deployment", () => {
    const deployManifest = createCloudDeliveryManifest({
      taskId: "cloud-task-1",
      owner: "madu025",
      repo: "vynorai",
      baseBranch: "main",
      headBranch: "vynor/auto-fix/cloud-task-1",
      baseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      mode: "staging_auto_deploy",
      verificationDigest: SHA,
      runId: "11111111-1111-4111-8111-111111111111",
    });
    const awaiting = transitionCloudDelivery(
      transitionCloudDelivery(
        transitionCloudDelivery(deployManifest, "sandboxed"),
        "verified",
      ),
      "awaiting_approval",
    );
    const approved = approveCloudDelivery(awaiting, approval);
    const pushed = transitionCloudDelivery(approved, "pushed");
    const pr = transitionCloudDelivery(pushed, "pr_created");
    expect(() =>
      transitionCloudDelivery(pr, "staging_deployed", {
        artifactDigest: SHA,
        deploymentTarget: "staging",
        healthDigest: SHA,
      }),
    ).toThrow("CLOUD_ARTIFACT_ATTESTATION_REQUIRED");
  });

  it("pins later deployment evidence to the first verified artifact", () => {
    const deployManifest = createCloudDeliveryManifest({
      taskId: "cloud-task-1",
      owner: "madu025",
      repo: "vynorai",
      baseBranch: "main",
      headBranch: "vynor/auto-fix/cloud-task-1",
      baseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      mode: "staging_auto_deploy",
      verificationDigest: SHA,
      runId: "11111111-1111-4111-8111-111111111111",
    });
    const base = {
      ...deployManifest,
      state: "staging_deployed" as const,
      artifactDigest: SHA,
      artifactAttestationDigest: "d".repeat(64),
    };
    expect(() =>
      transitionCloudDelivery(base, "canary_verified", {
        artifactDigest: "e".repeat(64),
        artifactAttestationDigest: "d".repeat(64),
        deploymentTarget: "staging",
        healthDigest: SHA,
      }),
    ).toThrow("CLOUD_ARTIFACT_EVIDENCE_MISMATCH");
  });
});
