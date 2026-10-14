import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRollbackEvidence,
  assertStagingEvidence,
  evaluateCanary,
  isCanarySubject,
} from "../src/services/cloudDeploymentGate.js";

const sha = "a".repeat(64);

test("staging gate requires readiness, smoke and hash evidence", () => {
  assert.throws(
    () =>
      assertStagingEvidence({
        artifactDigest: sha,
        deploymentTarget: "staging",
        healthDigest: sha,
        ready: true,
        smokePassed: false,
        logErrorsFree: true,
      }),
    /CLOUD_STAGING_SMOKE_FAILED/,
  );
  assert.doesNotThrow(() =>
    assertStagingEvidence({
      artifactDigest: sha,
      deploymentTarget: "staging",
      healthDigest: sha,
      ready: true,
      smokePassed: true,
      logErrorsFree: true,
    }),
  );
});

test("canary decisions stop on safety violations and do not promote inconclusive samples", () => {
  const policy = {
    exposurePercent: 5,
    minSamples: 100,
    maxErrorRate: 0.02,
    maxP95LatencyMs: 1500,
    maxFalseVerified: 0,
  };
  assert.deepEqual(
    evaluateCanary(
      { sampleCount: 20, errorRate: 0, p95LatencyMs: 500, falseVerified: 0 },
      policy,
    ),
    { decision: "inconclusive", reasons: ["minimum_samples"] },
  );
  assert.equal(
    evaluateCanary(
      { sampleCount: 200, errorRate: 0, p95LatencyMs: 500, falseVerified: 1 },
      policy,
    ).decision,
    "rollback",
  );
  assert.equal(
    evaluateCanary(
      {
        sampleCount: 200,
        errorRate: 0.001,
        p95LatencyMs: 500,
        falseVerified: 0,
      },
      policy,
    ).decision,
    "promote",
  );
});

test("canary exposure stays in the declared 1-5 percent range", () => {
  assert.throws(
    () => isCanarySubject("user-1", "release-1", 10),
    /CLOUD_CANARY_EXPOSURE_OUT_OF_RANGE/,
  );
  assert.equal(typeof isCanarySubject("user-1", "release-1", 5), "boolean");
});

test("rollback requires pinned revision and health evidence", () => {
  assert.throws(
    () =>
      assertRollbackEvidence({
        rollbackSha: "bad",
        artifactDigest: sha,
        healthDigest: sha,
      }),
    /CLOUD_ROLLBACK_SHA_REQUIRED/,
  );
  assert.doesNotThrow(() =>
    assertRollbackEvidence({
      rollbackSha: "b".repeat(40),
      artifactDigest: sha,
      healthDigest: sha,
    }),
  );
});
