import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSandboxLaunchRequest,
  SANDBOX_HARD_LIMITS,
  sandboxLimitsFromEnvironment,
} from "../src/worker/sandboxPolicy.js";

const base = {
  version: 1 as const,
  taskId: "123e4567-e89b-12d3-a456-426614174000",
  inputArchive:
    "/var/lib/vynor-background/staging/123e4567-e89b-12d3-a456-426614174000/project.zip",
  outputDirectory:
    "/var/lib/vynor-background/staging/123e4567-e89b-12d3-a456-426614174000/output",
  modelRelayUrl: "http://vynor-bg-egress:8080/model/v1/chat/completions",
  modelToken: "scoped-task-token",
  cacheKey: "a".repeat(64),
  limits: { ...SANDBOX_HARD_LIMITS },
};

test("sandbox policy accepts the approved bounded launcher request", () => {
  assert.doesNotThrow(() => assertSandboxLaunchRequest(base, {}));
});

test("sandbox policy rejects a public or altered model relay", () => {
  assert.throws(
    () =>
      assertSandboxLaunchRequest(
        { ...base, modelRelayUrl: "https://example.com/steal" },
        {},
      ),
    /INVALID_MODEL_RELAY/,
  );
});

test("sandbox policy rejects path traversal and limits above the hard cap", () => {
  assert.throws(
    () =>
      assertSandboxLaunchRequest(
        { ...base, inputArchive: "/var/lib/vynor-background/../secret.zip" },
        {},
      ),
    /INVALID_SANDBOX_PATH/,
  );
  assert.throws(
    () =>
      assertSandboxLaunchRequest(
        {
          ...base,
          limits: {
            ...base.limits,
            memoryMb: SANDBOX_HARD_LIMITS.memoryMb + 1,
          },
        },
        {},
      ),
    /INVALID_SANDBOX_LIMIT_MEMORYMB/,
  );
  assert.throws(
    () =>
      assertSandboxLaunchRequest({ ...base, modelToken: "x".repeat(4096) }, {}),
    /INVALID_SANDBOX_TOKEN/,
  );
});

test("sandbox policy rejects paths outside the task staging directory", () => {
  assert.throws(
    () =>
      assertSandboxLaunchRequest(
        {
          ...base,
          outputDirectory: "/var/lib/vynor-background/staging/other/output",
        },
        {},
      ),
    /INVALID_SANDBOX_PATH/,
  );
  assert.throws(
    () =>
      assertSandboxLaunchRequest(
        {
          ...base,
          inputArchive:
            "/var/lib/vynor-background/staging/123e4567-e89b-12d3-a456-426614174000",
        },
        {},
      ),
    /INVALID_SANDBOX_PATH/,
  );
});

test("environment limits fail closed instead of silently widening the sandbox", () => {
  assert.deepEqual(sandboxLimitsFromEnvironment({}), SANDBOX_HARD_LIMITS);
  assert.throws(
    () => sandboxLimitsFromEnvironment({ BG_TASK_TIMEOUT_MINUTES: "46" }),
    /SANDBOX_LIMIT_EXCEEDED_RUNTIMESECONDS/,
  );
  assert.throws(
    () => sandboxLimitsFromEnvironment({ BG_TASK_CPUS: "0" }),
    /INVALID_SANDBOX_LIMIT/,
  );
});
