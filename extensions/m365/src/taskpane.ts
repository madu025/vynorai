import {
  AnalysisConsentError,
  buildSchemaSummary,
  createAnalysisRequest,
  recommendationToInstruction,
  recommendationToSpecs,
  validateAnalysisResult,
  type AnalysisResult,
  type SchemaSummary,
} from "./analysis.js";
import {
  LANGUAGE_NAMES,
  applyLanguage,
  translate,
  loadLanguage,
  nextLanguage,
  saveLanguage,
  type Language,
} from "./i18n.js";
import {
  answerQuestion,
  normalizeInstruction,
  interpretInstruction,
  looksLikeQuestion,
} from "./intent.js";
import {
  buildLocalInsights,
  suggestionToPlanInput,
  type LocalInsights,
} from "./insights.js";
import {
  createM365ApiClient,
  M365ApiError,
  type M365RequestTrace,
} from "./api.js";
import { askInPane } from "./confirmDialog.js";
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
  getExcelHeaderLayout,
  type ExcelColumnSpecs,
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
  inspectSelectedExcelFormulas,
  inspectSelectedExcelRange,
  inspectWorkbookOverview,
  rollbackCreatedItems,
} from "./officeExcel.js";
import {
  formatFormulaInspection,
  inspectFormulas,
  isFormulaInspectionRequest,
} from "./formulaInspector.js";

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
const analyze = document.querySelector<HTMLButtonElement>("#analyze");
const consentPanel = document.querySelector<HTMLElement>("#ai-consent");
const consentSummary = document.querySelector<HTMLElement>("#ai-summary");
const consentCheck =
  document.querySelector<HTMLInputElement>("#ai-consent-check");
const consentSend = document.querySelector<HTMLButtonElement>("#ai-send");
const consentCancel = document.querySelector<HTMLButtonElement>("#ai-cancel");
const analysisOutput = document.querySelector<HTMLElement>("#ai-result");
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
let pendingSpecs: ExcelColumnSpecs | undefined;
let excludedKinds = new Set<string>();
let lastCreated:
  | { planId: string; sheets: string[]; tables: string[] }
  | undefined;
let language: Language = loadLanguage();
let lastSummary: SchemaSummary | undefined;
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
  if (analyze) analyze.disabled = !signedIn;
  document.body.dataset.auth = signedIn ? "in" : "out";
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
  if (analysisOutput) analysisOutput.textContent = "";
  if (consentPanel) consentPanel.hidden = true;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
  updateAuthenticationUi(false);
  log.record("session:sign-out", "pass", "local session removed");
  setStatus("Signed out. Sign in to inspect selected Excel data.");
}

