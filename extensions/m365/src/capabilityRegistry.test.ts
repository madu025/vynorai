import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AI_TEXT_FEATURES,
  CAPABILITY_FEATURES,
  CAPABILITY_REGISTRY,
  hasNativeFallback,
  NATIVE_FEATURE_ADVICE,
  NATIVE_FALLBACK_FEATURES,
  NATIVE_ONLY_FEATURES,
  baseCapabilityContext,
  classifyNativeRequest,
  hostPlatformFromOffice,
  refuseNativeRequest,
  resolveAllCapabilities,
  resolveCapability,
  stricterCapability,
  supportedApiSets,
  type CapabilityContext,
} from "./capabilityRegistry.js";
import { ACTION_REQUIREMENTS } from "./diagnostics.js";
import { SINHALA_MESSAGE_KEYS } from "./messagesSi.js";
import { TAMIL_MESSAGE_KEYS } from "./messagesTa.js";
import {
  AgentToolError,
  PersonalMask,
  runAgent,
  type AgentHost,
} from "./agent.js";
import { interpretInstruction } from "./intent.js";

const ALL_API = ["1.1", "1.4", "1.7", "1.8", "1.9", "1.10"];
const ready = (over: Partial<CapabilityContext> = {}): CapabilityContext =>
  baseCapabilityContext({
    platform: "web",
    apiSets: ALL_API,
    canRead: true,
    canWrite: true,
    aiEnabled: true,
    graphScopes: ["https://graph.microsoft.com/Mail.Send"],
    ...over,
  });

test("the add-in and backend copies match the contract registry byte for byte", () => {
  const source = new URL(
    "../../../packages/m365-contracts/src/capabilities.ts",
    import.meta.url,
  );
  if (!existsSync(source)) return; // a build context without the packages folder
  const contract = readFileSync(source, "utf8");
  assert.equal(
    readFileSync(new URL("./capabilityRegistry.ts", import.meta.url), "utf8"),
    contract,
  );
  const backend = new URL(
    "../../../backend/src/services/m365Capabilities.ts",
    import.meta.url,
  );
  if (existsSync(backend))
    assert.equal(readFileSync(backend, "utf8"), contract);
});

test("one key set: registry, resolver, native advice and AI text features agree", () => {
  assert.deepEqual(
    Object.keys(CAPABILITY_REGISTRY).sort(),
    [...CAPABILITY_FEATURES].sort(),
  );
  assert.deepEqual(
    Object.keys(resolveAllCapabilities(ready())).sort(),
    [...CAPABILITY_FEATURES].sort(),
  );
  assert.deepEqual(
    Object.keys(NATIVE_FEATURE_ADVICE).sort(),
    [...NATIVE_ONLY_FEATURES].sort(),
  );
  for (const feature of AI_TEXT_FEATURES)
    assert.equal(CAPABILITY_REGISTRY[feature].execution, "masked_ai");
  for (const [feature, spec] of Object.entries(CAPABILITY_REGISTRY)) {
    if (spec.base === "available_with_fallback")
      assert.ok(
        spec.fallback,
        `${feature} claims a fallback status without a fallback`,
      );
    if (spec.fallback) {
      assert.ok(CAPABILITY_FEATURES.includes(spec.fallback), feature);
      // A fallback must be something that really runs without a companion or a sandbox.
      const target = CAPABILITY_REGISTRY[spec.fallback].execution;
      assert.ok(
        target !== "windows_companion" && target !== "managed_python",
        `${feature} falls back to ${spec.fallback}`,
      );
    }
    if (
      spec.execution === "windows_companion" ||
      spec.execution === "managed_python"
    )
      assert.ok(spec.fallback, `${feature} needs a stated alternative`);
  }
});

test("the pane's Excel API requirements equal the registry's", () => {
  for (const feature of CAPABILITY_FEATURES) {
    const required = ACTION_REQUIREMENTS[feature];
    const spec = CAPABILITY_REGISTRY[feature];
    if (required && spec.execution === "office_js")
      assert.equal(spec.excelApi, required, feature);
  }
});

test("every native-feature answer has a Sinhala and a Tamil wording", () => {
  for (const message of Object.values(NATIVE_FEATURE_ADVICE)) {
    assert.ok(SINHALA_MESSAGE_KEYS.includes(message), `si: ${message}`);
    assert.ok(TAMIL_MESSAGE_KEYS.includes(message), `ta: ${message}`);
  }
});

test("every verdict carries its execution layer and host evidence", () => {
  for (const platform of ["web", "windows", "mac", "unknown"] as const) {
    const report = resolveAllCapabilities(ready({ platform }));
    for (const [feature, verdict] of Object.entries(report)) {
      assert.ok(verdict.execution, feature);
      assert.ok(Array.isArray(verdict.requirement.hosts), feature);
      assert.equal(verdict.observed.platform, platform);
      if (verdict.status === "unsupported") assert.ok(verdict.reason, feature);
    }
  }
});

