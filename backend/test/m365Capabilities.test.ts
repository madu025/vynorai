import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AI_TEXT_FEATURES,
  CAPABILITY_FEATURES,
  NATIVE_FEATURE_ADVICE,
  NATIVE_ONLY_FEATURES,
  baseCapabilityContext,
  refuseNativeRequest,
  resolveAllCapabilities,
  resolveCapability,
} from "../src/services/m365Capabilities.js";

test("the backend registry is a byte copy of the contract registry", () => {
  const contract = new URL(
    "../../packages/m365-contracts/src/capabilities.ts",
    import.meta.url,
  );
  // A deployment image without the packages folder has nothing to compare.
  if (!fs.existsSync(contract)) return;
  assert.equal(
    fs.readFileSync(
      new URL("../src/services/m365Capabilities.ts", import.meta.url),
      "utf8",
    ),
    fs.readFileSync(contract, "utf8"),
  );
  const addIn = new URL(
    "../../extensions/m365/src/capabilityRegistry.ts",
    import.meta.url,
  );
  if (fs.existsSync(addIn))
    assert.equal(
      fs.readFileSync(addIn, "utf8"),
      fs.readFileSync(contract, "utf8"),
    );
});

test("the server reports every registry key and only the registry keys", () => {
  const server = resolveAllCapabilities(
    baseCapabilityContext({ canRead: true, canWrite: true, aiEnabled: true }),
  );
  assert.deepEqual(Object.keys(server).sort(), [...CAPABILITY_FEATURES].sort());
  for (const feature of NATIVE_ONLY_FEATURES)
    assert.equal(server[feature].status, "unsupported", feature);
  // The old "python" key is gone: the registry key is python-sandbox.
  assert.equal("python" in server, false);
  assert.equal(server["python-sandbox"].status, "unsupported");
  assert.match(server["python-sandbox"].reason!, /not provisioned/);
  // The server does not know the host/API sets, so Office.js capabilities must use
  // their declared fallback until the pane provides verified host evidence.
  assert.equal(server["pivot-table"].status, "available_with_fallback");
  assert.equal(server["pivot-table"].fallbackFeature, "formula-report");
  assert.equal(server["email-share"].status, "consent_required");
});

test("without read or write access nothing is offered, and the reason says why", () => {
  const none = resolveAllCapabilities(baseCapabilityContext());
  assert.equal(none.forecast.status, "unsupported");
  assert.equal(none.forecast.reason, "Excel read access is unavailable.");
  assert.equal(none.dashboard.reason, "Excel write access is unavailable.");
  assert.equal(
    resolveCapability(
      "sentiment",
      baseCapabilityContext({ canRead: true, aiEnabled: false }),
    ).reason,
    "AI analysis is disabled or unavailable.",
  );
});

test("the AI text features of the schema and the agent tool are the registry's", async () => {
  const { textAnalysisRequestSchema } = await import(
    "../src/services/m365TextAnalysis.js"
  );
  const { AGENT_TOOLS } = await import("../src/services/m365Agent.js");
  for (const feature of AI_TEXT_FEATURES)
    assert.equal(
      textAnalysisRequestSchema.safeParse({
        feature,
        consent: true,
        texts: ["a"],
        language: "en",
      }).success,
      true,
      feature,
    );
  assert.equal(
    textAnalysisRequestSchema.safeParse({
      feature: "python-sandbox",
      consent: true,
      texts: ["a"],
    }).success,
    false,
  );
  const tool: any = AGENT_TOOLS.find(
    (entry) => entry.function.name === "analyze_text_batch",
  );
  assert.deepEqual(tool.function.parameters.properties.feature.enum, [
    ...AI_TEXT_FEATURES,
  ]);
});

test("native runtime requests are refused, while real fallback requests reach the planner", async () => {
  const { agentTurn, nativeFeatureReply } = await import(
    "../src/services/m365Agent.js"
  );
  const user: any = { id: "user-a", email: "a@example.com" };
  for (const [text, feature] of [
    ["run the VBA macro on this sheet", "vba-com"],
  ] as const) {
    // agentTurn would call the model for an ordinary request; here it returns first.
    const reply = await agentTurn(user, {
      consent: true,
      language: "en",
      messages: [{ role: "user", content: text }],
    });
    assert.equal(reply.content, NATIVE_FEATURE_ADVICE[feature]);
    assert.deepEqual(reply.tool_calls, []);
    assert.equal(reply.usage, undefined);
  }
  assert.equal(
    nativeFeatureReply([
      { role: "user", content: "use Solver to maximize profit" },
    ]),
    undefined,
  );
  assert.equal(
    nativeFeatureReply([
      { role: "user", content: "Create a Power Pivot model" },
    ]),
    undefined,
  );
  // An ordinary request, a report from the add-in and a tool answer are never screened.
  assert.equal(
    nativeFeatureReply([{ role: "user", content: "pivot Sales by Region" }]),
    undefined,
  );
  assert.equal(
    nativeFeatureReply([
      {
        role: "user",
        content: "[Report from the add-in] applied a Power Pivot",
      },
    ]),
    undefined,
  );
});

test("a native request is refused with a structured answer on every host", () => {
  for (const platform of ["web", "windows", "mac", "unknown"] as const) {
    const refusal = refuseNativeRequest(
      "build a Power Pivot data model",
      baseCapabilityContext({ platform, canRead: true, canWrite: true }),
    );
    assert.equal(refusal?.kind, "unsupported_native_feature");
    assert.equal(refusal?.status, "unsupported");
    assert.equal(refusal?.fallbackFeature, "pivot-table");
  }
});