const API_MESSAGES: Record<string, string> = {
  AI_CONSENT_REQUIRED: "AI analysis needs your explicit consent first.",
  AI_ANALYSIS_INVALID:
    "The AI answer did not match the expected format and was discarded.",
  AI_ANALYSIS_RATE_LIMITED:
    "Too many analysis requests. Wait a minute and try again.",
  AI_PROVIDER_UNAVAILABLE:
    "The AI service is unavailable right now. Try again later.",
  AI_SUMMARY_INVALID: "The local summary was rejected. Select the range again.",
  AI_SUMMARY_NOT_PRIVATE:
    "The summary was rejected because it contained more than allowed.",
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
  EXCEL_DATA_ROWS_REQUIRED:
    "Select one complete header row and at least one data row.",
  EXCEL_HEADERS_REQUIRED:
    "The first selected row has blank or merged headers. Select a flat table with one complete header row.",
  EXCEL_HEADERS_MUST_BE_UNIQUE:
    "Every selected column needs a unique header before creating a Table or PivotTable.",
  EXCEL_RANGE_NOT_RECTANGULAR: "Select one rectangular Excel range.",
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
  pendingSpecs = undefined;
  excludedKinds = new Set<string>();
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
  const instructionText = normalizeInstruction(instruction?.value || "");
  try {
    if (isFormulaInspectionRequest(instructionText)) {
      setStatus("Inspecting selected formulas locally...");
      const report = await log.step(
        "excel:inspect-formulas",
        async () =>
          inspectFormulas(await inspectSelectedExcelFormulas(officeRuntime())),
        (value) => ({
          formulaCells: value.formulaCellCount,
          errorCells: value.errorCellCount,
          possibleCircularReferences: value.possibleCircularReferenceCount,
        }),
      );
      showAnswer(formatFormulaInspection(report));
      return setStatus(
        "Formula inspection is ready. Nothing was sent or changed.",
      );
    }
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
    const layout = getExcelHeaderLayout(input);
    const interpreted = interpretInstruction(
      instructionText,
      layout.headers,
      input.values.slice(layout.headerRowCount),
    );
    const wanted = [
      ...new Set([
        ...selectExcelActions(instructionText),
        ...interpreted.actions,
      ]),
    ];
    const filtered = wanted.filter((kind) => !excludedKinds.has(kind));
    const actions = filtered.length > 0 ? filtered : wanted;
    const specs: ExcelColumnSpecs = {
      ...(pendingSpecs ?? {}),
      ...interpreted.specs,
    };
    if (actions.length === 0) {
      if (looksLikeQuestion(instructionText)) {
        const answer = answerQuestion(
          instructionText,
          layout.headers,
          input.values.slice(layout.headerRowCount),
        );
        log.record(
          "question:local",
          answer ? "pass" : "fail",
          answer ? "answered locally" : "no deterministic answer",
        );
        showAnswer(
          answer?.answer ??
            "I could not answer that from the selected columns. Mention a column name, for example: top Region by Sales.",
        );
        return setStatus("Answered from the selected data. Nothing was sent.");
      }
      log.record(
        "instruction:actions",
        "fail",
        interpreted.problems.join(" ") || "no explicit allowlisted action",
      );
      return setStatus(
        interpreted.problems[0] ??
          "Say what to create: a table, chart, result sheet, PivotTable, clean-up, or a computed column. Or ask a question about the data.",
      );
    }
    log.record("instruction:actions", "pass", { actions });
    const localPreview = await log.step(
      "local:preview",
      () => createExcelPreviewPlan(input, actions, undefined, specs),
      (value) => ({
        actions: value.actions.length,
        warnings: value.warnings.length,
      }),
    );
    const plan = await apiClient().planExcel({
      ...input,
      actions,
      ...(Object.keys(specs).length ? { specs } : {}),
    });
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
          normalization: plan.normalization,
          actions: localPreview.actions,
          warnings: plan.warnings,
        },
        null,
        2,
      );
    if (apply) apply.disabled = false;
    renderSteps(wanted, plan.actions);
    if (rollbackButton) rollbackButton.hidden = true;
    try {
      renderInsights(buildLocalInsights(input));
    } catch {
      // Insights are optional; the preview above is already valid.
    }
    markChangeNote("preview");
    setStatus(
      "Preview ready. Nothing has changed yet. Review it before applying.",
    );
  } catch (error) {
    handleApiError("inspect", error);
  }
});

/** The preview card says "nothing has changed"; after an apply that sentence must not stay. */
function markChangeNote(state: "preview" | "applied" | "partial" | "undone") {
  const note = document.querySelector<HTMLElement>("#change-note");
  if (!note) return;
  if (state === "preview") {
    note.dataset.i18n = "nothing_changed";
    note.textContent = "Nothing has changed in your workbook yet.";
    applyLanguage(note.parentElement ?? document, language);
    return;
  }
  delete note.dataset.i18n;
  note.textContent =
    state === "applied"
      ? "Applied. Your source data was not changed."
      : state === "undone"
        ? "Undone. What this add-in created was removed."
        : "Partly applied. See the steps and Diagnostics.";
}