test("Web, Windows and Mac route the same Office.js features and no native ones", () => {
  for (const platform of ["web", "windows", "mac"] as const) {
    const context = ready({ platform });
    for (const feature of [
      "pivot-table",
      "chart",
      "dashboard",
      "slicer",
      "forecast",
    ])
      assert.notEqual(
        resolveCapability(feature, context).status,
        "unsupported",
      );
    for (const feature of NATIVE_ONLY_FEATURES) {
      const verdict = resolveCapability(feature, context);
      assert.equal(verdict.status, "unsupported", `${platform}/${feature}`);
      assert.ok(verdict.fallbackFeature, `${platform}/${feature}`);
    }
  }
});

test("the companion is exposed only on Windows, signed, installed and approved", () => {
  const states = ["not_installed", "unsigned", "unsupported_host"] as const;
  for (const companion of states) {
    const verdict = resolveCapability(
      "power-pivot",
      ready({ platform: "windows", companion }),
    );
    assert.equal(verdict.status, "unsupported");
    assert.equal(verdict.execution, "windows_companion");
  }
  for (const platform of ["web", "mac", "unknown"] as const) {
    // Even a companion that claims to be ready is ignored off Windows: no false parity.
    const verdict = resolveCapability(
      "solver",
      ready({ platform, companion: "ready" }),
    );
    assert.equal(verdict.status, "unsupported");
    assert.match(verdict.reason!, /Windows/);
  }
  const ok = resolveCapability(
    "solver",
    ready({ platform: "windows", companion: "ready" }),
  );
  assert.equal(ok.status, "consent_required");
  assert.equal(ok.observed.companion, "ready");
  // Reading and writing are still needed.
  assert.equal(
    resolveCapability(
      "solver",
      ready({ platform: "windows", companion: "ready", canWrite: false }),
    ).status,
    "unsupported",
  );
});

test("Python requests use the local alternative without a worker and never require installation", () => {
  const verdict = resolveCapability("python-sandbox", ready());
  assert.equal(verdict.status, "unsupported");
  assert.equal(verdict.execution, "managed_python");
  assert.equal(verdict.fallbackFeature, "local-code");
  assert.equal(hasNativeFallback("python-sandbox"), true);
  assert.doesNotMatch(
    `${verdict.reason} ${NATIVE_FEATURE_ADVICE["python-sandbox"]}`,
    /\b(?:pip|download|install (?:python|pandas))\b/i,
  );
  // Even with a worker the run needs approval; it is never "available" on its own.
  assert.equal(
    resolveCapability("python-sandbox", ready({ sandbox: "ready" })).status,
    "consent_required",
  );
});

test("a missing host API gives a real fallback or an honest refusal", () => {
  const old = ready({ apiSets: ["1.1", "1.4"] });
  assert.equal(
    resolveCapability("slicer", old).status,
    "available_with_fallback",
  );
  assert.equal(
    resolveCapability("slicer", old).fallbackFeature,
    "filtered-view",
  );
  assert.match(resolveCapability("slicer", old).reason!, /slicers/i);
  assert.equal(
    resolveCapability("dashboard", old).status,
    "available_with_fallback",
  );
  assert.equal(
    resolveCapability("pivot-table", old).fallbackFeature,
    "formula-report",
  );
  assert.equal(resolveCapability("chart", old).status, "available");
  assert.equal(
    resolveCapability("chart", ready({ apiSets: ["1.1"] })).status,
    "unsupported",
  );
});

test("unevaluated host APIs fail closed instead of claiming Office.js availability", () => {
  const unevaluated = ready({ apiSets: undefined });
  assert.equal(
    resolveCapability("pivot-table", unevaluated).status,
    "available_with_fallback",
  );
  assert.equal(
    resolveCapability("pivot-table", unevaluated).fallbackFeature,
    "formula-report",
  );
  assert.equal(resolveCapability("chart", unevaluated).status, "unsupported");
  assert.match(
    resolveCapability("chart", unevaluated).reason!,
    /not evaluated/i,
  );
});

test("account limits and unknown keys fail closed", () => {
  assert.equal(
    resolveCapability("forecast", ready({ canRead: false })).status,
    "unsupported",
  );
  assert.equal(
    resolveCapability("dashboard", ready({ canWrite: false })).status,
    "unsupported",
  );
  assert.equal(
    resolveCapability("sentiment", ready({ aiEnabled: false })).status,
    "unsupported",
  );
  assert.equal(
    resolveCapability("sentiment", ready()).status,
    "consent_required",
  );
  assert.equal(
    resolveCapability("sentiment", ready({ aiConsent: true })).status,
    "available",
  );
  assert.equal(
    resolveCapability("email-share", ready({ graphScopes: [] })).status,
    "unsupported",
  );
  assert.equal(
    resolveCapability("email-share", ready()).status,
    "consent_required",
  );
  const unknown = resolveCapability("teleport", ready());
  assert.equal(unknown.status, "unsupported");
  assert.equal(
    resolveCapability("forecast", baseCapabilityContext()).status,
    "unsupported",
  );
});

