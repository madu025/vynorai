import { describe, expect, it, vi } from "vitest";
import {
  approveCloudDelivery,
  createCloudDeliveryManifest,
  transitionCloudDelivery,
} from "./cloudDeliveryPolicy";
import { CloudDeploymentExecutor } from "./cloudDeploymentExecutor";

const SHA = "a".repeat(64);
const approval = {
  actor: "release-engineer@example.com",
  scope: "staging deployment",
  approvedAt: "2026-10-14T00:00:00.000Z",
  receiptDigest: SHA,
};

function readyManifest() {
  let manifest = createCloudDeliveryManifest({
    runId: "33333333-3333-4333-8333-333333333333",
    taskId: "task-executor",
    owner: "vynor",
    repo: "VynorAI",
    baseBranch: "main",
    headBranch: "cloud/task-executor",
    baseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    mode: "staging_auto_deploy",
    verificationDigest: SHA,
  });
  manifest = transitionCloudDelivery(manifest, "sandboxed");
  manifest = transitionCloudDelivery(manifest, "verified");
  manifest = transitionCloudDelivery(manifest, "awaiting_approval");
  manifest = approveCloudDelivery(manifest, approval);
  manifest = transitionCloudDelivery(manifest, "pushed");
  manifest = transitionCloudDelivery(manifest, "pr_created");
  return {
    ...manifest,
    artifactDigest: SHA,
    artifactAttestationDigest: "b".repeat(64),
  };
}

describe("CloudDeploymentExecutor", () => {
  it("deploys only after health, smoke and log evidence pass", async () => {
    const adapter = {
      deploy: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        healthDigest: "c".repeat(64),
        ready: true,
        smokePassed: true,
        logErrorsFree: true,
      }),
      rollback: vi.fn(),
    };
    const controlClient = {
      createManifest: vi.fn(),
      approve: vi.fn(),
      transition: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new CloudDeploymentExecutor({ adapter, controlClient });
    const result = await executor.deployStaging(readyManifest(), "staging", {
      artifactDigest: SHA,
      artifactAttestationDigest: "b".repeat(64),
      artifactSignature: "c2lnbmF0dXJl",
      artifactKeyId: "release-key-2026",
    });
    expect(result.state).toBe("staging_deployed");
    expect(adapter.deploy).toHaveBeenCalledOnce();
    expect(controlClient.transition).toHaveBeenCalledOnce();
    expect(controlClient.transition.mock.calls[0][2]).toMatchObject({
      artifactSignature: "c2lnbmF0dXJl",
      artifactKeyId: "release-key-2026",
    });
  });

  it("does not promote an inconclusive canary", async () => {
    const adapter = {
      deploy: vi.fn(),
      inspect: vi.fn(),
      rollback: vi.fn(),
    };
    const executor = new CloudDeploymentExecutor({ adapter });
    const result = await executor.evaluateCanary(
      { ...readyManifest(), state: "staging_deployed" },
      {
        sampleCount: 10,
        excludedSamples: 10,
        errorRate: 0,
        p95LatencyMs: 1,
        falseVerified: 0,
      },
      {
        minSamples: 100,
        maxErrorRate: 0.02,
        maxP95LatencyMs: 1500,
        maxFalseVerified: 0,
      },
      "staging",
    );
    expect(result.decision.decision).toBe("inconclusive");
    expect(adapter.rollback).not.toHaveBeenCalled();
  });

  it("rolls back on a canary safety violation", async () => {
    const adapter = {
      deploy: vi.fn(),
      inspect: vi.fn(),
      rollback: vi.fn().mockResolvedValue({ healthDigest: "d".repeat(64) }),
    };
    const executor = new CloudDeploymentExecutor({ adapter });
    const result = await executor.evaluateCanary(
      { ...readyManifest(), state: "staging_deployed" },
      { sampleCount: 200, errorRate: 0, p95LatencyMs: 1, falseVerified: 1 },
      {
        minSamples: 100,
        maxErrorRate: 0.02,
        maxP95LatencyMs: 1500,
        maxFalseVerified: 0,
      },
      "staging",
    );
    expect(result.decision.decision).toBe("rollback");
    expect(result.manifest.state).toBe("rolled_back");
    expect(adapter.rollback).toHaveBeenCalledOnce();
  });

  it("records a rollback when staging health fails after deployment", async () => {
    const adapter = {
      deploy: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        healthDigest: "c".repeat(64),
        ready: false,
        smokePassed: false,
        logErrorsFree: false,
      }),
      rollback: vi.fn().mockResolvedValue({
        healthDigest: "d".repeat(64),
        ready: true,
        smokePassed: true,
        logErrorsFree: true,
      }),
    };
    const controlClient = {
      createManifest: vi.fn(),
      approve: vi.fn(),
      transition: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new CloudDeploymentExecutor({ adapter, controlClient });
    await expect(
      executor.deployStaging(readyManifest(), "staging"),
    ).rejects.toThrow("CLOUD_DEPLOYMENT_HEALTH_FAILED");
    expect(adapter.rollback).toHaveBeenCalledOnce();
    expect(controlClient.transition).toHaveBeenCalledWith(
      expect.any(String),
      "rolled_back",
      expect.objectContaining({ healthDigest: "d".repeat(64) }),
    );
  });
});
