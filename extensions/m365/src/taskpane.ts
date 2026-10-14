import {
  createM365ApiClient,
  M365ApiError,
  type M365RequestTrace,
} from "./api.js";
import {
  ACTION_REQUIREMENTS,
  DiagnosticsLog,
  describeAccessToken,
  describeError,
  describeOfficeHost,
  formatEntry,
} from "./diagnostics.js";
import {
  createExcelPreviewPlan,
  excelPlansMatch,
  selectExcelActions,
} from "./excel.js";
import {
  beginM365OAuth,
  completeM365OAuth,
  createOfficeAuthDialogUrl,
  type M365OAuthConfig,
} from "./oauth.js";
import {
  applyApprovedExcelPlan,
  inspectSelectedExcelRange,
} from "./officeExcel.js";

declare global {
  interface Window {
    __VYNORAI_M365_CONFIG__?: M365OAuthConfig & { apiBaseUrl: string };
    __VYNORAI_DIAG_NOTE__?: (message: string) => void;
  }
}

const config = window.__VYNORAI_M365_CONFIG__;
const status = document.querySelector<HTMLElement>("#status");
const preview = document.querySelector<HTMLElement>("#preview");
const instruction = document.querySelector<HTMLTextAreaElement>("#instruction");
const signIn = document.querySelector<HTMLButtonElement>("#sign-in");
const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
const inspect = document.querySelector<HTMLButtonElement>("#inspect");
const apply = document.querySelector<HTMLButtonElement>("#apply");
const selfTest = document.querySelector<HTMLButtonElement>("#self-test");
const copyDiagnostics =
  document.querySelector<HTMLButtonElement>("#copy-diagnostics");
const clearDiagnostics =
  document.querySelector<HTMLButtonElement>("#clear-diagnostics");
const diagnostics = document.querySelector<HTMLElement>("#diagnostics");
const summary = document.querySelector<HTMLElement>("#diagnostics-summary");
const DIAGNOSTICS_PLACEHOLDER = "No sign-in diagnostics yet.";
let accessToken = "";
let currentPlan: any;
let previewFingerprint = "";
const LEGACY_SESSION_KEY = "vynorai.m365.excel.session";
const SESSION_KEY = "vynorai.m365.excel.session.v2";

interface StoredSession {
  accessToken: string;
  expiresAt: number;
}

const log = new DiagnosticsLog((entries) => {
  if (!diagnostics) return;
  diagnostics.textContent = entries.length
    ? entries.map(formatEntry).join("\n")
    : DIAGNOSTICS_PLACEHOLDER;
  diagnostics.scrollTop = diagnostics.scrollHeight;
});

// Keep startup notes written by the inline page script before this bundle loaded.
if (diagnostics && diagnostics.textContent !== DIAGNOSTICS_PLACEHOLDER) {
  for (const line of (diagnostics.textContent || "")
    .split("\n")
    .filter(Boolean))
    log.record("startup", "info", line);
}
window.__VYNORAI_DIAG_NOTE__ = (message) => log.record("page", "info", message);

function setStatus(message: string) {
  if (status) status.textContent = message;
}
function officeRuntime(): any {
  return (globalThis as any).Excel;
}
function office(): any {
  return (globalThis as any).Office;
}
function traceRequest(trace: M365RequestTrace) {
  log.record(
    `api ${trace.method} ${trace.path}`,
    trace.status >= 200 && trace.status < 300 ? "pass" : "fail",
    `http=${trace.status}${trace.code ? ` code=${trace.code}` : ""} correlationId=${trace.correlationId}`,
    trace.durationMs,
  );
}
function apiClient() {
  return createM365ApiClient(
    config!.apiBaseUrl,
    accessToken,
    fetch,
    traceRequest,
  );
}
function supportsExcelApi(version: string): boolean {
  try {
    return Boolean(
      office()?.context?.requirements?.isSetSupported?.("ExcelApi", version),
    );
  } catch {
    return false;
  }
}

function updateAuthenticationUi(signedIn: boolean) {
  if (signIn) signIn.disabled = signedIn;
  if (signOut) signOut.disabled = !signedIn;
  if (inspect) inspect.disabled = !signedIn;
}

function saveSession(tokens: { accessToken: string; expiresIn: number }) {
  const expiresAt = Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accessToken: tokens.accessToken, expiresAt }),
  );
}