test("Python-free analytics stay available on every host", () => {
  for (const platform of ["web", "windows", "mac"] as const) {
    const report = resolveAllCapabilities(ready({ platform }));
    for (const feature of [
      "forecast",
      "anomaly",
      "clustering",
      "cohort",
      "financial",
      "fuzzy-match",
      "sensitivity",
      "optimisation",
      "relationships",
      "pivot-table",
      "chart",
      "dashboard",
      "export-csv",
      "export-xlsx",
      "export-pdf",
      "local-code",
    ] as const) {
      const verdict = report[feature];
      assert.ok(
        verdict.status === "available" ||
          verdict.status === "available_with_fallback",
        `${platform}/${feature}: ${verdict.status}`,
      );
      assert.ok(
        verdict.execution === "deterministic_local" ||
          verdict.execution === "office_js",
        feature,
      );
    }
  }
});

test("the stricter verdict wins and the host evidence wins a tie", () => {
  const a = resolveCapability("forecast", ready());
  const b = resolveCapability("forecast", ready({ platform: "mac" }));
  assert.equal(stricterCapability(a, b).observed.platform, "mac");
  const worse = resolveCapability("forecast", ready({ canRead: false }));
  assert.equal(stricterCapability(worse, a).status, "unsupported");
});

test("Office platforms and API sets map to the host kinds", () => {
  assert.equal(hostPlatformFromOffice("OfficeOnline"), "web");
  assert.equal(hostPlatformFromOffice("PC"), "windows");
  assert.equal(hostPlatformFromOffice("Mac"), "mac");
  assert.equal(hostPlatformFromOffice("iOS"), "unknown");
  assert.deepEqual(supportedApiSets({ "1.4": true, "1.8": false }), ["1.4"]);
  assert.equal(supportedApiSets(undefined), undefined);
});

test("native requests are recognised, ordinary and macro-writing requests are not", () => {
  const cases: Array<[string, string | undefined]> = [
    ["Create a Power Pivot model of Orders and Customers", "power-pivot"],
    ["add these tables to the Data Model", "data-model"],
    ["make an OLAP PivotTable from the cube", "olap-pivot"],
    ["run the VBA macro on this sheet", "vba-com"],
    ["use Solver to maximize profit", "solver"],
    ["open Scenario Manager", "scenario-manager"],
    ["add sparklines per row", "sparklines"],
    ["run a python script with pandas on this table", "python-sandbox"],
    ["use numpy to cluster the rows", "python-sandbox"],
    ["create a pivot table of Sales by Region", undefined],
    ["write a VBA macro that sorts by Sales", undefined],
    ["count rows where Skill is Python", undefined],
    ["forecast next quarter and flag anomalies", undefined],
  ];
  for (const [text, feature] of cases)
    assert.equal(classifyNativeRequest(text), feature, text);
});

test("refusals are structured, name the alternative and never claim success", () => {
  const refusal = refuseNativeRequest(
    "Create a Power Pivot model",
    baseCapabilityContext(),
  )!;
  assert.equal(refusal.kind, "unsupported_native_feature");
  assert.equal(refusal.status, "unsupported");
  assert.equal(refusal.fallbackFeature, "pivot-table");
  assert.match(refusal.message, /regular PivotTable/);
  assert.equal(
    refuseNativeRequest("sum Sales by Region", baseCapabilityContext()),
    undefined,
  );
});

test("fallback-capable native requests are not treated like hard refusals", () => {
  for (const feature of NATIVE_FALLBACK_FEATURES)
    assert.equal(hasNativeFallback(feature), true, feature);
  assert.equal(hasNativeFallback("vba-com"), false);
});

test("the local reader routes Sparklines to a real line-chart fallback", () => {
  const result = interpretInstruction(
    "add sparklines per Region",
    ["Region", "Sales"],
    [["N", 1]],
  );
  assert.deepEqual(result.actions, ["chart"]);
  assert.deepEqual(result.specs.chart, {
    category: 0,
    value: 1,
    chartType: "line",
  });
  assert.deepEqual(result.problems, []);
  const python = interpretInstruction(
    "run python on Sales",
    ["Region", "Sales"],
    [["N", 1]],
  );
  assert.deepEqual(python.actions, []);
  assert.match(python.problems[0], /nothing needs to be installed/);
  // Ordinary pivot and sparkline wording keep their behaviour.
  const pivot = interpretInstruction(
    "pivot table of total Sales by Region",
    ["Region", "Sales"],
    [["N", 1]],
  );
  assert.deepEqual(pivot.actions, ["pivot-table"]);
  assert.deepEqual(
    interpretInstruction("add sparklines", ["Region", "Sales"], [["N", 1]])
      .actions,
    ["chart"],
  );
});

