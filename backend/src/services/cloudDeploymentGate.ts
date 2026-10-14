import { createHash } from "node:crypto";

const SHA = /^[a-f0-9]{40,64}$/i;

export interface StagingEvidence {
  artifactDigest: string;
  deploymentTarget: string;
  healthDigest: string;
  ready: boolean;
  smokePassed: boolean;
  logErrorsFree: boolean;
}

export interface CanaryPolicy {
  exposurePercent: number;
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

function requireSha(value: string, code: string): void {
  if (!SHA.test(value)) throw new Error(code);
}

export function assertStagingEvidence(evidence: StagingEvidence): void {
  requireSha(evidence.artifactDigest, "CLOUD_ARTIFACT_EVIDENCE_REQUIRED");
  requireSha(evidence.healthDigest, "CLOUD_HEALTH_EVIDENCE_REQUIRED");
  if (!evidence.deploymentTarget || evidence.deploymentTarget.length > 128)
    throw new Error("CLOUD_DEPLOYMENT_TARGET_REQUIRED");
  if (!evidence.ready) throw new Error("CLOUD_STAGING_NOT_READY");
  if (!evidence.smokePassed) throw new Error("CLOUD_STAGING_SMOKE_FAILED");
  if (!evidence.logErrorsFree) throw new Error("CLOUD_STAGING_LOG_ERRORS");
}

export function isCanarySubject(
  subject: string,
  salt: string,
  exposurePercent: number,
): boolean {
  if (!subject || !salt) throw new Error("CLOUD_CANARY_BUCKET_INPUT_REQUIRED");
  if (
    !Number.isFinite(exposurePercent) ||
    exposurePercent < 1 ||
    exposurePercent > 5
  )
    throw new Error("CLOUD_CANARY_EXPOSURE_OUT_OF_RANGE");
  const bucket =
    createHash("sha256").update(`${salt}:${subject}`).digest().readUInt32BE(0) %
    10_000;
  return bucket < Math.floor(exposurePercent * 100);
}

export function evaluateCanary(
  observation: CanaryObservation,
  policy: CanaryPolicy,
): CanaryDecision {
  const reasons: string[] = [];
  if (!Number.isInteger(observation.sampleCount) || observation.sampleCount < 0)
    throw new Error("CLOUD_CANARY_SAMPLE_COUNT_INVALID");
  const excludedSamples = observation.excludedSamples || 0;
  if (
    !Number.isInteger(excludedSamples) ||
    excludedSamples < 0 ||
    excludedSamples > observation.sampleCount
  )
    throw new Error("CLOUD_CANARY_EXCLUDED_SAMPLE_COUNT_INVALID");
  if (
    !Number.isFinite(observation.errorRate) ||
    !Number.isFinite(observation.p95LatencyMs) ||
    !Number.isFinite(observation.falseVerified)
  )
    throw new Error("CLOUD_CANARY_METRIC_INVALID");
  if (!Number.isInteger(policy.minSamples) || policy.minSamples < 1)
    throw new Error("CLOUD_CANARY_MIN_SAMPLES_INVALID");
  if (
    !Number.isFinite(policy.maxErrorRate) ||
    !Number.isFinite(policy.maxP95LatencyMs) ||
    !Number.isFinite(policy.maxFalseVerified)
  )
    throw new Error("CLOUD_CANARY_POLICY_INVALID");
  if (observation.falseVerified > policy.maxFalseVerified)
    reasons.push("false_verified_threshold");
  if (observation.errorRate > policy.maxErrorRate)
    reasons.push("error_rate_threshold");
  if (observation.p95LatencyMs > policy.maxP95LatencyMs)
    reasons.push("latency_threshold");
  if (reasons.length > 0) return { decision: "rollback", reasons };
  if (observation.sampleCount - excludedSamples < policy.minSamples)
    return { decision: "inconclusive", reasons: ["minimum_samples"] };
  return { decision: "promote", reasons: [] };
}

export function assertRollbackEvidence(input: {
  rollbackSha: string;
  artifactDigest: string;
  healthDigest: string;
}): void {
  requireSha(input.rollbackSha, "CLOUD_ROLLBACK_SHA_REQUIRED");
  requireSha(input.artifactDigest, "CLOUD_ROLLBACK_ARTIFACT_REQUIRED");
  requireSha(input.healthDigest, "CLOUD_ROLLBACK_HEALTH_REQUIRED");
}
