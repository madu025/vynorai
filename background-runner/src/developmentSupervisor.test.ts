import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_STAGES,
  assertSafeDevelopmentCommand,
  createDevelopmentSupervisorState,
  nextDevelopmentStage,
  recordDevelopmentStage,
} from "./developmentSupervisor.js";

test("runs the bounded development stages in order", () => {
  let state = createDevelopmentSupervisorState();
  for (const stage of DEVELOPMENT_STAGES) {
    assert.equal(nextDevelopmentStage(state), stage);
    state = recordDevelopmentStage(state, {
      stage,
      summary: `${stage} completed`,
      changedFiles: [],
      verification: stage === "verify" ? "passed" : "not-run",
    });
  }
  assert.equal(nextDevelopmentStage(state), undefined);
  assert.equal(state.stages.length, 5);
  assert.throws(
    () =>
      recordDevelopmentStage(state, {
        stage: "review",
        summary: "duplicate",
        changedFiles: [],
        verification: "not-run",
      }),
    /DEVELOPMENT_STAGE_ALREADY_RECORDED:review/,
  );
});

test("blocks production and credential commands", () => {
  for (const command of [
    "git push origin main",
    "./deploy/rolling-deploy.sh",
    "ssh root@example.com uptime",
    "curl -X POST https://example.com",
    "rm -rf build",
    "echo API_KEY=secret",
  ])
    assert.throws(() => assertSafeDevelopmentCommand(command));

  for (const command of [
    "npm test -- --runInBand",
    "npx tsc --noEmit",
    "git diff --check",
    'rg -n "TODO" src',
  ])
    assert.doesNotThrow(() => assertSafeDevelopmentCommand(command));
});