test("the agent routes Python requests to the local alternative without running Python", async () => {
  let touched = false;
  let modelCalled = false;
  const touch = async () => {
    touched = true;
    throw new AgentToolError("must not run");
  };
  const host = {
    getWorkbook: touch,
    readRange: touch,
    calculate: touch,
    checkStep: touch,
  } as unknown as AgentHost;
  const mask = {
    mask: (text: string) => text,
    unmask: (text: string) => text,
  } as any;
  const run = await runAgent({
    request: "run python on this sheet",
    host,
    mask,
    model: async (messages) => {
      modelCalled = true;
      return {
        content: messages.at(-1)?.content ?? "",
        tool_calls: [],
      };
    },
    maxTurns: 1,
  });
  assert.equal(touched, false);
  assert.equal(modelCalled, true);
  assert.equal(run.unsupported, undefined);
  assert.deepEqual(run.changes, []);
  assert.match(
    run.messages[0]?.content ?? "",
    /local JavaScript\/WASM|Python is not run/i,
  );
});

test("the agent loop allows a native fallback request to reach the planner with guidance", async () => {
  let touched = false;
  const run = await runAgent({
    request: "use Solver to maximize profit",
    host: {
      getWorkbook: async () => {
        touched = true;
        return { sheets: [{ name: "Data", rows: 2, columns: 2 }] };
      },
      readRange: async () => ({
        address: "A1:B2",
        values: [
          ["A", "B"],
          [1, 2],
        ],
      }),
      calculate: async () => [[42]],
      checkStep: async () => ({ ok: false, error: "no action" }),
    },
    mask: new PersonalMask(),
    model: async (messages) => ({
      content: messages.at(-1)?.content ?? "",
      tool_calls: [],
    }),
    maxTurns: 1,
  });
  assert.equal(run.unsupported, undefined);
  assert.equal(touched, false);
  assert.match(
    run.messages[0]?.content ?? "",
    /goal_seek|what_if|deterministic fallback/i,
  );
});

test("every local analytics feature is backed by real TypeScript, never Python", async () => {
  const analytics = await import("./advancedAnalytics.js");
  const actions = await import("./agentActions.js");
  const excel = await import("./officeExcel.js");
  const email = await import("./email.js");
  const macro = await import("./macroGen.js");
  const relations = await import("./relationships.js");
  const sandbox = await import("./codeSandbox.js");
  const backing: Record<string, unknown> = {
    forecast: analytics.advancedForecast,
    cohort: analytics.buildCohortRetention,
    sensitivity: analytics.buildSensitivityMatrix,
    financial: analytics.financialMetrics,
    "fuzzy-match": analytics.findFuzzyMatches,
    split: analytics.splitStructuredValue,
    anomaly: analytics.findAnomalies,
    "fraud-risk": analytics.scoreFraudRisk,
    "root-cause": analytics.compareRootCauses,
    clustering: analytics.clusterNumeric,
    similarity: analytics.groupSimilarValues,
    // Deterministic optimisation is Goal Seek (secant, then bisection) plus the what-if grid.
    optimisation:
      actions.ACTION_TOOLS.goal_seek && actions.ACTION_TOOLS.what_if,
    relationships: relations.mapRelationships,
    "macro-text": macro.generateMacro,
    "local-code": sandbox.workerSource,
    "export-csv": excel.excelValuesToCsv,
    "export-xlsx": excel.readExcelWorkbookBase64,
    "export-pdf": excel.readExcelPdfBase64,
    "email-share": email.sendExcelWorkbookEmail,
  };
  for (const [feature, implementation] of Object.entries(backing)) {
    assert.ok(implementation, `${feature} has no implementation`);
    const execution =
      CAPABILITY_REGISTRY[feature as keyof typeof CAPABILITY_REGISTRY]
        .execution;
    assert.ok(
      execution !== "managed_python" && execution !== "windows_companion",
      feature,
    );
  }
});

test("security review: Singlish Python phrasing, =PY() and Sinhala/Tamil Python words are refused, ordinary words are not", () => {
  for (const text of [
    "python eken forecast ekak karanna",
    "do this in python",
    "=PY(A1)",
    "පයිතන් වලින් විශ්ලේෂණය කරන්න",
    "பைதான் மூலம் செய்யவும்",
  ])
    assert.equal(classifyNativeRequest(text), "python-sandbox", text);
  for (const text of [
    "total sales by region",
    "create a pivot table of sales",
    "forecast next month revenue",
  ])
    assert.equal(classifyNativeRequest(text), undefined, text);
});
