/**
 * The one capability model for the VynorAI Excel add-in. The contract package, the backend
 * (m365Diagnostics, m365Agent), the pane (diagnostics, taskpane, intent) and the agent loop all read
 * these keys and this resolver; a test fails when a copy of this file drifts. This file has no
 * imports so it can be copied byte for byte into the backend and the add-in, which build separately.
 *
 * Rules the resolver enforces (fail closed):
 * - an unknown feature, an unknown host platform or a missing access flag is never "available";
 * - a native-only feature (Power Pivot, Solver, VBA/COM ...) is never routed to Office.js;
 * - a feature that sends data to the AI service, to Microsoft Graph, to a Windows companion or to a
 *   managed sandbox is "consent_required" until the person approves it;
 * - a missing host API with a real fallback is "available_with_fallback", otherwise "unsupported".
 */

export type ExecutionLayer =
  | "office_js"
  | "deterministic_local"
  | "masked_ai"
  | "microsoft_graph"
  | "windows_companion"
  | "managed_python";

export type CapabilityStatus =
  | "available"
  | "available_with_fallback"
  | "unsupported"
  | "consent_required";

export type HostPlatform = "web" | "windows" | "mac" | "unknown";
export type CompanionState =
  | "not_installed"
  | "unsigned"
  | "unsupported_host"
  | "ready";
export type SandboxState = "unavailable" | "ready";

/** Every feature key, in one list. Backend, pane and agent import this and never re-list keys. */
export const CAPABILITY_FEATURES = [
  // Deterministic analysis that runs in TypeScript or in Excel formulas on the device.
  "forecast",
  "cohort",
  "sensitivity",
  "financial",
  "fuzzy-match",
  "split",
  "anomaly",
  "fraud-risk",
  "root-cause",
  "clustering",
  "similarity",
  "optimisation",
  "relationships",
  "formula-report",
  "macro-text",
  "local-code",
  // Office.js objects and exports.
  "dashboard",
  "slicer",
  "filtered-view",
  "pivot-table",
  "chart",
  "export-csv",
  "export-xlsx",
  "export-pdf",
  // Masked AI text analysis (consent per request).
  "sentiment",
  "keywords",
  "classification",
  // Microsoft Graph, after explicit approval of the recipient and the content.
  "email-share",
  // Native desktop features: never faked, never Office.js.
  "power-pivot",
  "data-model",
  "olap-pivot",
  "vba-com",
  "solver",
  "scenario-manager",
  "sparklines",
  // Managed Python sandbox (separate isolated worker, never the user's computer).
  "python-sandbox",
] as const;

export type CapabilityFeature = (typeof CAPABILITY_FEATURES)[number];

/** The masked-AI text features; the agent tool, the API client and the backend schema use this list. */
export const AI_TEXT_FEATURES = [
  "sentiment",
  "keywords",
  "classification",
] as const satisfies readonly CapabilityFeature[];
export type AiTextFeature = (typeof AI_TEXT_FEATURES)[number];

/** Features that exist only as native desktop capabilities (companion) or in the sandbox. */
export const NATIVE_ONLY_FEATURES = [
  "power-pivot",
  "data-model",
  "olap-pivot",
  "vba-com",
  "solver",
  "scenario-manager",
  "sparklines",
  "python-sandbox",
] as const satisfies readonly CapabilityFeature[];
export type NativeOnlyFeature = (typeof NATIVE_ONLY_FEATURES)[number];

type Need = "read" | "write" | "ai" | "graph_mail";

interface CapabilitySpec {
  execution: ExecutionLayer;
  /** What the feature gives when everything it needs is present. */
  base: "available" | "available_with_fallback";
  needs: readonly Need[];
  /** Minimum ExcelApi set for an Office.js object (undefined: no special requirement). */
  excelApi?: string;
  /** Where a real alternative exists, for an unsupported host or a missing API set. */
  fallback?: CapabilityFeature;
  /** Reason shown when the API set is missing and the fallback is used. */
  apiFallbackReason?: string;
}

export const CAPABILITY_REGISTRY: Readonly<
  Record<CapabilityFeature, CapabilitySpec>