function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as StoredSession;
    if (
      !saved.accessToken ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    accessToken = saved.accessToken;
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

function signOutOfMicrosoft() {
  accessToken = "";
  currentPlan = undefined;
  previewFingerprint = "";
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
  updateAuthenticationUi(false);
  log.record("session:sign-out", "pass", "local session removed");
  setStatus("Signed out. Sign in to inspect selected Excel data.");
}

const API_MESSAGES: Record<string, string> = {
  tenant_disabled:
    "Your Microsoft 365 organization is not enabled in VynorAI yet.",
  tenant_scope_disabled:
    "Your organization is enabled in VynorAI, but not for this Excel action.",
  M365_IDENTITY_NOT_LINKED:
    "Your Microsoft account must be linked to a VynorAI account by an administrator.",
  insufficient_scope:
    "Microsoft consent is missing a required Excel permission.",
  CREDITS_EXHAUSTED: "The linked VynorAI account has no credits available.",
  NETWORK_ERROR: "VynorAI could not be reached. Check the network and retry.",
  approval_mismatch:
    "The approval no longer matches this preview. Inspect again.",
  approval_replayed:
    "This approval was already used. Inspect the selection again for a new preview.",
};

function handleApiError(step: string, error: unknown) {
  log.record(step, "fail", describeError(error));
  if (!(error instanceof M365ApiError)) {
    setStatus((error as Error).message);
    return;
  }
  if (
    [
      "invalid_entra_identity",
      "invalid_entra_token",
      "invalid_entra_token_version",
      "invalid_entra_issuer",
      "jwt expired",
    ].includes(error.code)
  ) {
    signOutOfMicrosoft();
    setStatus(
      "Microsoft session changed or expired. Sign in again to continue.",
    );
    return;
  }
  setStatus(
    API_MESSAGES[error.code] ||
      `VynorAI request failed (${error.code}). See Diagnostics.`,
  );
}

function signInWithOfficeDialog(authorizeUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const host = office();
    if (!host?.context?.ui?.displayDialogAsync)
      return reject(new Error("Office sign-in dialog is unavailable."));
    log.record(
      "oauth:dialog-open",
      "info",
      "Opening Office Dialog API sign-in window.",
    );
    host.context.ui.displayDialogAsync(
      createOfficeAuthDialogUrl(authorizeUrl),
      { height: 75, width: 50 },
      (result: any) => {
        if (result.status !== host.AsyncResultStatus.Succeeded) {
          log.record(
            "oauth:dialog-open",
            "fail",
            `${result.error?.code || "unknown"} ${result.error?.message || ""}`,
          );
          return reject(
            new Error(
              `Unable to open the Microsoft sign-in dialog (${result.error?.code || "unknown"}).`,
            ),
          );
        }
        const dialog = result.value;
        log.record("oauth:dialog-open", "pass");
        const closeWithError = (message: string) => {
          dialog.close();
          reject(new Error(message));
        };
        dialog.addEventHandler(
          host.EventType.DialogMessageReceived,
          (message: any) => {
            try {
              const payload = JSON.parse(message.message) as {
                callbackUrl?: string;
              };
              if (!payload.callbackUrl)
                return closeWithError(
                  "Microsoft sign-in did not return a callback.",
                );
              log.record(
                "oauth:callback",
                "pass",
                "callback received from the Office dialog",
              );
              setStatus("Completing Microsoft sign-in...");
              dialog.close();
              resolve(payload.callbackUrl);
            } catch {
              closeWithError("Microsoft sign-in returned an invalid callback.");
            }
          },
        );
        dialog.addEventHandler(
          host.EventType.DialogEventReceived,
          (event: any) => {
            log.record(
              "oauth:dialog-event",
              "fail",
              `${event.error || "unknown"} ${event.message || "closed"}`,
            );
            closeWithError(
              `Microsoft sign-in dialog event ${event.error || "unknown"}: ${event.message || "closed"}`,
            );
          },
        );
      },
    );
  });
}

function recordTokenSummary(step: string) {
  const claims = describeAccessToken(accessToken);
  if (!claims)
    return log.record(step, "fail", "access token claims are unreadable");
  const missing = ["m365.excel.read", "m365.excel.write"].filter(
    (scope) => !claims.scopes.includes(scope),
  );
  log.record(
    step,
    missing.length || (claims.expiresInSeconds ?? 0) <= 0 ? "fail" : "pass",
    {
      ...claims,
      ...(missing.length ? { missingScopes: missing } : {}),
    },
  );
}

signIn?.addEventListener("click", async () => {
  if (!config) return setStatus("M365 OAuth configuration is missing.");
  try {
    setStatus("Opening Microsoft sign-in...");
    const authorizeUrl = await log.step("oauth:authorize-url", () =>
      beginM365OAuth(config),
    );
    const callbackUrl = await signInWithOfficeDialog(authorizeUrl);
    const tokens = await log.step(
      "oauth:token-exchange",
      () => completeM365OAuth(callbackUrl, config),
      (value) => ({ expiresIn: value.expiresIn, tokenType: value.tokenType }),
    );
    accessToken = tokens.accessToken;
    saveSession(tokens);
    updateAuthenticationUi(true);
    recordTokenSummary("oauth:token-claims");
    setStatus("Signed in. Select data and inspect it.");
  } catch (error) {
    log.record("oauth:sign-in", "fail", describeError(error));
    setStatus((error as Error).message);
  }
});

