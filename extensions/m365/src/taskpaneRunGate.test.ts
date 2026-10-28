import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRunGate } from "./taskpaneRunGate.js";

const selection = { address: "'VynorAI_QA'!A1:J41", rows: 41, columns: 10 };

test("Run enables only for a signed-in request with a valid selection", () => {
  assert.equal(
    evaluateRunGate({
      signedIn: true,
      accountReady: true,
      request: "Create a chart of Net Amount by Region.",
      selection,
      busy: false,
      capabilityState: "ready",
      canInspect: true,
      agentMode: false,
      aiAvailable: true,
    }).enabled,
    true,
  );
});

test("Run exposes a reason for every blocked precondition", () => {
  const base = {
    signedIn: true,
    accountReady: true,
    request: "Create a chart.",
    selection,
    busy: false,
    capabilityState: "ready" as const,
    canInspect: true,
    agentMode: false,
    aiAvailable: true,
  };
  assert.equal(
    evaluateRunGate({ ...base, request: "" }).reason,
    "request_required",
  );
  assert.equal(
    evaluateRunGate({ ...base, selection: undefined }).reason,
    "selection_required",
  );
  assert.equal(
    evaluateRunGate({ ...base, busy: true }).reason,
    "request_running",
  );
  assert.equal(
    evaluateRunGate({ ...base, capabilityState: "loading" }).reason,
    "waiting_for_host",
  );
  assert.equal(
    evaluateRunGate({ ...base, capabilityState: "unavailable" }).reason,
    "backend_unavailable",
  );
});

test("Run waits for the VynorAI account handshake instead of enabling early", () => {
  const result = evaluateRunGate({
    signedIn: true,
    accountReady: false,
    request: "Create a chart.",
    selection,
    busy: false,
    capabilityState: "ready",
    canInspect: true,
    agentMode: false,
    aiAvailable: true,
  });
  assert.equal(result.reason, "account_not_ready");
});

test("Run waits while the host capability handshake has not started", () => {
  const result = evaluateRunGate({
    signedIn: true,
    request: "Create a chart.",
    selection,
    busy: false,
    capabilityState: "idle",
    agentMode: false,
    aiAvailable: true,
  });
  assert.equal(result.reason, "waiting_for_host");
});

test("agent mode refuses honestly when AI analysis is unavailable", () => {
  const result = evaluateRunGate({
    signedIn: true,
    request: "Create a management dashboard and explain the drivers.",
    selection,
    busy: false,
    capabilityState: "ready",
    canInspect: true,
    agentMode: true,
    aiAvailable: false,
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "agent_unavailable");
});
