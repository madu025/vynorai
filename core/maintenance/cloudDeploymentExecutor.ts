import {
  transitionCloudDelivery,
  type CloudDeliveryManifest,
} from "./cloudDeliveryPolicy.js";
import type { CloudDeliveryControlClient } from "./cloudDeliveryClient.js";

export interface CanaryPolicy {
  minSamples: number;
  maxErrorRate: number;
  maxP95LatencyMs: number;
  maxFalseVerified: number;
}

export interface CanaryObservation {
  sampleCount: number;
  excludedSamples?: number;
  errorRate: number;
  p95LatencyMs: number;
  falseVerified: number;
}

export interface CanaryDecision {
  decision: "promote" | "rollback" | "inconclusive";
  reasons: string[];
}

function evaluateCanary(
  observation: CanaryObservation,
  policy: CanaryPolicy,
): CanaryDecision {
  const excluded = observation.excludedSamples || 0;
  if (!Number.isInteger(observation.sampleCount) || observation.sampleCount < 0)
    throw new Error("CLOUD_CANARY_SAMPLE_COUNT_INVALID");
  if (
    !Number.isInteger(excluded) ||
    excluded < 0 ||
    excluded > observation.sampleCount
  )
    throw new Error("CLOUD_CANARY_EXCLUDED_SAMPLE_COUNT_INVALID");
  if (
    !Number.isFinite(observation.errorRate) ||
    !Number.isFinite(observation.p95LatencyMs) ||
    !Number.isFinite(observation.falseVerified)
  )
    throw new Error("CLOUD_CANARY_METRIC_INVALID");
  const reasons: string[] = [];
  if (observation.falseVerified > policy.maxFalseVerified)
    reasons.push("false_verified_threshold");
  if (observation.errorRate > policy.maxErrorRate)
    reasons.push("error_rate_threshold");
  if (observation.p95LatencyMs > policy.maxP95LatencyMs)
    reasons.push("latency_threshold");
  if (reasons.length > 0) return { decision: "rollback", reasons };
  if (observation.sampleCount - excluded < policy.minSamples)
    return { decision: "inconclusive", reasons: ["minimum_samples"] };
  return { decision: "promote", reasons: [] };
}

export interface CloudDeploymentHealth {
  healthDigest: string;
  ready: boolean;
  smokePassed: boolean;
  logErrorsFree: boolean;
}

export interface CloudArtifactProvenance {
  artifactDigest: string;
  artifactAttestationDigest: string;
  artifactSignature?: string;
  artifactKeyId?: string;
}

export interface CloudDeploymentAdapter {
  deploy(input: {
    target: string;
    artifactDigest: string;
    rollbackSha: string;
  }): Promise<void>;
  inspect(target: string): Promise<CloudDeploymentHealth>;
  rollback(input: {
    target: string;
    rollbackSha: string;
  }): Promise<CloudDeploymentHealth>;
}

export interface CloudDeploymentExecutorOptions {
  adapter: CloudDeploymentAdapter;
  controlClient?: CloudDeliveryControlClient;
}

/**
 * Executes only the deployment actions represented by the manifest state
 * machine. The adapter owns provider/VPS credentials; untrusted task data is
 * never converted into a shell command here.
 */
export class CloudDeploymentExecutor {
  constructor(private readonly options: CloudDeploymentExecutorOptions) {}

  async deployStaging(
    manifest: CloudDeliveryManifest,
    target: string,
    provenance?: CloudArtifactProvenance,
  ): Promise<CloudDeliveryManifest> {
    if (manifest.state !== "pr_created")
      throw new Error(
        `CLOUD_ACTION_NOT_ALLOWED_deploy_staging_${manifest.state}`,
      );
    if (manifest.mode === "pr_only")
      throw new Error("CLOUD_STAGING_NOT_ENABLED");
    return this.deployAndVerify(
      manifest,
      "staging_deployed",
      target,
      provenance,
    );
  }

  async evaluateCanary(
    manifest: CloudDeliveryManifest,
    observation: CanaryObservation,
    policy: CanaryPolicy,
    target: string,
  ): Promise<{ manifest: CloudDeliveryManifest; decision: CanaryDecision }> {
    if (manifest.state !== "staging_deployed")
      throw new Error(
        `CLOUD_ACTION_NOT_ALLOWED_deploy_canary_${manifest.state}`,
      );
    const decision = evaluateCanary(observation, policy);
    if (decision.decision === "inconclusive") return { manifest, decision };
    if (decision.decision === "rollback") {
      return {
        manifest: await this.rollback(manifest, target),
        decision,
      };
    }
    const health = await this.options.adapter.inspect(target);
    const next = transitionCloudDelivery(manifest, "canary_verified", {
      artifactDigest: manifest.artifactDigest,
      artifactAttestationDigest: manifest.artifactAttestationDigest,
      deploymentTarget: target,
      healthDigest: health.healthDigest,
    });
    await this.persistTransition(next, {
      artifactDigest: next.artifactDigest,
      artifactAttestationDigest: next.artifactAttestationDigest,
      deploymentTarget: target,
      healthDigest: health.healthDigest,
    });
    return { manifest: next, decision };
  }