signOut?.addEventListener("click", signOutOfMicrosoft);

instruction?.addEventListener("input", () => {
  currentPlan = undefined;
  previewFingerprint = "";
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
});

inspect?.addEventListener("click", async () => {
  if (!config || !accessToken)
    return setStatus("Sign in before inspecting Excel data.");
  if (apply) apply.disabled = true;
  currentPlan = undefined;
  const actions = selectExcelActions(instruction?.value || "");
  if (actions.length === 0) {
    log.record(
      "instruction:actions",
      "fail",
      "no explicit allowlisted workbook action",
    );
    return setStatus(
      "Say what to create: a table, chart, new result sheet, or PivotTable.",
    );
  }
  log.record("instruction:actions", "pass", { actions });
  try {
    setStatus("Inspecting the selected range...");
    const input = await log.step(
      "excel:read-selection",
      () => inspectSelectedExcelRange(officeRuntime(), crypto.randomUUID()),
      (value) => ({
        sheet: value.worksheetName,
        address: value.address,
        rows: value.values.length,
        columns: value.values[0]?.length ?? 0,
      }),
    );
    const localPreview = await log.step(
      "local:preview",
      () => createExcelPreviewPlan(input, actions),
      (value) => ({
        actions: value.actions.length,
        warnings: value.warnings.length,
      }),
    );
    const plan = await apiClient().planExcel({ ...input, actions });
    log.record("api:plan", "pass", {
      planId: plan.planId,
      actions: plan.actions?.map((action: any) => action.kind),
      expiresAt: plan.expiresAt,
    });
    const consistent = excelPlansMatch(localPreview, plan);
    log.record(
      "preview:server-matches-local",
      consistent ? "pass" : "fail",
      consistent
        ? undefined
        : "server and local plans differ; apply is blocked",
    );
    if (!consistent) {
      setStatus(
        "The server preview does not match the selection. See Diagnostics.",
      );
      return;
    }
    currentPlan = plan;
    previewFingerprint = localPreview.sourceFingerprint;
    if (preview)
      preview.textContent = JSON.stringify(
        {
          profile: { ...plan.profile, sourceFingerprint: undefined },
          actions: localPreview.actions,
          warnings: plan.warnings,
        },
        null,
        2,
      );
    if (apply) apply.disabled = false;
    setStatus(
      "Preview ready. Nothing has changed yet. Review it before applying.",
    );
  } catch (error) {
    handleApiError("inspect", error);
  }
});

apply?.addEventListener("click", async () => {
  if (!config || !accessToken || !currentPlan || !previewFingerprint)
    return setStatus("Create a preview before applying.");
  if (
    !window.confirm(
      "Apply the approved Excel changes? Original source data will be preserved.",
    )
  )
    return log.record("apply:confirm", "skip", "user cancelled");
  log.record("apply:confirm", "pass", "user confirmed");
  if (apply) apply.disabled = true;
  try {
    setStatus("Requesting approval...");
    await apiClient().approveExcel({
      planId: currentPlan.planId,
      sourceFingerprint: currentPlan.sourceFingerprint,
      approvalToken: currentPlan.approvalToken,
    });
    setStatus("Applying approved changes...");
    const report = await log.step(
      "excel:apply",
      () =>
        applyApprovedExcelPlan(
          officeRuntime(),
          currentPlan,
          true,
          currentPlan.approvalToken,
          {
            expectedSourceFingerprint: previewFingerprint,
            supportsExcelApi,
            requirements: ACTION_REQUIREMENTS,
            onAction: (result) =>
              log.record(
                `excel:action:${result.kind}`,
                result.status === "failed"
                  ? "fail"
                  : result.status === "skipped_unsupported"
                    ? "skip"
                    : "pass",
                `${result.status} ${result.name} on ${result.targetSheet}${result.error ? ` - ${result.error}` : ""}`,
              ),
          },
        ),
      (value) => ({
        sourceVerifiedBeforeApply: value.sourceVerifiedBeforeApply,
      }),
    );
    log.record(
      "excel:source-unchanged-after-apply",
      report.sourceUnchangedAfterApply ? "pass" : "fail",
    );
    const failed = report.results.filter(
      (result) => result.status === "failed",
    );
    const done = report.results
      .filter(
        (result) => result.status === "created" || result.status === "exists",
      )
      .map(
        (result) => `${result.kind}: ${result.name} (${result.targetSheet})`,
      );
    currentPlan = undefined;
    previewFingerprint = "";
    setStatus(
      failed.length
        ? `Applied ${done.length} of ${report.results.length} actions. Failed: ${failed.map((result) => result.kind).join(", ")}. See Diagnostics.`
        : `Applied: ${done.join("; ")}. Source data unchanged: ${report.sourceUnchangedAfterApply ? "yes" : "NO"}.`,
    );
  } catch (error) {
    handleApiError("apply", error);
  }
});