apply?.addEventListener("click", async () => {
  if (!config || !accessToken || !currentPlan || !previewFingerprint)
    return setStatus("Create a preview before applying.");
  if (
    !(await askInPane(
      "Apply the approved Excel changes? Original source data will be preserved.",
      "Apply",
    ))
  )
    return log.record("apply:confirm", "skip", "user cancelled");
  log.record("apply:confirm", "pass", "user confirmed");
  const approvedPlan = currentPlan;
  const expectedFingerprint = previewFingerprint;
  let approvalGranted = false;
  let resultReported = false;
  if (apply) apply.disabled = true;
  if (inspect) inspect.disabled = true;
  if (signOut) signOut.disabled = true;
  if (instruction) instruction.disabled = true;
  try {
    setStatus("Requesting approval...");
    await apiClient().approveExcel({
      planId: approvedPlan.planId,
      sourceFingerprint: approvedPlan.sourceFingerprint,
      approvalToken: approvedPlan.approvalToken,
    });
    approvalGranted = true;
    setStatus("Applying approved changes...");
    const report = await log.step(
      "excel:apply",
      () =>
        applyApprovedExcelPlan(
          officeRuntime(),
          approvedPlan,
          true,
          approvedPlan.approvalToken,
          {
            expectedSourceFingerprint: expectedFingerprint,
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
    const auditStatus = !report.sourceUnchangedAfterApply
      ? "source_verification_failed"
      : failed.length
        ? "partial_failure"
        : "applied";
    let auditWarning = "";
    try {
      await apiClient().reportExcelResult({
        planId: approvedPlan.planId,
        sourceFingerprint: approvedPlan.sourceFingerprint,
        approvalToken: approvedPlan.approvalToken,
        status: auditStatus,
        sourceUnchanged: report.sourceUnchangedAfterApply,
        results: report.results.map((result) => ({
          kind: result.kind as "table" | "chart" | "new-sheet" | "pivot-table",
          status: result.status,
        })),
      });
      resultReported = true;
      log.record("api:apply-result", "pass", { status: auditStatus });
    } catch (error) {
      auditWarning = " The server audit receipt could not be confirmed.";
      log.record("api:apply-result", "fail", describeError(error));
    }
    const done = report.results
      .filter(
        (result) => result.status === "created" || result.status === "exists",
      )
      .map(
        (result) =>
          `${result.kind}: ${result.name} (${result.targetSheet})${result.status === "exists" ? " - already existed, left unchanged (undo it first to rebuild)" : ""}`,
      );
    const created = report.results.filter(
      (result) => result.status === "created",
    );
    lastCreated = {
      planId: approvedPlan.planId,
      sheets: created
        .filter(
          (result) => result.kind !== "table" || approvedPlan.normalization,
        )
        .map((result) => result.targetSheet),
      tables: created
        .filter((result) => result.kind === "table")
        .map((result) => result.name),
    };
    if (rollbackButton)
      rollbackButton.hidden =
        lastCreated.sheets.length + lastCreated.tables.length === 0;
    currentPlan = undefined;
    previewFingerprint = "";
    markChangeNote(failed.length ? "partial" : "applied");
    setStatus(
      failed.length
        ? `Applied ${done.length} of ${report.results.length} actions. Failed: ${failed.map((result) => result.kind).join(", ")}. See Diagnostics.${auditWarning}`
        : `Applied: ${done.join("; ")}. Source data unchanged: ${report.sourceUnchangedAfterApply ? "yes" : "NO"}.${auditWarning}`,
    );
  } catch (error) {
    if (approvalGranted && !resultReported) {
      try {
        const failureStatus = String((error as Error)?.message).includes(
          "source_changed_since_preview",
        )
          ? "source_verification_failed"
          : "client_failure";
        await apiClient().reportExcelResult({
          planId: approvedPlan.planId,
          sourceFingerprint: approvedPlan.sourceFingerprint,
          approvalToken: approvedPlan.approvalToken,
          status: failureStatus,
          results: [],
        });
        log.record("api:apply-result", "pass", { status: failureStatus });
      } catch (reportError) {
        log.record("api:apply-result", "fail", describeError(reportError));
      }
    }
    handleApiError("apply", error);
  } finally {
    if (instruction) instruction.disabled = false;
    updateAuthenticationUi(Boolean(accessToken));
  }
});

const insightsCard = document.querySelector<HTMLElement>("#insights-card");
const insightsList = document.querySelector<HTMLElement>("#insights-list");
const insightsActions =
  document.querySelector<HTMLElement>("#insights-actions");

/** Shows a locally computed answer in the insights card. */
function showAnswer(text: string) {
  const list = document.querySelector<HTMLElement>("#insights-list");
  const card = document.querySelector<HTMLElement>("#insights-card");
  if (!list || !card) return;
  list.textContent = "";
  const row = document.createElement("p");
  row.textContent = text;
  list.appendChild(row);
  card.hidden = false;
}

/** Local, private insights: shown to the person, never sent anywhere. */
function renderInsights(result: LocalInsights) {
  if (!insightsCard || !insightsList || !insightsActions) return;
  insightsList.textContent = "";
  insightsActions.textContent = "";
  for (const insight of result.insights) {
    const row = document.createElement("p");
    const title = document.createElement("strong");
    title.textContent = `${insight.title}: `;
    row.appendChild(title);
    row.appendChild(document.createTextNode(insight.detail));
    insightsList.appendChild(row);
  }
  for (const suggestion of result.suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.textContent = suggestion.label;
    button.addEventListener("click", () => {
      const planInput = suggestionToPlanInput(suggestion);
      if (instruction) {
        instruction.value = planInput.instruction;
        instruction.dispatchEvent(new Event("input"));
      }
      pendingSpecs = planInput.specs;
      log.record("insights:use-suggestion", "pass", {
        kind: suggestion.kind,
        chartType: suggestion.chartType,
      });
      setStatus(
        "Column choice set. Click Inspect and preview; nothing changes until you confirm.",
      );
    });
    insightsActions.appendChild(button);
  }
  insightsCard.hidden = result.insights.length === 0;
}

/** AI analysis: advisory only. Nothing here reads more than the selection or writes to Excel. */
let pendingSummary: SchemaSummary | undefined;

function resetAnalysisConsent() {
  pendingSummary = undefined;
  if (consentPanel) consentPanel.hidden = true;
  if (consentCheck) consentCheck.checked = false;
  if (consentSend) consentSend.disabled = true;
  if (consentSummary) consentSummary.textContent = "";
}

function renderAnalysis(result: AnalysisResult) {
  if (!analysisOutput) return;
  const output = analysisOutput;
  output.textContent = "";
  const add = (tag: string, text: string, parent: HTMLElement = output) => {
    const element = document.createElement(tag);
    element.textContent = text; // model text is data, never markup
    parent.appendChild(element);
    return element;
  };
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  add("p", result.summary);
  if (result.columns.length) {
    add("h3", "Columns");
    for (const column of result.columns)
      add(
        "p",
        `${column.name}: ${column.inferredType}, ${column.role} (${percent(column.confidence)}) - ${column.reason}`,
      );
  }
  if (result.dataQuality.length) {
    add("h3", "Data quality");
    for (const issue of result.dataQuality)
      add(
        "p",
        `[${issue.severity}] ${issue.message} (${percent(issue.confidence)})`,
      );
  }
  add("h3", "Recommendations");
  if (!result.recommendations.length)
    add("p", "No safe recommendation was found.");
  for (const recommendation of result.recommendations) {
    const item = document.createElement("div");
    output.appendChild(item);
    add(
      "p",
      `${recommendation.title} - ${recommendation.kind}${recommendation.chartType ? ` (${recommendation.chartType})` : ""}, ${percent(recommendation.confidence)} - ${recommendation.reason}`,
      item,
    );
    const instructionText = recommendationToInstruction(recommendation);
    if (!instructionText) {
      add("p", "Advice only: no workbook action is available for this.", item);
      continue;
    }
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "Use this recommendation";
    use.addEventListener("click", () => {
      if (instruction) instruction.value = instructionText;
      pendingSpecs = lastSummary
        ? recommendationToSpecs(recommendation, lastSummary)
        : undefined;
      currentPlan = undefined;
      previewFingerprint = "";
      if (apply) apply.disabled = true;
      if (preview) preview.textContent = "No preview yet.";
      log.record("analysis:use-recommendation", "pass", {
        kind: recommendation.kind,
      });
      setStatus(
        "Instruction set. Click Inspect and preview; nothing changes until you confirm.",
      );
    });
    item.appendChild(use);
  }
}

analyze?.addEventListener("click", async () => {
  if (!config || !accessToken)
    return setStatus("Sign in before analyzing Excel data.");
  resetAnalysisConsent();
  if (analysisOutput) analysisOutput.textContent = "";
  try {
    const input = await log.step(
      "analysis:read-selection",
      () => inspectSelectedExcelRange(officeRuntime(), crypto.randomUUID()),
      (value) => ({ rows: value.values.length }),
    );
    pendingSummary = await log.step(
      "analysis:local-summary",
      () => buildSchemaSummary(input),
      (value) => ({ columns: value.columnCount, rows: value.rowCount }),
    );
    if (consentSummary)
      consentSummary.textContent = JSON.stringify(pendingSummary, null, 2);
    lastSummary = pendingSummary;
    if (consentPanel) {
      consentPanel.hidden = false;
      consentPanel.scrollIntoView?.({ block: "nearest" });
    }
    setStatus("Review exactly what will be sent, then confirm to continue.");
  } catch (error) {
    pendingSummary = undefined;
    setStatus((error as Error).message);
  }
});

consentCheck?.addEventListener("change", () => {
  if (consentSend)
    consentSend.disabled = !(consentCheck.checked && pendingSummary);
});

consentCancel?.addEventListener("click", () => {
  resetAnalysisConsent();
  log.record("analysis:consent", "skip", "user cancelled");
  setStatus("Nothing was sent.");
});

consentSend?.addEventListener("click", async () => {
  if (!config || !accessToken || !pendingSummary) return;
  let request;
  try {
    request = createAnalysisRequest(
      pendingSummary,
      consentCheck?.checked === true,
    );
  } catch (error) {
    if (error instanceof AnalysisConsentError)
      return setStatus("AI analysis needs your explicit consent first.");
    throw error;
  }
  log.record("analysis:consent", "pass", "user agreed to send the summary");
  const columnCount = pendingSummary.columnCount;
  if (consentSend) consentSend.disabled = true;
  try {
    setStatus("Analyzing the summary...");
    const response = await apiClient().analyzeExcel(request);
    const result = validateAnalysisResult(response?.result, columnCount);
    log.record("api:analysis", "pass", {
      recommendations: result.recommendations.length,
    });
    resetAnalysisConsent();
    renderAnalysis(result);
    setStatus("Analysis ready. It is advice only; nothing has changed.");
  } catch (error) {
    resetAnalysisConsent();
    if (error instanceof M365ApiError) handleApiError("analysis", error);
    else {
      log.record("analysis:validate", "fail", describeError(error));
      setStatus(API_MESSAGES.AI_ANALYSIS_INVALID);
    }
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

/** Layout behaviour only: none of this touches tokens, plans, approvals or the workbook. */
function setupLayout() {
  const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle");
  const menu = document.querySelector<HTMLElement>("#menu");
  const diagnosticsPanel =
    document.querySelector<HTMLElement>("#diagnostics-panel");
  const toggleDiagnostics = document.querySelector<HTMLButtonElement>(
    "#toggle-diagnostics",
  );
  const resultCard = document.querySelector<HTMLElement>("#result-card");
  const previewSummary =
    document.querySelector<HTMLElement>("#preview-summary");

  const closeMenu = () => {
    if (menu) menu.hidden = true;
    menuToggle?.setAttribute("aria-expanded", "false");
  };
  menuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#toggle-diagnostics") === null) closeMenu();
  });
  document.addEventListener("click", (event) => {
    if (
      menu &&
      !menu.hidden &&
      !(event.target as HTMLElement).closest("header")
    )
      closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  toggleDiagnostics?.addEventListener("click", () => {
    if (!diagnosticsPanel) return;
    diagnosticsPanel.hidden = !diagnosticsPanel.hidden;
    toggleDiagnostics.textContent = translate(
      language,
      diagnosticsPanel.hidden ? "menu_show_diag" : "menu_hide_diag",
      diagnosticsPanel.hidden ? "Show diagnostics" : "Hide diagnostics",
    );
    closeMenu();
  });
  // The self-test and copy actions report into the diagnostics panel, so reveal it.
  for (const id of ["#self-test", "#copy-diagnostics"])
    document.querySelector(id)?.addEventListener("click", () => {
      if (diagnosticsPanel?.hidden) toggleDiagnostics?.click();
    });

  for (const pill of document.querySelectorAll<HTMLButtonElement>(
    ".pill[data-instruction]",
  ))
    pill.addEventListener("click", () => {
      if (!instruction) return;
      instruction.value = pill.dataset.instruction || "";
      instruction.dispatchEvent(new Event("input"));
      instruction.focus();
    });

  const label = (kind: string) =>
    ({
      "new-sheet": "result sheet",
      table: "table",
      chart: "chart",
      "pivot-table": "PivotTable",
    })[kind] || kind;
  const renderSummary = () => {
    if (!preview || !resultCard) return;
    let parsed: any;
    try {
      parsed = JSON.parse(preview.textContent || "");
    } catch {
      resultCard.hidden = true;
      return;
    }
    const actions: any[] = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const sheets = [...new Set(actions.map((action) => action.targetSheet))];
    const warnings: any[] = Array.isArray(parsed?.warnings)
      ? parsed.warnings
      : [];
    const rows = Math.max(
      0,
      Number(parsed?.profile?.rowCount ?? 0) -
        Number(parsed?.profile?.headerRowCount ?? 1),
    );
    if (previewSummary)
      previewSummary.textContent =
        `${actions.map((action) => label(action.kind)).join(", ")} ` +
        `on ${sheets.join(", ")}. ${rows} data rows, ` +
        `${Number(parsed?.profile?.columnCount ?? 0)} columns. ` +
        `Your source data stays unchanged.` +
        (warnings.length ? ` ${warnings.join(" ")}` : "");
    resultCard.hidden = false;
  };
  if (preview)
    new MutationObserver(renderSummary).observe(preview, {
      childList: true,
      characterData: true,
      subtree: true,
    });
}

setupLayout();

const rollbackButton = document.querySelector<HTMLButtonElement>("#rollback");
const stepsContainer = document.querySelector<HTMLElement>("#steps");
const overviewButton = document.querySelector<HTMLButtonElement>("#overview");
const languageButton = document.querySelector<HTMLButtonElement>("#language");

/** One checkbox per planned action; changing it re-plans with only the chosen steps. */
function renderSteps(
  wanted: string[],
  planned: Array<{ kind: string; targetSheet: string }>,
) {
  if (!stepsContainer) return;
  stepsContainer.textContent = "";
  if (wanted.length < 2) return;
  for (const kind of wanted) {
    const row = document.createElement("label");
    row.className = "step";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !excludedKinds.has(kind);
    box.addEventListener("change", () => {
      if (box.checked) excludedKinds.delete(kind);
      else excludedKinds.add(kind);
      if (excludedKinds.size >= wanted.length) {
        excludedKinds.delete(kind);
        box.checked = true;
        return;
      }
      inspect?.click();
    });
    const target = planned.find((action) => action.kind === kind)?.targetSheet;
    row.appendChild(box);
    row.appendChild(
      document.createTextNode(` ${kind}${target ? ` → ${target}` : ""}`),
    );
    stepsContainer.appendChild(row);
  }
}

rollbackButton?.addEventListener("click", async () => {
  if (!lastCreated || !config || !accessToken) return;
  const items = lastCreated;
  if (
    !(await askInPane(
      "Remove the result sheets and Table this add-in created? Your original data is not touched.",
      "Remove",
    ))
  )
    return log.record("rollback:confirm", "skip", "user cancelled");
  try {
    const report = await log.step("excel:rollback", () =>
      rollbackCreatedItems(officeRuntime(), items, true),
    );
    await apiClient()
      .reportRollback({
        planId: items.planId,
        removedSheets: Math.min(10, report.removedSheets.length),
        convertedTables: Math.min(1, report.convertedTables.length),
      })
      .catch((error) =>
        log.record("api:rollback", "fail", describeError(error)),
      );
    lastCreated = undefined;
    if (rollbackButton) rollbackButton.hidden = true;
    markChangeNote("undone");
    setStatus(
      `Removed ${report.removedSheets.length} sheet(s) and converted ${report.convertedTables.length} table(s) back to a range.`,
    );
  } catch (error) {
    handleApiError("rollback", error);
  }
});

overviewButton?.addEventListener("click", async () => {
  try {
    const overview = await log.step("excel:overview", () =>
      inspectWorkbookOverview(officeRuntime()),
    );
    const lines = [
      `${overview.sheets.length} sheet(s): ${overview.sheets
        .map((sheet) => `${sheet.name} (${sheet.rows}×${sheet.columns})`)
        .join(", ")}.`,
      overview.tables.length
        ? `${overview.tables.length} table(s): ${overview.tables
            .map(
              (table) =>
                `${table.name} on ${table.sheet} (${table.rows}×${table.columns})`,
            )
            .join(", ")}.`
        : "No Excel tables.",
    ];
    showAnswer(lines.join(" "));
    setStatus("Workbook overview ready. Only names and sizes were read.");
  } catch (error) {
    setStatus((error as Error).message);
  }
});

function refreshLanguage() {
  applyLanguage(document, language);
  if (languageButton)
    languageButton.textContent = `${translateLabel()}: ${LANGUAGE_NAMES[language]}`;
}
function translateLabel(): string {
  return language === "si" ? "භාෂාව" : language === "ta" ? "மொழி" : "Language";
}
languageButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  language = nextLanguage(language);
  saveLanguage(language);
  refreshLanguage();
});
refreshLanguage();

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