> = {
  forecast: {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  cohort: {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  sensitivity: {
    execution: "deterministic_local",
    base: "available",
    needs: ["write"],
  },
  financial: {
    execution: "deterministic_local",
    base: "available",
    needs: ["read"],
  },
  "fuzzy-match": {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  split: {
    execution: "deterministic_local",
    base: "available",
    needs: ["write"],
  },
  anomaly: {
    execution: "deterministic_local",
    base: "available",
    needs: ["read"],
  },
  "fraud-risk": {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["write"],
  },
  "root-cause": {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  clustering: {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  similarity: {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["read"],
  },
  optimisation: {
    execution: "deterministic_local",
    base: "available_with_fallback",
    needs: ["write"],
  },
  relationships: {
    execution: "deterministic_local",
    base: "available",
    needs: ["read"],
  },
  "formula-report": {
    execution: "deterministic_local",
    base: "available",
    needs: ["write"],
  },
  "macro-text": {
    execution: "deterministic_local",
    base: "available",
    needs: [],
  },
  "local-code": {
    execution: "deterministic_local",
    base: "available",
    needs: ["read"],
  },
  dashboard: {
    execution: "office_js",
    base: "available",
    needs: ["write"],
    excelApi: "1.8",
    fallback: "formula-report",
    apiFallbackReason:
      "This Excel host supports the report sheet but not every dashboard object.",
  },
  slicer: {
    execution: "office_js",
    base: "available_with_fallback",
    needs: ["write"],
    excelApi: "1.10",
    fallback: "filtered-view",
    apiFallbackReason:
      "This Excel host does not support slicers; use a filtered result instead.",
  },
  "filtered-view": {
    execution: "office_js",
    base: "available",
    needs: ["write"],
    excelApi: "1.4",
  },
  "pivot-table": {
    execution: "office_js",
    base: "available",
    needs: ["write"],
    excelApi: "1.8",
    fallback: "formula-report",
    apiFallbackReason:
      "This Excel host cannot create PivotTables; a formula report is created instead.",
  },
  chart: {
    execution: "office_js",
    base: "available",
    needs: ["write"],
    excelApi: "1.4",
  },
  "export-csv": {
    execution: "office_js",
    base: "available",
    needs: ["read"],
    excelApi: "1.4",
  },
  "export-xlsx": {
    execution: "office_js",
    base: "available",
    needs: ["read"],
    excelApi: "1.1",
  },
  "export-pdf": {
    execution: "office_js",
    base: "available",
    needs: ["read"],
    excelApi: "1.1",
  },
  sentiment: {
    execution: "masked_ai",
    base: "available",
    needs: ["read", "ai"],
  },
  keywords: {
    execution: "masked_ai",
    base: "available",
    needs: ["read", "ai"],
  },
  classification: {
    execution: "masked_ai",
    base: "available",
    needs: ["read", "ai"],
  },
  "email-share": {
    execution: "microsoft_graph",
    base: "available",
    needs: ["read", "graph_mail"],
  },
  "power-pivot": {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "pivot-table",
  },
  "data-model": {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "relationships",
  },
  "olap-pivot": {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "pivot-table",
  },
  "vba-com": {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "macro-text",
  },
  solver: {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "optimisation",
  },
  "scenario-manager": {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "sensitivity",
  },
  sparklines: {
    execution: "windows_companion",
    base: "available",
    needs: ["read", "write"],
    fallback: "chart",
  },
  "python-sandbox": {
    execution: "managed_python",
    base: "available",
    needs: ["read"],
    fallback: "local-code",
  },
};

/** What the host and the account can do right now. Missing facts mean "no", never "yes". */
export interface CapabilityContext {
  platform: HostPlatform;
  /** Supported ExcelApi versions on this host. Undefined: not evaluated (the server does not know). */
  apiSets?: readonly string[];
  companion: CompanionState;
  sandbox: SandboxState;
  /** The tenant allows AI analysis. */
  aiEnabled: boolean;
  /** The person agreed to the masked AI request being resolved now. */
  aiConsent: boolean;
  /** Delegated Graph scopes the signed-in person holds (case-insensitive). Undefined: not evaluated (the server). */
  graphScopes?: readonly string[];
  canRead: boolean;
  canWrite: boolean;
}

export interface CapabilityRequirement {
  /** Hosts where the route works. */
  hosts: readonly HostPlatform[];
  excelApi?: string;
  needs: readonly string[];
}

export interface CapabilityObserved {
  platform: HostPlatform;
  /** null when the API sets were not evaluated; false when missing. */
  excelApi: boolean | null;
  companion?: CompanionState;
  sandbox?: SandboxState;
}

export interface AnalysisCapability {
  status: CapabilityStatus;
  execution: ExecutionLayer;
  reason?: string;
  fallbackFeature?: CapabilityFeature;
  requirement: CapabilityRequirement;
  observed: CapabilityObserved;
}

export type AdvancedCapabilityReport = Record<string, AnalysisCapability>;

const RANK: Record<CapabilityStatus, number> = {
  available: 0,
  available_with_fallback: 1,
  consent_required: 2,
  unsupported: 3,
};

/** The more restrictive of two verdicts for the same feature; on a tie the second (host evidence) wins. */
export function stricterCapability(
  a: AnalysisCapability,
  b: AnalysisCapability,
): AnalysisCapability {
  return RANK[b.status] >= RANK[a.status] ? b : a;
}

export function isCapabilityFeature(
  value: unknown,
): value is CapabilityFeature {
  return (
    typeof value === "string" &&
    (CAPABILITY_FEATURES as readonly string[]).includes(value)
  );
}

function hostsFor(spec: CapabilitySpec): readonly HostPlatform[] {
  return spec.execution === "windows_companion"
    ? ["windows"]
    : ["web", "windows", "mac"];
}

const NEED_TEXT: Record<Need, string> = {
  read: "Excel read access",
  write: "Excel write access",
  ai: "AI analysis enabled for the tenant",
  graph_mail: "Graph Mail.Send consent",
};

function requirementFor(spec: CapabilitySpec): CapabilityRequirement {
  const needs: string[] = spec.needs.map((need) => NEED_TEXT[need]);
  if (spec.execution === "windows_companion")
    needs.push("signed VynorAI Windows companion");
  if (spec.execution === "managed_python")
    needs.push("isolated sandbox worker");
  return {
    hosts: hostsFor(spec),
    ...(spec.excelApi ? { excelApi: spec.excelApi } : {}),
    needs,
  };
}

const COMPANION_REASON: Record<Exclude<CompanionState, "ready">, string> = {
  not_installed:
    "This needs the optional signed VynorAI Windows companion, which is not installed.",
  unsigned:
    "The VynorAI Windows companion found on this computer is not signed or not trusted, so it is not used.",
  unsupported_host:
    "The VynorAI Windows companion does not support this Excel installation.",
};

/**
 * Decides one feature for one host and account. Pure: the same input always gives the same answer,
 * and it never reads the workbook.
 */
export function resolveCapability(
  feature: string,
  context: CapabilityContext,
): AnalysisCapability {
  const observedBase: CapabilityObserved = {
    platform: context.platform,
    excelApi: null,
  };
  if (!isCapabilityFeature(feature))
    return {
      status: "unsupported",
      execution: "deterministic_local",
      reason: "This feature is not known to the add-in.",
      requirement: { hosts: [], needs: [] },
      observed: observedBase,
    };
  const spec = CAPABILITY_REGISTRY[feature];
  const requirement = requirementFor(spec);
  const observed: CapabilityObserved = { ...observedBase };
  if (spec.excelApi && context.apiSets)
    observed.excelApi = context.apiSets.includes(spec.excelApi);
  const refuse = (reason: string): AnalysisCapability => ({
    status: "unsupported",
    execution: spec.execution,
    reason,
    ...(spec.fallback ? { fallbackFeature: spec.fallback } : {}),
    requirement,
    observed,
  });

  if (spec.execution === "windows_companion") {
    observed.companion = context.companion;
    if (context.platform !== "windows")
      return refuse(
        context.platform === "unknown"
          ? "This needs desktop Excel on Windows with the VynorAI companion; this host was not identified."
          : `This needs desktop Excel on Windows with the VynorAI companion; it is not available in Excel on ${
              context.platform === "web" ? "the web" : "Mac"
            }.`,
      );
    if (context.companion !== "ready")
      return refuse(COMPANION_REASON[context.companion]);
  }
  if (spec.execution === "managed_python") {
    observed.sandbox = context.sandbox;
    if (context.sandbox !== "ready")
      return refuse(
        "The isolated sandbox worker is not provisioned, so nothing is run. Nothing needs to be installed on your computer.",
      );
  }
  if (spec.needs.includes("read") && !context.canRead)
    return refuse("Excel read access is unavailable.");
  if (spec.needs.includes("write") && !context.canWrite)
    return refuse("Excel write access is unavailable.");
  if (spec.needs.includes("ai") && !context.aiEnabled)
    return refuse("AI analysis is disabled or unavailable.");
  if (
    spec.needs.includes("graph_mail") &&
    context.graphScopes &&
    !context.graphScopes.some(
      (scope) => scope.toLowerCase().split("/").pop() === "mail.send",
    )
  )
    return refuse("Microsoft Graph Mail.Send consent has not been granted.");

  if (spec.excelApi && context.apiSets && observed.excelApi === false) {
    if (spec.fallback)
      return {
        status: "available_with_fallback",
        execution: spec.execution,
        reason:
          spec.apiFallbackReason ??
          `This Excel host does not support ExcelApi ${spec.excelApi}.`,
        fallbackFeature: spec.fallback,
        requirement,
        observed,
      };
    return refuse(
      `This Excel host does not support ExcelApi ${spec.excelApi}.`,
    );
  }

  // Anything that sends data out, writes through a native layer or runs elsewhere needs approval.
  const needsApproval =
    spec.execution === "windows_companion" ||
    spec.execution === "managed_python" ||
    spec.execution === "microsoft_graph" ||
    (spec.execution === "masked_ai" && !context.aiConsent);
  if (needsApproval)
    return {
      status: "consent_required",
      execution: spec.execution,
      reason:
        spec.execution === "microsoft_graph"
          ? "Nothing is sent until you approve the recipient and the content."
          : spec.execution === "masked_ai"
            ? "Masked cells are sent to the AI service only after you agree."
            : "This runs outside the workbook only after you approve it.",
      requirement,
      observed,
    };
  return {
    status: spec.base,
    execution: spec.execution,
    ...(spec.base === "available_with_fallback" && spec.fallback
      ? { fallbackFeature: spec.fallback }
      : {}),
    requirement,
    observed,
  };
}

/** Every feature for one context, keyed by feature name. */
export function resolveAllCapabilities(
  context: CapabilityContext,
): AdvancedCapabilityReport {
  return Object.fromEntries(
    CAPABILITY_FEATURES.map((feature) => [
      feature,
      resolveCapability(feature, context),
    ]),
  );
}

/** Office.js `Office.context.platform` to the host kind used here. */
export function hostPlatformFromOffice(value: unknown): HostPlatform {
  const text = String(value ?? "").toLowerCase();
  if (text === "officeonline" || text === "online" || text === "web")
    return "web";
  if (text === "pc" || text === "universal" || text === "windows")
    return "windows";
  if (text === "mac") return "mac";
  return "unknown";
}

/** The ExcelApi versions marked supported in a `{ "1.4": true, ... }` record. */
export function supportedApiSets(
  excelApi: Record<string, boolean> | undefined,
): string[] {
  return Object.entries(excelApi ?? {})
    .filter(([, supported]) => supported === true)
    .map(([version]) => version);
}

/** The context for a host that has none of the optional layers (the default until they exist). */
export function baseCapabilityContext(
  overrides: Partial<CapabilityContext> = {},
): CapabilityContext {
  return {
    platform: "unknown",
    companion: "not_installed",
    sandbox: "unavailable",
    aiEnabled: false,
    aiConsent: false,
    canRead: false,
    canWrite: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Native-feature requests: recognised from the words, answered truthfully, never faked.      */
/* ------------------------------------------------------------------------------------------ */

const NATIVE_REQUEST_PATTERNS: ReadonlyArray<[NativeOnlyFeature, RegExp]> = [
  ["olap-pivot", /\bolap\b|\b(?:cube|ssas)\b[^.]{0,40}\bpivot/i],
  [
    "power-pivot",
    /\bpower\s*-?\s*pivot\b|\bdax\s+(?:formula|measure|calculation)s?\b/i,
  ],
  ["data-model", /\bdata\s*-?\s*model\b/i],
  [
    "vba-com",
    /\b(?:run|execute|launch|start|call)\b[^.]{0,40}\b(?:vba|macros?|com\s+(?:add-?in|automation|object))\b|\b(?:vsto|activex|com\s+automation)\b/i,
  ],
  [
    "solver",
    /\b(?:use|run|open|with|using|the|excel'?s?)\s+solver\b|\bsolver\s+(?:add-?in|tool|model)\b|\bsolver\b[^.]{0,60}\b(?:maximi[sz]e|minimi[sz]e|constraints?|objective)\b/i,
  ],
  ["scenario-manager", /\bscenario\s*manager\b/i],
  ["sparklines", /\bsparklines?\b/i],
  [
    "python-sandbox",
    /\b(?:run|execute|use|using|with|via|in|write|create|generate|build)\b[^.]{0,40}\b(?:python|pandas|numpy|scipy|scikit-?learn|jupyter|matplotlib)\b|\b(?:python|pandas|numpy|jupyter)\s+(?:script|code|notebook|program|library|package|model)\b|\b(?:pandas|numpy|jupyter|matplotlib|scikit-?learn)\b|\bpython\s+(?:eken|walin|wala|ekak)\b|\bpy\s*\(|පයිතන්|பைதான்/i,
  ],
];

/** The feature a request asks for when it can only be a native or Python feature, else undefined. */
export function classifyNativeRequest(
  text: string,
): NativeOnlyFeature | undefined {
  const value = String(text ?? "");
  for (const [feature, pattern] of NATIVE_REQUEST_PATTERNS)
    if (pattern.test(value)) return feature;
  return undefined;
}

/**
 * English wording of the honest answer: what is not available and the closest thing that is. The
 * add-in translates these exact strings (messagesSi / messagesTa); a test keeps them in step.
 */
export const NATIVE_FEATURE_ADVICE: Readonly<
  Record<NativeOnlyFeature, string>
> = {
  "power-pivot":
    "Power Pivot is not available in this add-in. Use a regular PivotTable or a formula report on a new sheet instead.",
  "data-model":
    "The Excel Data Model is not available in this add-in. Use a regular PivotTable or a formula report with lookups across sheets instead.",
  "olap-pivot":
    "PivotTables on an OLAP or Data Model source are not available in this add-in. Use a regular PivotTable on a table, or a formula report, instead.",
  "vba-com":
    "Running VBA or COM automation is not available in this add-in. I can write the macro as text for you to review and run yourself.",
  solver:
    "Solver is not available in this add-in. Use a what-if sensitivity table that tries each value and shows the results instead.",
  "scenario-manager":
    "Scenario Manager is not available in this add-in. Use a what-if sensitivity table with the scenarios side by side instead.",
  sparklines:
    "Sparklines are not available in this Excel add-in yet. Use a line chart on a new result sheet instead.",
  "python-sandbox":
    "Python is not run in this add-in, and nothing needs to be installed on your computer. Use a formula, a PivotTable or the built-in analysis instead.",
};

export interface NativeFeatureRefusal {
  kind: "unsupported_native_feature";
  feature: NativeOnlyFeature;
  status: CapabilityStatus;
  execution: ExecutionLayer;
  reason: string;
  fallbackFeature?: CapabilityFeature;
  /** English advice; localised by the pane. */
  message: string;
}

/**
 * Answers a request that needs a native-only feature. Returns undefined when the request is
 * ordinary. When the host really offers the feature (a ready companion on Windows) the verdict is
 * "consent_required" and the caller must ask first; it is never silently executed.
 */
export function refuseNativeRequest(
  text: string,
  context: CapabilityContext,
): NativeFeatureRefusal | undefined {
  const feature = classifyNativeRequest(text);
  if (!feature) return undefined;
  const verdict = resolveCapability(feature, context);
  return {
    kind: "unsupported_native_feature",
    feature,
    status: verdict.status,
    execution: verdict.execution,
    reason: verdict.reason ?? NATIVE_FEATURE_ADVICE[feature],
    ...(verdict.fallbackFeature
      ? { fallbackFeature: verdict.fallbackFeature }
      : {}),
    message:
      verdict.status === "unsupported"
        ? NATIVE_FEATURE_ADVICE[feature]
        : "This runs outside the workbook only after you approve it. Nothing has been run.",
  };
}