/** Checks every function the add-in relies on, in order, without changing the workbook. */
async function runSelfTest() {
  const started = log.all().length;
  log.record("self-test", "info", "started");
  log.record(
    "self-test:config",
    config ? "pass" : "fail",
    config
      ? {
          apiBaseUrl: config.apiBaseUrl,
          clientId: config.clientId,
          authority: config.authority || config.tenantId,
          scopes: config.scopes.length,
        }
      : "runtime-config.js did not load",
  );
  const host = describeOfficeHost(office());
  log.record(
    "self-test:office-host",
    office()?.context ? "pass" : "fail",
    host,
  );
  log.record(
    "self-test:excel-api",
    supportsExcelApi("1.4") ? "pass" : "fail",
    Object.entries(ACTION_REQUIREMENTS)
      .map(
        ([action, version]) =>
          `${action}=${supportsExcelApi(version) ? "yes" : "no"}(ExcelApi ${version})`,
      )
      .join(" "),
  );
  try {
    localStorage.setItem("vynorai.m365.probe", "1");
    localStorage.removeItem("vynorai.m365.probe");
    log.record("self-test:storage", "pass");
  } catch (error) {
    log.record("self-test:storage", "fail", describeError(error));
  }
  if (accessToken) {
    recordTokenSummary("self-test:session-token");
    try {
      const report = await apiClient().diagnose();
      for (const stage of report.stages)
        log.record(
          `self-test:backend:${stage.name}`,
          stage.ok ? "pass" : "fail",
          [stage.code, stage.detail ? JSON.stringify(stage.detail) : ""]
            .filter(Boolean)
            .join(" ") || undefined,
        );
      log.record(
        "self-test:backend:ready",
        report.ready.read && report.ready.write ? "pass" : "fail",
        report.ready,
      );
    } catch (error) {
      log.record("self-test:backend", "fail", describeError(error));
    }
  } else {
    log.record("self-test:session-token", "skip", "not signed in");
    log.record(
      "self-test:backend",
      "skip",
      "sign in to check tenant, identity and credits",
    );
  }
  try {
    await log.step(
      "self-test:excel-selection",
      () =>
        officeRuntime().run(async (context: any) => {
          const range = context.workbook.getSelectedRange();
          range.load(["address", "rowCount", "columnCount"]);
          await context.sync();
          return {
            address: range.address,
            rows: range.rowCount,
            columns: range.columnCount,
          };
        }),
      (value) => value,
    );
  } catch {
    // Already recorded as a failed step.
  }
  const results = log.all().slice(started);
  const failed = results.filter((entry) => entry.status === "fail");
  const passed = results.filter((entry) => entry.status === "pass").length;
  const text = failed.length
    ? `Self-test: ${passed} passed, ${failed.length} failed (${failed.map((entry) => entry.step.replace("self-test:", "")).join(", ")}).`
    : `Self-test: all ${passed} checks passed.`;
  log.record("self-test", failed.length ? "fail" : "pass", text);
  if (summary) summary.textContent = text;
  setStatus(text);
}

selfTest?.addEventListener("click", () => {
  if (selfTest) selfTest.disabled = true;
  void runSelfTest().finally(() => {
    if (selfTest) selfTest.disabled = false;
  });
});

copyDiagnostics?.addEventListener("click", async () => {
  const text = log.toText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Office WebViews may block the async clipboard; fall back to a selection copy.
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  setStatus("Diagnostics copied. They contain no tokens or cell values.");
});

clearDiagnostics?.addEventListener("click", () => {
  log.clear();
  if (summary) summary.textContent = "";
});

async function initialize() {
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (office()?.onReady) {
    try {
      await log.step(
        "office:ready",
        () => office().onReady(),
        (info: any) => ({
          host: info?.host,
          platform: info?.platform,
        }),
      );
    } catch {
      // Recorded; the self-test shows which host functions are missing.
    }
  } else {
    log.record(
      "office:ready",
      "fail",
      "Office.js is not loaded (page opened outside Office?)",
    );
  }
  if (!config) {
    log.record(
      "config",
      "fail",
      "M365 OAuth runtime configuration was not loaded.",
    );
    return setStatus("M365 OAuth configuration is missing.");
  }
  if (restoreSession()) {
    updateAuthenticationUi(true);
    recordTokenSummary("session:restore");
    return setStatus("Signed in. Select data and inspect it.");
  }
  log.record("session:restore", "info", "no unexpired session");
  updateAuthenticationUi(false);
  setStatus("Sign in to inspect selected Excel data.");
}

void initialize();