  async deployProduction(
    manifest: CloudDeliveryManifest,
    target: string,
    provenance?: CloudArtifactProvenance,
  ): Promise<CloudDeliveryManifest> {
    if (manifest.state !== "canary_verified")
      throw new Error(
        `CLOUD_ACTION_NOT_ALLOWED_deploy_production_${manifest.state}`,
      );
    if (manifest.mode !== "production_auto_deploy")
      throw new Error("CLOUD_PRODUCTION_AUTO_DEPLOY_NOT_ENABLED");
    return this.deployAndVerify(manifest, "deployed", target, provenance);
  }

  async rollback(
    manifest: CloudDeliveryManifest,
    target: string,
  ): Promise<CloudDeliveryManifest> {
    if (manifest.state === "rolled_back") return manifest;
    if (manifest.state === "created" || manifest.state === "sandboxed")
      throw new Error(`CLOUD_ROLLBACK_NOT_ALLOWED_${manifest.state}`);
    const health = await this.options.adapter.rollback({
      target,
      rollbackSha: manifest.rollbackSha,
    });
    const next = transitionCloudDelivery(manifest, "rolled_back", {
      artifactDigest: manifest.artifactDigest,
      artifactAttestationDigest: manifest.artifactAttestationDigest,
      deploymentTarget: target,
      healthDigest: health.healthDigest,
    });
    await this.persistTransition(next, {
      artifactDigest: next.artifactDigest,
      artifactAttestationDigest: next.artifactAttestationDigest,
      deploymentTarget: target,
      healthDigest: health.healthDigest,
    });
    return next;
  }

  private async deployAndVerify(
    manifest: CloudDeliveryManifest,
    nextState: "staging_deployed" | "deployed",
    target: string,
    provenance?: CloudArtifactProvenance,
  ): Promise<CloudDeliveryManifest> {
    const artifactDigest =
      provenance?.artifactDigest || manifest.artifactDigest;
    const artifactAttestationDigest =
      provenance?.artifactAttestationDigest ||
      manifest.artifactAttestationDigest;
    if (!artifactDigest || !artifactAttestationDigest)
      throw new Error("CLOUD_ARTIFACT_PROVENANCE_REQUIRED");
    try {
      await this.options.adapter.deploy({
        target,
        artifactDigest,
        rollbackSha: manifest.rollbackSha,
      });
      const health = await this.options.adapter.inspect(target);
      if (!health.ready || !health.smokePassed || !health.logErrorsFree)
        throw new Error("CLOUD_DEPLOYMENT_HEALTH_FAILED");
      const next = transitionCloudDelivery(manifest, nextState, {
        artifactDigest,
        artifactAttestationDigest,
        deploymentTarget: target,
        healthDigest: health.healthDigest,
        logErrorsFree: health.logErrorsFree,
      });
      await this.persistTransition(next, {
        artifactDigest: next.artifactDigest,
        artifactAttestationDigest: next.artifactAttestationDigest,
        artifactSignature: provenance?.artifactSignature,
        artifactKeyId: provenance?.artifactKeyId,
        deploymentTarget: target,
        healthDigest: health.healthDigest,
        logErrorsFree: health.logErrorsFree,
      });
      return next;
    } catch (error) {
      try {
        const rollbackHealth = await this.options.adapter.rollback({
          target,
          rollbackSha: manifest.rollbackSha,
        });
        const rolledBack = transitionCloudDelivery(manifest, "rolled_back", {
          artifactDigest,
          artifactAttestationDigest,
          deploymentTarget: target,
          healthDigest: rollbackHealth.healthDigest,
        });
        await this.persistTransition(rolledBack, {
          artifactDigest,
          artifactAttestationDigest,
          deploymentTarget: target,
          healthDigest: rollbackHealth.healthDigest,
        });
      } catch {
        // Preserve the original deployment/health failure. The control plane
        // remains non-successful when rollback evidence is unavailable.
      }
      throw error;
    }
  }

  private async persistTransition(
    manifest: CloudDeliveryManifest,
    evidence: Parameters<CloudDeliveryControlClient["transition"]>[2],
  ): Promise<void> {
    if (this.options.controlClient)
      await this.options.controlClient.transition(
        manifest.runId,
        manifest.state,
        evidence,
      );
  }
}
