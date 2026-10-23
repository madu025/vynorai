import { answerResults, rememberAnswerResults } from "./answerCard.js";
import {
  PersonalMask,
  answerSources,
  columnLetters,
  parseA1,
  appliedReport,
  describeChange,
  runAgent,
  type AgentHost,
  type AgentMessage,
  type AnswerSource,
  type AgentPhase,
  type AgentRun,
} from "./agent.js";
import { checkStepWith, runStepWith } from "./agentSteps.js";
import { describeReview, runTeam } from "./agentReview.js";
import { retryTransient } from "./retryTransient.js";
import { scrollToLatestMessage } from "./chatScroll.js";
import { previewCells, previewTarget } from "./changePreview.js";
import { describeSelection } from "./selectionChip.js";
import {
  applyAgentChanges,
  createOfficeAgentHost,
  deleteHiddenSheets,
  dropAgentBackups,
  undoAgentChanges,
  type AgentUndo,
  mergeUndoData,
} from "./officeAgentHost.js";
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
  localizeMessage,
  responseLanguage,
  translate,
  loadLanguage,
  nextLanguage,
  saveLanguage,
  type Language,
} from "./i18n.js";
import {
  didYouMean,
  doneSentence,
  payrollCard,
  payrollQuestion,
  payrollResult,
  samplePreviewNote,
  usingRowsSummary,
  willBeCreatedOn,
} from "./paneText.js";
import {
  buildOutcomes,
  kindTitle,
  plannedSheetName,
  type OutcomeChart,
} from "./outcome.js";
import {
  answerQuestion,
  normalizeInstruction,
  interpretInstruction,
  looksLikeQuestion,
} from "./intent.js";
import { describeUnhandledJobs, findUnhandledJobs } from "./workflowCheck.js";
import { chooseInstructionRoute } from "./taskpaneRouting.js";
import { createPreviewController } from "./taskpanePreviewControl.js";
import {
  canGroup,
  changeGrouping,
  normalizeChartGrouping,
  readGrouping,
} from "./previewGrouping.js";
import { buildPreviewKpis } from "./previewKpis.js";
import { canCancelPreview } from "./previewCancel.js";
import {
  renderChatListView,
  renderConversationHistoryView,
} from "./taskpaneChatView.js";
import {
  agentToolLabel as agentToolLabelView,
  setAgentStageView,
  showAgentPlanView,
  showAgentSourcesView,
  relationshipEvidence,
  resetAgentRolesView,
  setAgentViewLocalizer,
  setAgentRoleView,
  settleActiveRolesView,
  setLocalizedParts,
  setLocalizedText,
  relocalizeView,
  showWorkbookMapView,
  type AgentStage,
} from "./taskpaneAgentView.js";
import { checkedLine } from "./agentChecked.js";
import { prepareShareComposer, updateShareView } from "./taskpaneShareView.js";
import { noticeInData, NOTICE_MAX_ROWS, type NoticedTile } from "./noticed.js";
import {
  finalRoleStates,
  readBackLine,
  relationshipLine,
} from "./roleEvidence.js";
import { readWorkspaceContext as readWorkspaceContextView } from "./taskpaneWorkspaceContext.js";
import { createWorkspaceNavigation } from "./taskpaneWorkspaceNavigation.js";
import { exploreFor, type ExploreItem } from "./exploreView.js";
import {
  columnStats,
  ideasRequest,
  parseIdeas,
  type ExploreStats,
} from "./exploreIdeas.js";
import { ratesOn } from "./lkTaxRates.js";
import {
  aiFirstOn,
  memoryKey,
  readMemory,
  recallSteps,
  rememberSteps,
  setAiFirst,
} from "./taskpaneAiMode.js";
import { describeUnknownColumns, findUnknownColumns } from "./unknownColumn.js";
import { cleanFirstInstruction, describeNearDuplicates } from "./valueCheck.js";
import { describeIntegrityIssues } from "./integrity.js";
import {
  detectMacroRequest,
  generateMacro,
  type MacroResult,
} from "./macroGen.js";
import {
  buildLocalInsights,
  suggestionToPlanInput,
  type LocalInsights,
} from "./insights.js";
import {
  createM365ApiClient,
  M365ApiError,
  type M365Capabilities,
  type M365RequestTrace,
} from "./api.js";
import { askInPane, setDialogLocalizer } from "./confirmDialog.js";
import {
  agentConsentCard,
  emailSendCard,
  holidaysCard,
  removeResultsCard,
} from "./dialogCards.js";
import {
  buildReportEmailRequest,
  reportEmailConsentMessage,
  reportSummaryText as buildReportSummaryText,
} from "./reportEmailAi.js";
import { validateAssistResult } from "./textAssist.js";
import {
  activeMessages,
  deleteChat,
  emptyChatStore,
  openChat,
  parseChatStore,
  saveActiveChat,
  shouldStartNewChat,
  startNewChat,
  type ChatStore,
} from "./chatSessions.js";
import { applyFollowUpChart } from "./followUp.js";
import {
  ACTION_REQUIREMENTS,
  DiagnosticsLog,
  describeAccessToken,
  describeError,
  describeOfficeHost,
  buildAdvancedCapabilityReport,
  formatEntry,
  stableStorageFingerprint,
} from "./diagnostics.js";
import {
  adaptForSampledRange,
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
  sendGraphMailAdaptive,
  outlookWebDraftUrl,
  isGraphConsentFailure,
  MAX_DIRECT_ATTACHMENT_BYTES,
  MAX_OUTLOOK_ATTACHMENT_BYTES,
  EXCEL_WORKBOOK_MIME,
  PDF_MIME,
  CSV_MIME,
  JPEG_MIME,
  type GraphMailAttachment,
  type GraphMailRequest,
  type GraphDeliveryMode,
} from "./email.js";
import {
  applyApprovedExcelPlan,
  excelValuesToCsv,
  inspectSelectedExcelFormulas,
  inspectSelectedExcelRange,
  inspectWorkbookOverview,
  rollbackItemsFromApplyReport,
  rollbackCreatedItems,
  revealExcelResult,
  readExcelWorkbookBase64,
  readExcelPdfBase64,
  readExcelReportValues,
  readSelectedExcelValues,
  readExcelChartImages,
  readLookupSheetInfo,
  listWorksheetNames,
  listVynorSheets,
  type ExcelActionResult,
} from "./officeExcel.js";
import {
  formatFormulaInspection,
  inspectFormulas,
  isFormulaExplanationRequest,
  isFormulaInspectionRequest,
  isFormulaRepairRequest,
} from "./formulaInspector.js";
import { changeLogRows, type ChangeLogEntry } from "./changeLog.js";
import {
  appendChangeLog,
  writeHolidaySheet,
  writePayrollSheet,
} from "./officeSriLanka.js";
import { holidaySheetRows } from "./sriLanka.js";
import {
  buildPayrollPlan,
  employeesFromSelection,
  isPayrollRequest,
  mapPayrollColumns,
  monthFromRequest,
  type PayrollEmployee,
} from "./payroll.js";
import {
  describePreferences,
  learnFromRequest,
  parsePreferences,
  preferenceFacts,
  PREFERENCES_KEY,
  type WorkbookPreferences,
} from "./preferences.js";
import {
  buildPrivacyReceipt,
  describePrivacyReceipt,
} from "./privacyReceipt.js";
import { currencyGuessFor } from "./businessContext.js";
import {
  buildShareCard,
  parsePastedCells,
  type ShareCard,
} from "./shareCard.js";
import { canvasToBlob } from "./shareCardCanvas.js";
import { drawShareCardStyle, thumbnailDataUrl } from "./shareCardStyles.js";
import {
  SHARE_STYLES,
  availableShareStyles,
  pickShareStyle,
  readShareStyle,
  storeShareStyle,
  type ShareStyle,
} from "./shareStyle.js";
import { onStylePick, updateStylePicker } from "./taskpaneShareStyle.js";
import {
  agentApplyKinds,
  browserStorage,
  classicApplyKinds,
  readLedger,
  recordVerifiedApply,
  savedFooterText,
  type WorkKind,
} from "./timeSaved.js";
import {
  browserShareEnv,
  deliverShare,
  shareOutcomeText,
} from "./shareDelivery.js";
import {
  chooseSmartPath,
  selectionBadges,
  suggestionsForSelection,
  type SmartMode,
  type WorkspaceSchema,
  type WorkspaceSelection,
} from "./smartWorkspace.js";

declare global {
  interface Window {
    __VYNORAI_M365_CONFIG__?: M365OAuthConfig & { apiBaseUrl: string };
    __VYNORAI_DIAG_NOTE__?: (message: string) => void;
  }
}

const config = window.__VYNORAI_M365_CONFIG__;
const status = document.querySelector<HTMLElement>("#status-text");
const statusContainer = document.querySelector<HTMLElement>("#status");
const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
let keyboardNavigationPending = false;
document.addEventListener(
  "keydown",
  (event) => {
    keyboardNavigationPending = event.key === "Tab";
  },
  true,
);
document.addEventListener(
  "pointerdown",
  () => {
    keyboardNavigationPending = false;
  },
  true,
);
skipLink?.addEventListener("focus", () => {
  const keyboardFocus = keyboardNavigationPending;
  keyboardNavigationPending = false;
  skipLink.dataset.keyboardFocus = keyboardFocus ? "true" : "false";
});
skipLink?.addEventListener("blur", () => {
  delete skipLink.dataset.keyboardFocus;
});
const preview = document.querySelector<HTMLElement>("#preview");
const instruction = document.querySelector<HTMLTextAreaElement>("#instruction");
const signIn = document.querySelector<HTMLButtonElement>("#sign-in");
const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
const inspect = document.querySelector<HTMLButtonElement>("#inspect");
const smartRun = document.querySelector<HTMLButtonElement>("#smart-run");
const runMode = document.querySelector<HTMLSelectElement>("#run-mode");
const dupFix = document.querySelector<HTMLElement>("#dup-fix");
const dupFixButton = document.querySelector<HTMLButtonElement>("#dup-fix-btn");
let cleanFirstRequest = "";
/** The person declined to send the summary to the AI: the built-in reading is used for this request. */
let useBuiltInReader = false;
const cancelPreviewButton =
  document.querySelector<HTMLButtonElement>("#cancel-preview");
const analyze = document.querySelector<HTMLButtonElement>("#analyze");
const scriptPlan = document.querySelector<HTMLButtonElement>("#script-plan");
const consentPanel = document.querySelector<HTMLElement>("#ai-consent");
const consentSummary = document.querySelector<HTMLElement>("#ai-summary");
const consentCheck =
  document.querySelector<HTMLInputElement>("#ai-consent-check");
const consentSend = document.querySelector<HTMLButtonElement>("#ai-send");
const consentCancel = document.querySelector<HTMLButtonElement>("#ai-cancel");
const analysisOutput = document.querySelector<HTMLElement>("#ai-result");
const workspaceNavigation = createWorkspaceNavigation(document, (view) => {
  setStatus(
    view === "share"
      ? "Create and verify a report before sharing it."
      : "Create a preview or report first.",
  );
});
function clearAnalysisOutput() {
  if (!analysisOutput) return;
  analysisOutput.textContent = "";
  analysisOutput.dataset.workspacePanel = "work";
  workspaceNavigation.refresh();
}
const apply = document.querySelector<HTMLButtonElement>("#apply");
const emailCard = document.querySelector<HTMLElement>("#email-card");
const emailTo = document.querySelector<HTMLInputElement>("#email-to");
const emailDraftFallback = document.querySelector<HTMLElement>(
  "#email-draft-fallback",
);
const emailDraftLink =
  document.querySelector<HTMLAnchorElement>("#email-draft-link");
const emailDraftNote = document.querySelector<HTMLElement>("#email-draft-note");
const emailSubject = document.querySelector<HTMLInputElement>("#email-subject");
const emailBody = document.querySelector<HTMLTextAreaElement>("#email-body");
const emailFormat = document.querySelector<HTMLSelectElement>("#email-format");
const emailBodyType =
  document.querySelector<HTMLSelectElement>("#email-body-type");
const emailDeliveryMode = document.querySelector<HTMLSelectElement>(
  "#email-delivery-mode",
);
const emailIncludeChart = document.querySelector<HTMLInputElement>(
  "#email-include-chart",
);
const emailCc = document.querySelector<HTMLInputElement>("#email-cc");
const emailBcc = document.querySelector<HTMLInputElement>("#email-bcc");
const emailSend = document.querySelector<HTMLButtonElement>("#email-send");
const emailAiWrite =
  document.querySelector<HTMLButtonElement>("#email-ai-write");
const emailNote = document.querySelector<HTMLElement>("#email-note");
const emailDeliveryStatus = document.querySelector<HTMLElement>(
  "#email-delivery-status",
);
const emailReportName =
  document.querySelector<HTMLElement>("#email-report-name");
const emailAttachmentSize = document.querySelector<HTMLElement>(
  "#email-attachment-size",
);
const selfTest = document.querySelector<HTMLButtonElement>("#self-test");
const copyDiagnostics =
  document.querySelector<HTMLButtonElement>("#copy-diagnostics");
const clearDiagnostics =
  document.querySelector<HTMLButtonElement>("#clear-diagnostics");
const diagnostics = document.querySelector<HTMLElement>("#diagnostics");
const summary = document.querySelector<HTMLElement>("#diagnostics-summary");
const DIAGNOSTICS_PLACEHOLDER = "No sign-in diagnostics yet.";
let accessToken = "";
let capabilities: M365Capabilities | undefined;
let currentPlan: any;
let cachedHeaderLayout:
  | {
      key: string;
      layout: ReturnType<typeof getExcelHeaderLayout>;
    }
  | undefined;
/** Headers and rows of the last inspected selection; used only to draw the preview picture. */
let lastRange: { headers: string[]; rows: unknown[][] } | undefined;
let lastRevealSheet = "";
let currentSourceSheet = "";
let currentRangeAddress = "";
let latestSelectionAddress = "";
let previewSelectionAddress = "";
let lastDoneSentence = "";
let previewSpecs: ExcelColumnSpecs | undefined;
let followUpAggregate = false;
let lastAppliedSpecs: ExcelColumnSpecs | undefined;
/** Set when the table was found around a single clicked cell instead of a dragged selection. */
let autoDetectedAddress = "";
let previewFingerprint = "";
/** When the current request started, to report how long a big workbook took. */
let requestStartedAt = 0;
let previewReadyAt = 0;
/** Set while the data is a sample of a very large range, so a preview never looks like the whole. */
let lastSample: { totalRows: number; sampledRows: number } | undefined;
let applyStartedAt = 0;
let pendingSpecs: ExcelColumnSpecs | undefined;
let refreshPreviewSummary: (() => void) | undefined;
let confirmedPreviewText = "";
let confirmedPreviewSpecs: ExcelColumnSpecs | undefined;
let excludedKinds = new Set<string>();
let lastCreated:
  | { planId: string; sheets: string[]; tables: string[]; names: string[] }
  | undefined;
let galleryPlanId = "";
let galleryResults: ExcelActionResult[] = [];
let language: Language = loadLanguage();
setAgentViewLocalizer((text) => localizeMessage(language, text));
setDialogLocalizer((text) => localizeMessage(language, text));
/**
 * The language of the request in progress: a request typed in Sinhala or Tamil script gets its
 * messages, preview and the words written on the sheet in that language, whatever the pane shows.
 * Labels and buttons keep the pane's language.
 */
let requestLanguage: Language | undefined;
const textLanguage = (): Language => requestLanguage ?? language;
let officePlatformLabel = "Excel";
let lastSummary: SchemaSummary | undefined;
let lastConversationRequest = "";
const LEGACY_SESSION_KEY = "vynorai.m365.excel.session";
const SESSION_KEY = "vynorai.m365.excel.session.v2";
const CONVERSATION_KEY_PREFIX = "vynorai.m365.excel.conversation.v1";
const RESULTS_KEY_PREFIX = "vynorai.m365.excel.results.v1";
const MAX_CONVERSATION_MESSAGES = 12;
/** A reply is at most five bullets; 300 once cut them mid-word. */
const MAX_CONVERSATION_CHARS = 2000;
const MAX_STORED_RESULTS = 40;

type ConversationMessage = {
  kind: "user" | "assistant" | "error";
  text: string;
};

let conversationMessages: ConversationMessage[] = [];
/** All saved chats of this person; the open chat mirrors `conversationMessages`. */
let chatStore: ChatStore = emptyChatStore();
const newChatId = () =>
  (
    globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random()}`
  ).slice(0, 36);

const previewController = createPreviewController((visible) => {
  if (!cancelPreviewButton) return;
  cancelPreviewButton.hidden = !visible;
  cancelPreviewButton.disabled = !visible;
});

function getCachedHeaderLayout(
  input: Parameters<typeof getExcelHeaderLayout>[0],
) {
  // Header layout is safe to reuse only when the workbook location and the first
  // two rows are unchanged. No data rows are retained in this cache.
  const key = JSON.stringify([
    input.workbookId,
    input.worksheetName,
    input.address,
    input.values.slice(0, 2),
  ]);
  if (cachedHeaderLayout?.key === key) {
    log.record("excel:header-layout-cache", "pass", "reused");
    return cachedHeaderLayout.layout;
  }
  const layout = getExcelHeaderLayout(input);
  cachedHeaderLayout = { key, layout };
  log.record("excel:header-layout-cache", "pass", "refreshed");
  return layout;
}

function conversationStorageKey(): string | undefined {
  const claims = describeAccessToken(accessToken);
  if (!claims?.tenantId || !claims.objectId) return undefined;
  return `${CONVERSATION_KEY_PREFIX}.${claims.tenantId}.${claims.objectId}`;
}

/** Produces a non-reversible workbook key; the document URL is never stored. */
function workbookStorageFingerprint(): string | undefined {
  const url = String(office()?.context?.document?.url ?? "");
  if (!url) return undefined;
  return stableStorageFingerprint(url);
}

function resultsStorageKey(): string | undefined {
  const claims = describeAccessToken(accessToken);
  const workbook = workbookStorageFingerprint();
  if (!claims?.tenantId || !claims.objectId || !workbook) return undefined;
  return `${RESULTS_KEY_PREFIX}.${claims.tenantId}.${claims.objectId}.${workbook}`;
}

function persistResultGallery() {
  const key = resultsStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        planId: galleryPlanId,
        results: galleryResults.slice(-MAX_STORED_RESULTS).map((result) => ({
          kind: result.kind,
          name: result.name,
          targetSheet: result.targetSheet,
          status: result.status,
          ...(result.createdSheet ? { createdSheet: true } : {}),
          ...(result.createdNames?.length
            ? { createdNames: result.createdNames.slice(0, 20) }
            : {}),
        })),
      }),
    );
  } catch {
    // Convenience metadata must never affect workbook work.
  }
}

async function restoreResultGallery() {
  const key = resultsStorageKey();
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null") as {
      planId?: unknown;
      results?: unknown;
    } | null;
    if (
      !parsed ||
      typeof parsed.planId !== "string" ||
      !Array.isArray(parsed.results)
    )
      return;
    const sheets = new Set(await listVynorSheets(officeRuntime()));
    const restored = parsed.results
      .filter((entry): entry is Record<string, unknown> => {
        if (!entry || typeof entry !== "object") return false;
        const item = entry as Record<string, unknown>;
        return (
          typeof item.kind === "string" &&
          typeof item.name === "string" &&
          typeof item.targetSheet === "string" &&
          (item.status === "created" || item.status === "exists") &&
          sheets.has(item.targetSheet)
        );
      })
      .slice(-MAX_STORED_RESULTS)
      .map((item) => ({
        kind: item.kind as string,
        name: item.name as string,
        targetSheet: item.targetSheet as string,
        status: item.status as ExcelActionResult["status"],
        ...(item.createdSheet === true ? { createdSheet: true } : {}),
        ...(Array.isArray(item.createdNames)
          ? {
              createdNames: item.createdNames
                .filter((name): name is string => typeof name === "string")
                .slice(0, 20),
            }
          : {}),
      }));
    if (!restored.length) return;
    galleryPlanId = parsed.planId;
    galleryResults = restored;
    renderResultGallery();
    log.record("gallery:restore", "pass", { results: restored.length });
  } catch (error) {
    localStorage.removeItem(key);
    log.record("gallery:restore", "skip", describeError(error));
  }
}

function chatsStorageKey(): string | undefined {
  const claims = describeAccessToken(accessToken);
  if (!claims?.tenantId || !claims.objectId) return undefined;
  return `vynorai.m365.excel.chats.v1.${claims.tenantId}.${claims.objectId}`;
}

function writeChatStore() {
  const key = chatsStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(chatStore));
  } catch {
    // Conversation history is a convenience; storage failures must not affect Excel work.
  }
}

function persistConversation() {
  chatStore = saveActiveChat(
    chatStore,
    conversationMessages,
    Date.now(),
    newChatId,
  );
  writeChatStore();
  renderChatList();
}

/** The chat picker holds prior conversations; starting a fresh chat has its own visible button. */
function renderChatList() {
  renderChatListView({
    document,
    language,
    store: chatStore,
    messages: conversationMessages,
    instruction,
    contextSuggestionsVisible: Boolean(
      contextSuggestions && !contextSuggestions.hidden,
    ),
    contextSuggestionCount: contextSuggestionList?.children.length ?? 0,
    setStatus,
  });
}

/** A different chat starts clean: no preview, no follow-up memory from the one before. */
function resetWorkingState() {
  previewController.cancel();
  currentPlan = undefined;
  previewFingerprint = "";
  previewSpecs = undefined;
  confirmedPreviewText = "";
  confirmedPreviewSpecs = undefined;
  lastAppliedSpecs = undefined;
  followUpAggregate = false;
  lastConversationRequest = "";
  document
    .querySelector<HTMLElement>("#result-card")
    ?.setAttribute("hidden", "");
  const outcomes = document.querySelector<HTMLElement>("#outcomes");
  if (outcomes) outcomes.textContent = "";
  if (apply) apply.disabled = true;
  if (instruction) instruction.value = "";
  requestLanguage = undefined;
}

function showChat(messages: ConversationMessage[]) {
  conversationMessages = messages.map((entry) => ({ ...entry }));
  resetWorkingState();
  renderConversationHistory();
  renderChatList();
  window.requestAnimationFrame(() => scrollToLatestMessage(document, window));
}

function renderConversationHistory() {
  renderConversationHistoryView({
    document,
    language,
    textLanguage: textLanguage(),
    store: chatStore,
    messages: conversationMessages,
    instruction,
    contextSuggestionsVisible: Boolean(
      contextSuggestions && !contextSuggestions.hidden,
    ),
    contextSuggestionCount: contextSuggestionList?.children.length ?? 0,
    setStatus,
  });
}

function restoreConversationHistory() {
  const chatsKey = chatsStorageKey();
  const key = conversationStorageKey();
  conversationMessages = [];
  chatStore = emptyChatStore();
  if (chatsKey) {
    try {
      chatStore = parseChatStore(
        localStorage.getItem(chatsKey),
        key ? localStorage.getItem(key) : null,
        Date.now(),
        newChatId,
        MAX_CONVERSATION_CHARS,
      );
      // Opening a different workbook starts a fresh chat; the earlier chats stay in the picker.
      const workbookKey = `${chatsKey}.workbook`;
      const workbook = workbookStorageFingerprint();
      if (shouldStartNewChat(localStorage.getItem(workbookKey), workbook))
        chatStore = startNewChat(chatStore);
      if (workbook) localStorage.setItem(workbookKey, workbook);
      conversationMessages = activeMessages(chatStore).map((entry) => ({
        ...entry,
      }));
      renderConversationHistory();
      renderChatList();
      window.requestAnimationFrame(() =>
        scrollToLatestMessage(document, window),
      );
      return;
    } catch {
      // fall back to nothing: a damaged history must never affect the add-in
    }
  }
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (!Array.isArray(parsed)) return;
    conversationMessages = parsed
      .filter(
        (entry): entry is ConversationMessage =>
          entry &&
          (entry.kind === "user" ||
            entry.kind === "assistant" ||
            entry.kind === "error") &&
          typeof entry.text === "string",
      )
      .slice(-MAX_CONVERSATION_MESSAGES)
      .map((entry) => ({
        kind: entry.kind,
        text: entry.text.slice(0, MAX_CONVERSATION_CHARS),
      }));
    renderConversationHistory();
  } catch {
    // A malformed local history is discarded, never allowed to affect the add-in.
    localStorage.removeItem(key);
  }
}

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  /** When this token was issued; a long session is renewed once it is a day old. */
  issuedAt?: number;
  /** True for the 30 day VynorAI session, false for the short Microsoft token. */
  long?: boolean;
}

const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

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

/** Office dialog error codes, explained in words a person can act on. */
function signInDialogMessage(code: unknown): string {
  if (code === 12007)
    return "A Microsoft sign-in window is already open. Finish it, or close it and press Sign in again.";
  if (code === 12009)
    return "The sign-in window was blocked. Allow pop-ups for this page, then press Sign in again.";
  if (code === 12011)
    return "The browser blocked the sign-in window. Allow pop-ups for Office, then press Sign in again.";
  return `Unable to open the Microsoft sign-in dialog (${String(code ?? "unknown")}).`;
}

let lastStatus = "";
const SIGNED_IN_IDLE_STATUS = "Signed in. Select data and inspect it.";
/** The preview card's badge: "No changes yet" before Apply, "Applied" after it, so it never contradicts the status line. */
function setPreviewBadge(applied: boolean) {
  const badge = document.querySelector<HTMLElement>(
    "#result-card [data-i18n='preview_safe'], #result-card [data-i18n='preview_applied']",
  );
  if (!badge) return;
  badge.dataset.i18n = applied ? "preview_applied" : "preview_safe";
  badge.textContent = localizeMessage(
    textLanguage(),
    applied ? "Applied" : "No changes yet",
  );
}

function setStatus(message: string) {
  lastStatus = message;
  if (status) status.textContent = localizeMessage(textLanguage(), message);
  const normalized = message.toLocaleLowerCase();
  const tone =
    /failed|error|could not|unavailable|missing|expired|rejected|invalid|no credits|blocked/.test(
      normalized,
    )
      ? "error"
      : /ready|signed in|completed|done|applied|removed|answered/.test(
            normalized,
          )
        ? "success"
        : /opening|completing|inspecting|reading|requesting|applying|analyzing|writing/.test(
              normalized,
            )
          ? "busy"
          : "idle";
  if (statusContainer) {
    statusContainer.dataset.tone = tone;
    statusContainer.setAttribute("aria-busy", String(tone === "busy"));
    // The signed-in landing message is not useful once the pane is ready. Keep the
    // overflow menu reachable, but collapse the status copy so it does not consume
    // the first-use workspace.
    statusContainer.dataset.mode =
      accessToken && message === SIGNED_IN_IDLE_STATUS
        ? "signed-in-idle"
        : "message";
  }
}

/** Bounded, identity-scoped conversation history; workbook values are never added here. */
function renderConversation(
  kind: "user" | "assistant" | "error",
  text: string,
  follow = true,
) {
  if (!text) return;
  conversationMessages.push({
    kind,
    text: text.slice(0, MAX_CONVERSATION_CHARS),
  });
  conversationMessages = conversationMessages.slice(-MAX_CONVERSATION_MESSAGES);
  renderConversationHistory();
  persistConversation();
  // Normal chat follows the newest reply. Agent work keeps its dedicated progress card in view
  // so contextual suggestions are never left half-clipped above the conversation.
  if (follow)
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>("#conversation-history")
        ?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    });
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

let emailSending = false;

type EmailFormat = "auto" | "xlsx" | "pdf" | "csv" | "xlsx-pdf" | "summary";

function splitEmailAddresses(value: string): string[] {
  return value
    .split(/[;,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasWorkbookReportForEmail(): boolean {
  return Boolean(lastCreated?.sheets.length || galleryResults.length);
}

function updateEmailUi(signedIn = Boolean(accessToken)) {
  updateShareView(
    {
      card: emailCard,
      note: emailNote,
      to: emailTo,
      subject: emailSubject,
      body: emailBody,
      send: emailSend,
    },
    {
      signedIn,
      hasReport: hasWorkbookReportForEmail(),
      configured: Boolean(config?.graphScopes?.length),
      sending: emailSending,
    },
  );
}

function prepareEmailComposer(recipient = "", openShare = true) {
  if (emailDeliveryStatus) {
    emailDeliveryStatus.className = "delivery-status";
    emailDeliveryStatus.textContent = localizeMessage(
      language,
      "Not sent yet · approval required",
    );
  }
  if (emailReportName)
    emailReportName.textContent =
      lastRevealSheet || currentSourceSheet || "Workbook report";
  if (emailAttachmentSize)
    emailAttachmentSize.textContent = localizeMessage(
      language,
      "Size calculated after approval",
    );
  updateEmailUi();
  workspaceNavigation.refresh();
  if (openShare) workspaceNavigation.activate("share");
  prepareShareComposer(
    {
      card: emailCard,
      note: emailNote,
      to: emailTo,
      subject: emailSubject,
      body: emailBody,
      send: emailSend,
    },
    {
      recipient,
      reportSheet: lastRevealSheet || currentSourceSheet || "Workbook",
    },
  );
}

function createOAuthAttemptStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

async function acquireGraphMailToken(
  scopesOverride?: string[],
): Promise<string> {
  if (!config) throw new Error("EMAIL_PERMISSION_NOT_CONFIGURED");
  const scopes = scopesOverride ?? config?.graphScopes;
  if (!scopes?.length) throw new Error("EMAIL_PERMISSION_NOT_CONFIGURED");
  const graphConfig: M365OAuthConfig = {
    ...config,
    scopes: [...new Set(scopes)],
  };
  const attemptStorage = createOAuthAttemptStorage();
  const authorizeUrl = await log.step("email:oauth-authorize-url", () =>
    beginM365OAuth(graphConfig, attemptStorage),
  );
  const callbackUrl = await signInWithOfficeDialog(authorizeUrl);
  const tokens = await log.step(
    "email:oauth-token-exchange",
    () => completeM365OAuth(callbackUrl, graphConfig, attemptStorage),
    (value) => ({ expiresIn: value.expiresIn, tokenType: value.tokenType }),
  );
  return tokens.accessToken;
}

function emailErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    EMAIL_PERMISSION_NOT_CONFIGURED:
      "Email is not configured for this deployment. Ask the Microsoft 365 administrator to add Mail.Send consent.",
    EMAIL_PERMISSION_DENIED:
      "Microsoft denied Mail.Send. Grant the permission or ask your administrator, then try again.",
    EMAIL_LARGE_ATTACHMENT_PERMISSION_REQUIRED:
      "Large or multiple attachments need delegated Mail.ReadWrite and Mail.Send consent. Add graphLargeScopes to the deployment configuration.",
    EMAIL_ATTACHMENT_TOO_LARGE: `This report is larger than the Microsoft Outlook attachment limit of ${Math.round(MAX_OUTLOOK_ATTACHMENT_BYTES / 1_000_000)} MB. Use a SharePoint/OneDrive link or a smaller report.`,
    XLSX_EXPORT_UNAVAILABLE:
      "This Excel host cannot export the workbook as XLSX through Office.js.",
    XLSX_EXPORT_FAILED: "Excel could not prepare the XLSX attachment.",
    XLSX_SLICE_READ_FAILED: "Excel could not read one XLSX attachment slice.",
    PDF_EXPORT_UNAVAILABLE:
      "This Excel host cannot export a PDF through Office.js.",
    PDF_EXPORT_FAILED: "Excel could not prepare the PDF report.",
    PDF_SLICE_READ_FAILED: "Excel could not read one PDF report slice.",
    EXCEL_API_UNAVAILABLE:
      "This Excel host does not expose the required report API.",
    REPORT_SHEET_EMPTY: "The applied report sheet is empty.",
    EMAIL_RECIPIENT_INVALID: "Enter one valid recipient email address.",
    EMAIL_RECIPIENT_LIMIT:
      "Use no more than 20 recipients in each address field.",
    EMAIL_CC_INVALID: "Enter valid CC email addresses.",
    EMAIL_BCC_INVALID: "Enter valid BCC email addresses.",
    EMAIL_SUBJECT_INVALID: "Enter a subject without line breaks.",
    EMAIL_BODY_INVALID:
      "The email body is too long or contains too many blank lines.",
    EMAIL_ATTACHMENT_SIZE_MISMATCH:
      "The generated attachment failed its size verification and was not sent.",
    EMAIL_DRAFT_INVALID: "Microsoft did not return a valid Outlook draft.",
    EMAIL_UPLOAD_SESSION_INVALID:
      "Microsoft did not return a valid large-file upload session.",
  };
  return messages[code] || `Email was not sent (${code}).`;
}

emailTo?.addEventListener("input", () => updateEmailUi());
emailSubject?.addEventListener("input", () => updateEmailUi());

function escapeEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToBase64(value: string): { base64: string; bytes: number } {
  const data = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize)
    binary += String.fromCharCode(
      ...data.subarray(offset, Math.min(data.length, offset + chunkSize)),
    );
  return { base64: btoa(binary), bytes: data.byteLength };
}

function base64Bytes(value: string): number {
  return Math.max(
    0,
    Math.floor((value.length * 3) / 4) -
      (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
}

function reportSummaryText(values: any[][], truncated: boolean): string {
  return buildReportSummaryText(
    galleryResults,
    lastRevealSheet || currentSourceSheet || "Workbook",
    values,
    truncated,
  );
}

function reportSummaryHtml(values: any[][], truncated: boolean): string {
  const rows = values
    .slice(0, 80)
    .map(
      (row) =>
        `<tr>${row
          .slice(0, 30)
          .map((cell) => `<td>${escapeEmailHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const results = galleryResults
    .slice(-20)
    .map(
      (result) =>
        `<li>${escapeEmailHtml(`${result.kind}: ${result.name} on ${result.targetSheet} (${result.status})`)}</li>`,
    )
    .join("");
  return `<h3>VynorAI Excel report</h3><p>Report sheet: ${escapeEmailHtml(lastRevealSheet || currentSourceSheet || "Workbook")}</p><ul>${results}</ul>${rows ? `<table border="1" cellpadding="4" cellspacing="0"><tbody>${rows}</tbody></table>` : ""}${truncated ? "<p><em>Report preview truncated to a bounded local sample.</em></p>" : ""}`;
}

async function buildEmailRequest(): Promise<{
  request: GraphMailRequest;
  format: string;
}> {
  const requested = (emailFormat?.value || "auto") as EmailFormat;
  const bodyType = emailBodyType?.value === "Text" ? "Text" : "HTML";
  const reportSheet = lastRevealSheet || currentSourceSheet;
  let values: any[][] = [];
  let truncated = false;
  if (reportSheet && requested !== "xlsx") {
    const report = await readExcelReportValues(reportSheet, 200, 30);
    values = report.values;
    truncated = report.truncated;
  }
  const attachments: GraphMailAttachment[] = [];
  let actualFormat: string = requested;
  const addFile = (
    name: string,
    contentType: string,
    contentBytes: string,
    bytes: number,
    options: Pick<GraphMailAttachment, "isInline" | "contentId"> = {},
  ) => attachments.push({ name, contentType, contentBytes, bytes, ...options });
  const readWorkbook = async () => {
    const file = await readExcelWorkbookBase64(MAX_OUTLOOK_ATTACHMENT_BYTES);
    addFile(
      "VynorAI-Excel-Report.xlsx",
      EXCEL_WORKBOOK_MIME,
      file.base64,
      file.byteLength,
    );
  };
  const readPdf = async () => {
    const file = await readExcelPdfBase64(MAX_OUTLOOK_ATTACHMENT_BYTES);
    addFile("VynorAI-Excel-Report.pdf", PDF_MIME, file.base64, file.byteLength);
  };
  if (requested === "xlsx" || requested === "xlsx-pdf") await readWorkbook();
  if (requested === "pdf" || requested === "xlsx-pdf") await readPdf();
  if (requested === "csv") {
    const csv = textToBase64(excelValuesToCsv(values));
    addFile("VynorAI-Report.csv", CSV_MIME, csv.base64, csv.bytes);
  }
  if (requested === "auto") {
    try {
      await readWorkbook();
      actualFormat = "xlsx";
    } catch (error) {
      if (!/XLSX_EXPORT|XLSX_SLICE|COMPRESSED/i.test(String(error)))
        throw error;
      await readPdf();
      actualFormat = "pdf-fallback";
    }
  }
  if (requested === "summary" && !values.length && reportSheet) {
    const report = await readExcelReportValues(reportSheet, 200, 30);
    values = report.values;
    truncated = report.truncated;
  }
  const includeChart = emailIncludeChart?.checked === true;
  const charts =
    includeChart && reportSheet
      ? await readExcelChartImages(reportSheet, 3)
      : [];
  const baseMessage =
    emailBody?.value.trim() ||
    "Please find the approved VynorAI report attached.";
  let body = baseMessage;
  if (bodyType === "HTML") {
    body = `<p>${escapeEmailHtml(baseMessage).replace(/\n/g, "<br>")}</p>${reportSummaryHtml(values, truncated)}`;
    for (const chart of charts) {
      const attachmentName = `${chart.name.replace(/[^A-Za-z0-9 _.-]/g, "_")}.jpg`;
      addFile(
        attachmentName,
        JPEG_MIME,
        chart.base64,
        base64Bytes(chart.base64),
        {
          isInline: true,
          contentId: chart.contentId,
        },
      );
      body += `<h4>${escapeEmailHtml(chart.name)}</h4><img src="cid:${escapeEmailHtml(chart.contentId)}" alt="${escapeEmailHtml(chart.name)}" />`;
    }
  } else {
    body = `${baseMessage}\n\n${reportSummaryText(values, truncated)}`;
    for (const chart of charts)
      addFile(
        `${chart.name.replace(/[^A-Za-z0-9 _.-]/g, "_")}.jpg`,
        JPEG_MIME,
        chart.base64,
        base64Bytes(chart.base64),
      );
  }
  return {
    format: actualFormat,
    request: {
      to: splitEmailAddresses(emailTo?.value || ""),
      cc: splitEmailAddresses(emailCc?.value || ""),
      bcc: splitEmailAddresses(emailBcc?.value || ""),
      subject: emailSubject?.value.trim() || "VynorAI Excel report",
      body,
      bodyType,
      attachments,
    },
  };
}

/**
 * When Microsoft will not give the Mail.Send permission (an administrator has not approved the app),
 * the report summary becomes a ready draft in Outlook on the web. No Graph permission is involved, and
 * nothing is sent: the person reviews the draft and presses Send themselves.
 */
async function offerOutlookDraft(): Promise<void> {
  if (!emailDraftFallback || !emailDraftLink || !emailTo || !emailSubject)
    return;
  const reportSheet = lastRevealSheet || currentSourceSheet;
  let values: any[][] = [];
  let truncated = false;
  try {
    if (reportSheet) {
      const report = await readExcelReportValues(reportSheet, 30, 8);
      values = report.values;
      truncated = report.truncated;
    }
  } catch {
    // The draft still opens with the message only.
  }
  const message =
    emailBody?.value.trim() ||
    "Please find the approved VynorAI report summary below.";
  const draft = outlookWebDraftUrl({
    to: splitEmailAddresses(emailTo.value),
    cc: splitEmailAddresses(emailCc?.value || ""),
    bcc: splitEmailAddresses(emailBcc?.value || ""),
    subject: emailSubject.value.trim() || "VynorAI Excel report",
    body: `${message}

${reportSummaryText(values, truncated)}`,
  });
  emailDraftLink.href = draft.url;
  if (emailDraftNote)
    emailDraftNote.textContent = draft.bodyTruncated
      ? "The summary was shortened for the link. Attach the workbook yourself if you need all of it."
      : "Attachments cannot be added through a link; attach the workbook yourself if you need it.";
  emailDraftFallback.hidden = false;
  log.record("email:outlook-draft-link", "pass", { recipient: "redacted" });
}

// Optional, only when asked: the AI writes the message from the same summary the email would carry.
// The summary is shown first, nothing leaves the pane without a yes, and the result only fills the
// editable message box; it is never sent from here.
emailAiWrite?.addEventListener("click", async () => {
  if (!emailBody || !emailAiWrite) return;
  const reportSheet = lastRevealSheet || currentSourceSheet;
  if (!reportSheet) return setStatus("Create a report first.");
  emailAiWrite.disabled = true;
  try {
    const report = await readExcelReportValues(reportSheet, 200, 30);
    const summary = reportSummaryText(report.values, report.truncated);
    if (
      !(await askInPane(
        reportEmailConsentMessage(summary),
        "Send and write",
        "Cancel",
      ))
    )
      return setStatus("Nothing was sent to AI.");
    setStatus("Writing the message...");
    const response = await apiClient().assistText(
      buildReportEmailRequest(summary, true),
    );
    const answer = validateAssistResult(response?.result);
    emailBody.value = answer.text.slice(0, 4000);
    updateEmailUi();
    setStatus(
      "The message was written by AI. Read and edit it before you send the report.",
    );
  } catch (error) {
    setStatus(
      `The message could not be written (${String((error as Error)?.message ?? error).slice(0, 120)}). Write it yourself or try again.`,
    );
  } finally {
    emailAiWrite.disabled = false;
  }
});

emailSend?.addEventListener("click", async () => {
  if (!emailTo || !emailSubject || !emailBody || !emailSend) return;
  const to = emailTo.value.trim();
  const subject = emailSubject.value.trim();
  const body = emailBody.value.trim();
  if (!to || !subject) return setStatus("Enter a recipient and subject first.");
  if (
    !(await askInPane(
      `Deliver the reviewed report to ${to}? The selected format may include workbook data, report details and charts.`,
      "Send Excel report",
      undefined,
      emailSendCard(to, subject, textLanguage()),
    ))
  )
    return;
  emailSending = true;
  updateEmailUi();
  try {
    setStatus("Preparing the approved report variants...");
    const prepared = await log.step(
      "email:prepare-report",
      buildEmailRequest,
      (value) => ({
        format: value.format,
        attachments: value.request.attachments?.map((attachment) => ({
          name: attachment.name,
          bytes: attachment.bytes,
        })),
      }),
    );
    if (emailReportName) {
      const names = (prepared.request.attachments ?? []).map(
        (attachment) => attachment.name,
      );
      emailReportName.textContent = names.join(", ") || "Summary in email";
    }
    if (emailAttachmentSize) {
      const bytes = (prepared.request.attachments ?? []).reduce(
        (total, attachment) => total + attachment.bytes,
        0,
      );
      emailAttachmentSize.textContent = bytes
        ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
        : "No attachment";
    }
    const requiresLargePermission =
      (prepared.request.attachments ?? []).some(
        (attachment) => attachment.bytes >= MAX_DIRECT_ATTACHMENT_BYTES,
      ) ||
      (prepared.request.attachments ?? []).reduce(
        (total, attachment) => total + attachment.bytes,
        0,
      ) >= MAX_DIRECT_ATTACHMENT_BYTES;
    const deliveryMode: GraphDeliveryMode =
      emailDeliveryMode?.value === "draft" ? "draft" : "send";
    setStatus(
      requiresLargePermission || deliveryMode === "draft"
        ? "Requesting Microsoft draft and large-attachment permission..."
        : "Requesting Microsoft email permission...",
    );
    const graphToken = await acquireGraphMailToken(
      requiresLargePermission || deliveryMode === "draft"
        ? (config?.graphLargeScopes ?? config?.graphScopes)
        : config?.graphScopes,
    );
    setStatus(
      deliveryMode === "draft"
        ? "Creating and verifying the Outlook draft..."
        : "Sending and verifying the approved report...",
    );
    const delivery = await log.step("email:send-report", () =>
      sendGraphMailAdaptive(graphToken, prepared.request, fetch, deliveryMode),
    );
    log.record("email:send", "pass", {
      recipient: "redacted",
      delivery,
      format: prepared.format,
      attachments: prepared.request.attachments?.length ?? 0,
    });
    setStatus(
      deliveryMode === "draft"
        ? `Outlook draft created for ${to} and verified by Microsoft Graph.`
        : `Report sent to ${to} and verified by Microsoft Graph.`,
    );
    if (emailDeliveryStatus) {
      emailDeliveryStatus.className = "delivery-status sent";
      emailDeliveryStatus.textContent =
        deliveryMode === "draft"
          ? "Draft created · verified by Microsoft Graph"
          : "Sent · verified by Microsoft Graph";
    }
  } catch (error) {
    log.record("email:send", "fail", emailErrorMessage(error));
    if (isGraphConsentFailure(error)) {
      await offerOutlookDraft();
      setStatus(
        "Microsoft did not give this add-in permission to send mail (your organization's administrator may need to approve it). Nothing was sent. Use the link below to open the report as a draft in Outlook on the web.",
      );
    } else setStatus(emailErrorMessage(error));
    if (emailDeliveryStatus) {
      emailDeliveryStatus.className = "delivery-status failed";
      emailDeliveryStatus.textContent = "Not sent · review the error and retry";
    }
  } finally {
    emailSending = false;
    updateEmailUi();
  }
});

function updateAuthenticationUi(signedIn: boolean) {
  if (signIn) signIn.disabled = signedIn;
  if (signOut) signOut.disabled = !signedIn;
  if (inspect)
    inspect.disabled = !signedIn || capabilities?.excel.canInspect === false;
  if (analyze)
    analyze.disabled = !signedIn || capabilities?.aiAnalysis === false;
  if (scriptPlan)
    scriptPlan.disabled = !signedIn || capabilities?.aiAnalysis === false;
  const agentRun = document.querySelector<HTMLButtonElement>("#agent-run");
  if (agentRun)
    agentRun.disabled = !signedIn || capabilities?.aiAnalysis === false;
  if (smartRun)
    smartRun.disabled = !signedIn || capabilities?.excel.canInspect === false;
  if (runMode) runMode.disabled = !signedIn;
  updateEmailUi(signedIn);
  document.body.dataset.auth = signedIn ? "in" : "out";
}

async function refreshCapabilities(reason: "oauth" | "restore") {
  if (!accessToken) return;
  try {
    capabilities = await log.step(
      `api:capabilities:${reason}`,
      () => apiClient().capabilities(),
      (value) => ({
        canInspect: value.excel.canInspect,
        canApply: value.excel.canApply,
        actionKinds: value.excel.actionKinds.length,
        writableActionKinds: value.excel.writableActionKinds.length,
        aiAnalysis: value.aiAnalysis,
      }),
    );
    capabilities = {
      ...capabilities,
      advanced: buildAdvancedCapabilityReport(
        capabilities.advanced,
        supportsExcelApi,
      ),
    };
    updateAuthenticationUi(true);
  } catch (error) {
    capabilities = undefined;
    log.record("api:capabilities", "fail", describeError(error));
    updateAuthenticationUi(true);
  }
}

function saveSession(
  tokens: { accessToken: string; expiresIn: number },
  long = false,
) {
  const expiresAt = Date.now() + Math.max(0, tokens.expiresIn - 60) * 1000;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: tokens.accessToken,
      expiresAt,
      issuedAt: Date.now(),
      long,
    } satisfies StoredSession),
  );
}

/**
 * Signing in once is enough: the short Microsoft token is exchanged for a 30 day session, and the
 * session is renewed whenever the add-in is opened a day or more after it was issued. A failure
 * keeps the token we already have, so this can never make signing in worse.
 */
async function extendSession(reason: "sign-in" | "renew") {
  try {
    const created = await apiClient().createSession();
    accessToken = created.sessionToken;
    saveSession(
      {
        accessToken: created.sessionToken,
        expiresIn: created.expiresInSeconds,
      },
      true,
    );
    log.record("session:extend", "pass", {
      reason,
      days: Math.round(created.expiresInSeconds / 86400),
    });
  } catch (error) {
    log.record("session:extend", "fail", describeError(error));
  }
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
    if (
      saved.long &&
      Date.now() - (saved.issuedAt ?? 0) >= SESSION_RENEW_AFTER_MS
    )
      void extendSession("renew");
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

function signOutOfMicrosoft() {
  previewController.cancel();
  cachedHeaderLayout = undefined;
  accessToken = "";
  capabilities = undefined;
  currentPlan = undefined;
  previewFingerprint = "";
  clearAnalysisOutput();
  if (consentPanel) consentPanel.hidden = true;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
  conversationMessages = [];
  chatStore = emptyChatStore();
  renderConversationHistory();
  renderChatList();
  galleryPlanId = "";
  galleryResults = [];
  renderResultGallery();
  lastConversationRequest = "";
  updateAuthenticationUi(false);
  log.record("session:sign-out", "pass", "local session removed");
  setStatus("Signed out. Sign in to inspect selected Excel data.");
}

const API_MESSAGES: Record<string, string> = {
  AI_CONSENT_REQUIRED: "AI analysis needs your explicit consent first.",
  AI_ANALYSIS_INVALID:
    "The AI answer did not match the expected format and was discarded.",
  AI_SCRIPT_INVALID:
    "The planned steps were not safe or did not match the expected format and were discarded. Try again.",
  AI_SCRIPT_REQUEST_REQUIRED:
    "Describe what you want first, then plan the steps.",
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
  HTTP_502: "The VynorAI service is busy or restarting. Try again in a moment.",
  HTTP_503: "The VynorAI service is busy or restarting. Try again in a moment.",
  HTTP_504: "The VynorAI service is busy or restarting. Try again in a moment.",
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
  EXCEL_SELECTION_TOO_LARGE:
    "The selected range is too large. Select at most 100,000 cells and 100 columns.",
};

function editDistance(left: string, right: string): number {
  const a = left.toLocaleLowerCase().trim();
  const b = right.toLocaleLowerCase().trim();
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function suggestMissingColumn(message: string): string {
  if (!lastRange?.headers.length || !/column|columns|key/i.test(message))
    return message;
  const requested = [...message.matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (!requested.length) return message;
  const suggestions = requested
    .map((name) => {
      const match = lastRange!.headers
        .map((header) => ({
          header,
          distance: editDistance(name, header),
        }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (!match) return undefined;
      const limit = Math.max(2, Math.ceil(name.length * 0.4));
      return match.distance <= limit ? match.header : undefined;
    })
    .filter((header): header is string => Boolean(header));
  const unique = [...new Set(suggestions)];
  if (!unique.length) return message;
  return `${message}${didYouMean(unique, textLanguage())}`;
}

function handleApiError(step: string, error: unknown) {
  log.record(step, "fail", describeError(error));
  if (!(error instanceof M365ApiError)) {
    const text = (error as Error).message ?? "";
    const message = /requested resource doesn't exist|ItemNotFound/i.test(text)
      ? "Excel could not find that sheet or range. Click a cell inside your table and try again."
      : suggestMissingColumn(text);
    setStatus(message);
    renderConversation("error", message);
    statusContainer?.focus?.();
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
    const message =
      "Microsoft session changed or expired. Sign in again to continue.";
    setStatus(message);
    renderConversation("error", message);
    return;
  }
  const message =
    API_MESSAGES[error.code] ||
    `VynorAI request failed (${error.code}). See Diagnostics.`;
  setStatus(message);
  renderConversation("error", message);
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
          return reject(new Error(signInDialogMessage(result.error?.code)));
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
    // Each attempt keeps its own state and verifier in memory, so an older or parallel attempt
    // (another click, another pane) can never overwrite them and break this one.
    const attemptValues = new Map<string, string>();
    const attemptStorage = {
      getItem: (key: string) => attemptValues.get(key) ?? null,
      setItem: (key: string, value: string) =>
        void attemptValues.set(key, value),
      removeItem: (key: string) => void attemptValues.delete(key),
    };
    const authorizeUrl = await log.step("oauth:authorize-url", () =>
      beginM365OAuth(config, attemptStorage),
    );
    const callbackUrl = await signInWithOfficeDialog(authorizeUrl);
    const tokens = await log.step(
      "oauth:token-exchange",
      () => completeM365OAuth(callbackUrl, config, attemptStorage),
      (value) => ({ expiresIn: value.expiresIn, tokenType: value.tokenType }),
    );
    accessToken = tokens.accessToken;
    saveSession(tokens);
    void extendSession("sign-in");
    restoreConversationHistory();
    void restoreResultGallery();
    updateAuthenticationUi(true);
    recordTokenSummary("oauth:token-claims");
    void refreshCapabilities("oauth");
    setStatus(SIGNED_IN_IDLE_STATUS);
  } catch (error) {
    log.record("oauth:sign-in", "fail", describeError(error));
    setStatus((error as Error).message);
  }
});

signOut?.addEventListener("click", signOutOfMicrosoft);

function startFreshChat() {
  persistConversation();
  chatStore = startNewChat(chatStore);
  showChat([]);
  setStatus(
    translate(
      language,
      "new_chat_ready",
      "New chat. Select your data and describe what you want.",
    ),
  );
  instruction?.focus();
}

document
  .querySelectorAll<HTMLButtonElement>(".new-chat-action")
  .forEach((button) => button.addEventListener("click", startFreshChat));
document
  .querySelector<HTMLSelectElement>("#chat-history-select")
  ?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    if (!id) return startFreshChat();
    persistConversation();
    chatStore = openChat(chatStore, id);
    showChat(activeMessages(chatStore));
  });
document.querySelector("#delete-chat")?.addEventListener("click", async () => {
  if (!chatStore.activeId) return;
  const confirmed = await askInPane(
    translate(
      language,
      "delete_chat_confirm",
      "Delete this chat from the history? Your workbook is not changed.",
    ),
    translate(language, "delete_chat", "Delete"),
    translate(language, "cancel", "Cancel"),
  );
  if (!confirmed) return;
  chatStore = deleteChat(chatStore, chatStore.activeId);
  writeChatStore();
  showChat([]);
});

cancelPreviewButton?.addEventListener("click", () => {
  if (!previewController.hasActiveRun()) return;
  previewController.cancel();
  log.record("preview:cancel", "pass", "cancelled by user");
  setStatus("Preview cancelled. Nothing has changed in your workbook.");
  updateAuthenticationUi(Boolean(accessToken));
});

/** Cancel on the Preview card: drop an unapplied preview and go back to idle; the workbook is not touched. */
document
  .querySelector<HTMLButtonElement>("#cancel-result")
  ?.addEventListener("click", () => {
    const showResultButton =
      document.querySelector<HTMLElement>("#show-result");
    if (
      !canCancelPreview({
        hasPreview: Boolean(currentPlan || previewFingerprint),
        applying: Boolean(instruction?.disabled),
        applied: Boolean(
          (rollbackButton && !rollbackButton.hidden) ||
            (showResultButton && !showResultButton.hidden),
        ),
      })
    )
      return;
    previewController.cancel();
    pendingSpecs = undefined;
    previewSpecs = undefined;
    excludedKinds = new Set<string>();
    currentPlan = undefined;
    previewFingerprint = "";
    confirmedPreviewText = "";
    confirmedPreviewSpecs = undefined;
    if (apply) apply.disabled = true;
    // The card follows this text: it is not a plan, so the card hides.
    if (preview) preview.textContent = "No preview yet.";
    log.record("preview:cancel", "pass", "cancelled on the preview card");
    setStatus("Preview cancelled. Nothing has changed in your workbook.");
    instruction?.focus();
  });

instruction?.addEventListener("input", () => {
  previewController.cancel();
  pendingSpecs = undefined;
  excludedKinds = new Set<string>();
  currentPlan = undefined;
  previewFingerprint = "";
  confirmedPreviewText = "";
  confirmedPreviewSpecs = undefined;
  lastConversationRequest = "";
  useBuiltInReader = false;
  if (dupFix) dupFix.hidden = true;
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
});

dupFixButton?.addEventListener("click", () => {
  if (!instruction || !cleanFirstRequest) return;
  instruction.value = cleanFirstRequest;
  if (dupFix) dupFix.hidden = true;
  inspect?.click();
});

inspect?.addEventListener("click", async () => {
  if (!config || !accessToken)
    return setStatus("Sign in before inspecting Excel data.");
  const previewRun = previewController.start();
  const { abortController, isStale } = previewRun;
  const stopIfStale = () => {
    if (!isStale()) return false;
    log.record("preview:stale", "skip", "superseded by a newer instruction");
    return true;
  };
  if (apply) apply.disabled = true;
  currentPlan = undefined;
  if (dupFix) dupFix.hidden = true;
  cleanFirstRequest = "";
  const instructionText = normalizeInstruction(instruction?.value || "");
  if (instructionText)
    requestLanguage = responseLanguage(instruction?.value || "", language);
  if (instructionText && instructionText !== lastConversationRequest) {
    renderConversation("user", instruction?.value?.trim() || instructionText);
    lastConversationRequest = instructionText;
    learnPreferences(instructionText);
  }
  // A request for a payroll sheet is a template, not a change to the selected data: it is asked
  // about in the pane and, on a no, read like any other request.
  // A request the person already said no to is not asked about again (tweaks and Refresh re-run it).
  const typed = instruction?.value || "";
  if (
    !skipAiOnce &&
    instructionText !== payrollDeclined &&
    (isPayrollRequest(typed) || isPayrollRequest(instructionText))
  ) {
    if (await offerPayroll(typed)) {
      previewController.finish(previewRun);
      return;
    }
    payrollDeclined = instructionText;
    if (stopIfStale()) return;
  }
  // "AI reads every request" (the person's own setting): the AI turns the request into plain steps first.
  // The steps it returns come back through here once, and are read by the built-in reader.
  const aiTurn =
    aiFirstOn() &&
    !skipAiOnce &&
    Boolean(instructionText) &&
    capabilities?.aiAnalysis !== false;
  // The steps the AI just returned are read as they are: they are never judged weak again.
  const stepsFromAi = skipAiOnce;
  skipAiOnce = false;
  if (aiTurn) {
    previewController.finish(previewRun);
    scriptMode = true;
    autoAi = true;
    void startConsent();
    return;
  }
  try {
    if (
      isFormulaInspectionRequest(instructionText) &&
      !isFormulaExplanationRequest(instructionText) &&
      !isFormulaRepairRequest(instructionText)
    ) {
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
      if (stopIfStale()) return;
      showAnswer(formatFormulaInspection(report));
      return setStatus(
        "Formula inspection is ready. Nothing was sent or changed.",
      );
    }
    autoDetectedAddress = "";
    requestStartedAt = Date.now();
    setStatus("Inspecting the selected range...");
    const input = await log.step(
      "excel:read-selection",
      () =>
        inspectSelectedExcelRange(
          officeRuntime(),
          crypto.randomUUID(),
          500,
          (completed, total) =>
            setStatus(`Reading selected rows: ${completed}/${total}...`),
          (address) => {
            autoDetectedAddress = address;
          },
          () => abortController.signal.aborted,
        ),
      (value) => ({
        sheet: value.worksheetName,
        address: value.address,
        rows: value.values.length,
        columns: value.values[0]?.length ?? 0,
      }),
    );
    if (stopIfStale()) return;
    const layout = getCachedHeaderLayout(input);
    currentSourceSheet = String(input.worksheetName ?? "");
    currentRangeAddress = String(input.address ?? "");
    lastRange = {
      headers: layout.headers.map(String),
      rows: input.values.slice(layout.headerRowCount),
    };
    if (detectMacroRequest(instructionText)) {
      const macro = generateMacro(
        instructionText,
        layout.headers.map(String),
        input.values.slice(layout.headerRowCount),
      );
      log.record(
        "macro:generate",
        macro.ok ? "pass" : "fail",
        macro.ok ? { language: macro.language } : macro.problem,
      );
      if (!macro.ok) {
        renderConversation("error", macro.problem);
        return setStatus(macro.problem);
      }
      showMacro(macro);
      return setStatus("Code is ready to copy. Nothing was run or changed.");
    }
    const interpreted = interpretInstruction(
      instructionText,
      layout.headers,
      input.values.slice(layout.headerRowCount),
    );
    if (interpreted.specs.email) {
      if (!hasWorkbookReportForEmail()) {
        const message =
          "Create and apply the Excel report first. Then use the Email Excel workbook panel to review and approve the XLSX send.";
        renderConversation("error", message);
        return setStatus(message);
      }
      prepareEmailComposer(interpreted.specs.email.to);
      const message =
        "Email preview is ready. Review the recipient and workbook attachment, then approve Send.";
      renderConversation("assistant", message);
      return setStatus(message);
    }
    const wanted = [
      ...new Set([
        ...selectExcelActions(instructionText),
        ...interpreted.actions,
      ]),
    ];
    // A view already writes its own result sheet; "copy this to a new sheet" must not also ask for a copy.
    const filtered = wanted.filter(
      (kind) =>
        !excludedKinds.has(kind) &&
        !(kind === "new-sheet" && interpreted.actions.includes("view")),
    );
    let actions = filtered.length > 0 ? filtered : wanted;
    const {
      lookup: lookupWish,
      lookupColumns: lookupColumnsWish,
      ...plannedSpecs
    } = interpreted.specs;
    // A preview adjustment is deliberate user input, so it overrides the original phrase.
    let specs: ExcelColumnSpecs = {
      ...plannedSpecs,
      ...(pendingSpecs ?? {}),
    };
    // Follow-up: "add a chart for that" reuses the columns of the last applied pivot.
    const followed = applyFollowUpChart(
      specs,
      lastAppliedSpecs,
      instructionText,
      layout.headers.map(String),
      actions,
    );
    log.record("followup:check", "pass", {
      applied: followed.applied,
      hadEarlier: Boolean(lastAppliedSpecs?.pivot),
    });
    specs = followed.specs;
    followUpAggregate = followed.applied;
    previewSpecs = specs;
    if (lookupWish) {
      try {
        const other = await log.step("excel:read-lookup-sheet", () =>
          readLookupSheetInfo(officeRuntime(), lookupWish.sheet),
        );
        if (other.sheet === input.worksheetName)
          throw new Error(
            "Look the value up in a different sheet than your data.",
          );
        const find = (headers: string[], name: string) =>
          headers.findIndex(
            (header) =>
              header.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
          );
        const keyHeaders = lookupWish.keyHeaders ?? [lookupWish.keyHeader];
        const keyAt = keyHeaders.map((header) => find(other.headers, header));
        const returnAt = find(other.headers, lookupWish.returnHeader);
        if (keyAt.some((index) => index < 0))
          throw new Error(
            `The sheet "${other.sheet}" has no all of the key columns (${keyHeaders.join(", ")}) to match on. It has: ${other.headers.join(", ")}.`,
          );
        if (returnAt < 0)
          throw new Error(
            `The sheet "${other.sheet}" has no "${lookupWish.returnHeader}" column. It has: ${other.headers.join(", ")}.`,
          );
        const sourceKeyIndexes = keyHeaders.map((header) =>
          find(layout.headers, header),
        );
        if (sourceKeyIndexes.some((index) => index < 0))
          throw new Error(
            `Your selected data has no all of the key columns (${keyHeaders.join(", ")}). It has: ${layout.headers.join(", ")}.`,
          );
        specs.addColumn = {
          name: other.headers[returnAt],
          lookup: {
            sheet: other.sheet,
            sourceKey: sourceKeyIndexes[0],
            keyIndex: keyAt[0],
            keyHeader: other.headers[keyAt[0]],
            returnIndex: returnAt,
            returnHeader: other.headers[returnAt],
            rows: other.rows,
            ...(keyAt.length > 1
              ? {
                  sourceKeys: sourceKeyIndexes,
                  keyIndexes: keyAt,
                  keyHeaders: keyAt.map((index) => other.headers[index]),
                }
              : {}),
            ...(lookupWish.matchMode
              ? { matchMode: lookupWish.matchMode }
              : {}),
            ...(lookupWish.method ? { method: lookupWish.method } : {}),
          },
        };
        if (stopIfStale()) return;
      } catch (error) {
        log.record("lookup:resolve", "fail", describeError(error));
        return setStatus(suggestMissingColumn((error as Error).message));
      }
    }
    if (lookupColumnsWish) {
      try {
        const other = await log.step("excel:read-lookup-sheet", () =>
          readLookupSheetInfo(officeRuntime(), lookupColumnsWish.sheet),
        );
        if (other.sheet === input.worksheetName)
          throw new Error(
            "Look the value up in a different sheet than your data.",
          );
        const find = (headers: string[], name: string) =>
          headers.findIndex(
            (header) =>
              header.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
          );
        const keyHeaders = lookupColumnsWish.keyHeaders ?? [
          lookupColumnsWish.keyHeader,
        ];
        const keyAt = keyHeaders.map((header) => find(other.headers, header));
        const returnAt = lookupColumnsWish.returnHeaders.map((header) =>
          find(other.headers, header),
        );
        if (keyAt.some((index) => index < 0))
          throw new Error(
            `The sheet "${other.sheet}" has no all of the key columns (${keyHeaders.join(", ")}) to match on. It has: ${other.headers.join(", ")}.`,
          );
        if (returnAt.some((index) => index < 0))
          throw new Error(
            `The sheet "${other.sheet}" does not contain every requested return column (${lookupColumnsWish.returnHeaders.join(", ")}). It has: ${other.headers.join(", ")}.`,
          );
        const sourceKeyIndexes = keyHeaders.map((header) =>
          find(layout.headers, header),
        );
        if (sourceKeyIndexes.some((index) => index < 0))
          throw new Error(
            `Your selected data has no all of the key columns (${keyHeaders.join(", ")}). It has: ${layout.headers.join(", ")}.`,
          );
        specs.lookupColumns = {
          names: returnAt.map((index) => other.headers[index]),
          lookup: {
            sheet: other.sheet,
            sourceKey: sourceKeyIndexes[0],
            keyIndex: keyAt[0],
            keyHeader: other.headers[keyAt[0]],
            returnIndexes: returnAt,
            returnHeaders: returnAt.map((index) => other.headers[index]),
            rows: other.rows,
            ...(keyAt.length > 1
              ? {
                  sourceKeys: sourceKeyIndexes,
                  keyIndexes: keyAt,
                  keyHeaders: keyAt.map((index) => other.headers[index]),
                }
              : {}),
            ...(lookupColumnsWish.matchMode
              ? { matchMode: lookupColumnsWish.matchMode }
              : {}),
            ...(lookupColumnsWish.method
              ? { method: lookupColumnsWish.method }
              : {}),
          },
        };
        if (stopIfStale()) return;
      } catch (error) {
        log.record("lookup-columns:resolve", "fail", describeError(error));
        return setStatus(suggestMissingColumn((error as Error).message));
      }
    }
    if (actions.length === 0) {
      if (looksLikeQuestion(instructionText) && input.sample) {
        // An answer computed from a sample of a very large range would be wrong: say so and offer the exact request.
        const text = `This data has ${Math.max(0, input.sample.totalRows - 1).toLocaleString("en-US")} rows, too many to answer a question from a sample. Ask for a PivotTable instead, for example: "pivot table of total <value column> by <category column>, top 5".`;
        showAnswer(text);
        return setStatus("Nothing was changed.");
      }
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
      const hint =
        interpreted.problems[0] ??
        "Say what to create: a table, chart, result sheet, PivotTable, clean-up, or a computed column. Or ask a question about the data.";
      renderConversation("error", hint);
      setStatus(hint);
      // The built-in reader did not understand it: let the AI interpret the request (the person must still agree to send the summary).
      if (
        !excludedKinds.size &&
        capabilities?.aiAnalysis !== false &&
        accessToken
      ) {
        const remembered = recallSteps(
          memoryKey(instructionText, layout.headers.map(String)),
        );
        if (
          remembered &&
          interpretInstruction(
            remembered.join(" then "),
            layout.headers,
            input.values.slice(layout.headerRowCount),
          ).actions.length > 0
        ) {
          log.record("script:remembered", "pass", { steps: remembered.length });
          renderConversation(
            "assistant",
            localizeMessage(
              language,
              "I remember this request from before, so no AI call was needed.",
            ),
          );
          useSteps({
            steps: remembered.map((instruction) => ({ instruction })),
          });
          return;
        }
        scriptMode = true;
        void startConsent();
        renderConversation(
          "assistant",
          localizeMessage(
            language,
            "I could not read that directly. Agree below and the AI will interpret it; only column names and types are sent.",
          ),
        );
      }
      return;
    }
    lastSample = input.sample;
    if (input.sample) {
      // Very large data: Excel computes a chart or a summary through a PivotTable.
      const adapted = adaptForSampledRange(actions, specs);
      actions = adapted.actions;
      specs = adapted.specs;
      previewSpecs = specs;
    }
    log.record("instruction:actions", "pass", { actions });
    // The built-in reader may have understood only part of the request (it ignores a column the person named,
    // or none of the words match a column): the AI should read it, after the person agrees to send the summary.
    const route = chooseInstructionRoute({
      instructionText,
      headers: layout.headers.map(String),
      reading: { actions, specs, problems: interpreted.problems },
      stepsFromAi,
      useBuiltInReader,
      excludedKinds,
      aiAnalysisEnabled: capabilities?.aiAnalysis !== false,
    });
    if (route.kind === "ai") {
      log.record("instruction:weak-reading", "fail", route.reason);
      scriptMode = true;
      void startConsent();
      renderConversation(
        "assistant",
        localizeMessage(
          language,
          'I am not sure I read that correctly. Agree below and the AI will interpret it; only column names and types are sent. Turn on "AI reads every request" in the menu to skip this question.',
        ),
      );
      return;
    }
    const unhandledJobs = findUnhandledJobs(instructionText, actions);
    if (unhandledJobs.length) {
      log.record("instruction:unhandled", "fail", {
        jobs: unhandledJobs.map((job) => job.label),
      });
      const notice = describeUnhandledJobs(unhandledJobs);
      if (notice) renderConversation("assistant", notice);
    }
    // A PivotTable groups by exact text: "Central" and " Central " would show as two rows.
    // With a clean step in the same plan the grouping steps read the cleaned copy, so there is nothing to warn about.
    const nearDuplicateNotice = actions.includes("clean")
      ? undefined
      : describeNearDuplicates(
          layout.headers.map(String),
          input.values.slice(layout.headerRowCount),
          specs as Parameters<typeof describeNearDuplicates>[2],
        );
    if (nearDuplicateNotice) {
      log.record("instruction:near-duplicates", "fail", nearDuplicateNotice);
      renderConversation("assistant", nearDuplicateNotice);
      // One click re-plans the same request with a clean step in front; nothing is changed until Confirm.
      cleanFirstRequest = cleanFirstInstruction(instructionText);
      if (dupFix && cleanFirstRequest) dupFix.hidden = false;
    }
    // A column name that is not in the selection must not quietly become a plan on some other column.
    const unknownNotice = describeUnknownColumns(
      findUnknownColumns(instructionText, layout.headers.map(String)),
      layout.headers.map(String),
    );
    if (unknownNotice) {
      log.record("instruction:unknown-column", "fail", unknownNotice);
      renderConversation("assistant", unknownNotice);
    }
    const localPreview = await log.step(
      "local:preview",
      () => createExcelPreviewPlan(input, actions, undefined, specs),
      (value) => ({
        actions: value.actions.length,
        warnings: value.warnings.length,
      }),
    );
    if (stopIfStale()) return;
    const plan = await apiClient().planExcel(
      {
        ...input,
        actions,
        ...(Object.keys(specs).length ? { specs } : {}),
      },
      abortController.signal,
    );
    if (stopIfStale()) return;
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
      restoreConfirmedPreview();
      setStatus(
        "The server preview does not match the selection. See Diagnostics.",
      );
      return;
    }
    currentPlan = plan;
    previewController.finish(previewRun);
    previewFingerprint = localPreview.sourceFingerprint;
    previewSelectionAddress = latestSelectionAddress;
    show(selectionChangeWarning, false);
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
    confirmedPreviewText = preview?.textContent ?? "";
    confirmedPreviewSpecs = previewSpecs
      ? (JSON.parse(JSON.stringify(previewSpecs)) as ExcelColumnSpecs)
      : undefined;
    // Keep the visible preview in sync with the plan before the next paint. The
    // MutationObserver below remains useful for external preview updates, but it
    // is asynchronous and could briefly leave a stale Column/Line chart visible
    // after a tweak has already been accepted by the planner.
    refreshPreviewSummary?.();
    if (apply) apply.disabled = false;
    renderSteps(wanted, plan.actions);
    if (rollbackButton) rollbackButton.hidden = true;
    document.querySelector<HTMLElement>("#cleanup")?.setAttribute("hidden", "");
    try {
      renderInsights(buildLocalInsights(input));
    } catch {
      // Insights are optional; the preview above is already valid.
    }
    markChangeNote("preview");
    renderTrace([
      input.sample
        ? `Read a sample of ${input.sample.sampledRows.toLocaleString("en-US")} of ${input.sample.totalRows.toLocaleString("en-US")} rows and ${input.values[0]?.length ?? 0} columns from ${input.address}`
        : `Read ${Math.max(0, input.values.length - 1)} rows and ${input.values[0]?.length ?? 0} columns from ${input.address}`,
      `Understood the request: ${actions.join(", ")}`,
      "Planned it on the server and checked that both plans match. Nothing has changed yet",
    ]);
    setStatus(
      "Preview ready. Nothing has changed yet. Review it before applying.",
    );
    renderConversation("assistant", "Preview ready. Your data is untouched.");
    previewReadyAt = Date.now();
    document.querySelector<HTMLElement>("#preview-heading")?.focus();
    // "Review as you go" off: apply straight away, like Copilot's edit mode.
    if (!reviewToggle?.checked && apply && !apply.disabled) apply.click();
  } catch (error) {
    previewController.finish(previewRun);
    if (isStale()) return;
    restoreConfirmedPreview();
    handleApiError("inspect", error);
  } finally {
    previewController.finish(previewRun);
  }
});

/** The preview card says "nothing has changed"; after an apply that sentence must not stay. */
function markChangeNote(state: "preview" | "applied" | "partial" | "undone") {
  const note = document.querySelector<HTMLElement>("#change-note");
  if (!note) return;
  if (state === "preview" || state === "undone") {
    const showResult = document.querySelector<HTMLElement>("#show-result");
    if (showResult) showResult.hidden = true;
  }
  if (state === "preview") {
    note.dataset.i18n = "nothing_changed";
    note.textContent = localizeMessage(
      language,
      "Nothing has changed in your workbook yet.",
    );
    applyLanguage(note.parentElement ?? document, language);
    return;
  }
  delete note.dataset.i18n;
  note.textContent = localizeMessage(
    language,
    state === "applied"
      ? lastDoneSentence || "Applied. Your source data was not changed."
      : state === "undone"
        ? "Undone. What this add-in created was removed."
        : "Partly applied. See the steps and Diagnostics.",
  );
}

apply?.addEventListener("click", async () => {
  if (!config || !accessToken || !currentPlan || !previewFingerprint)
    return setStatus("Create a preview before applying.");
  // The "Confirm and apply" button is the confirmation: one click, no second dialog.
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
    applyStartedAt = Date.now();
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
            aggregateCharts: followUpAggregate,
            // Read locally for a dashboard's audience, target and currency; never sent anywhere.
            request:
              lastConversationRequest || instruction?.value?.trim() || "",
            preferences: workbookPrefs,
            language: textLanguage(),
            onProgress: (completed, total) =>
              setStatus(`Writing result rows: ${completed}/${total}...`),
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
          kind: result.kind as
            | "table"
            | "chart"
            | "new-sheet"
            | "named-range"
            | "slicer"
            | "pivot-table",
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
    const integrityNotice = describeIntegrityIssues(
      report.results.flatMap((result) =>
        (result.warnings ?? []).map((message) => ({
          kind: "value-changed" as const,
          message,
        })),
      ),
    );
    if (integrityNotice) {
      log.record("apply:integrity", "fail", integrityNotice);
      renderConversation("error", integrityNotice);
    }
    lastCreated = rollbackItemsFromApplyReport(
      approvedPlan.planId,
      report.results,
    );
    galleryPlanId = approvedPlan.planId;
    galleryResults = report.results;
    persistResultGallery();
    renderResultGallery();
    prepareEmailComposer("", false);
    updateEmailUi();
    workspaceNavigation.refresh();
    workspaceNavigation.activate("results");
    if (rollbackButton)
      rollbackButton.hidden =
        lastCreated.sheets.length + lastCreated.tables.length === 0;
    currentPlan = undefined;
    previewFingerprint = "";
    setPreviewBadge(failed.length === 0);
    lastDoneSentence = failed.length
      ? ""
      : doneSentence(
          report.results,
          report.sourceUnchangedAfterApply,
          textLanguage(),
        );
    markChangeNote(failed.length ? "partial" : "applied");
    await logChanges({
      at: new Date(),
      action: failed.length ? "partly applied" : "applied",
      request: lastConversationRequest || instruction?.value?.trim() || "",
      changes: report.results.map((result) => ({
        change: `${result.kind}: ${result.name}`,
        sheet: result.targetSheet,
        status: String(result.status),
      })),
      reference: approvedPlan.planId,
    });
    noteVerifiedApply(
      classicApplyKinds(report.results, report.sourceUnchangedAfterApply),
    );
    renderChanged(
      report.results.map(
        (result) =>
          `${result.kind} - ${result.targetSheet}${result.status === "exists" ? " (already existed)" : ""}`,
      ),
    );
    if (!failed.length) lastAppliedSpecs = previewSpecs;
    // How a result was built (a fallback, a feature this Excel lacks), so nothing differs silently.
    const buildNotes = report.results.flatMap((result) => result.notes ?? []);
    if (buildNotes.length)
      renderConversation("assistant", buildNotes.join(" "));
    document.querySelector<HTMLElement>("#cleanup")?.removeAttribute("hidden");
    document
      .querySelectorAll<HTMLElement>("#outcomes .where")
      .forEach((node) => {
        node.textContent = (node.textContent ?? "")
          .replace("Will be created on sheet", "Created on sheet")
          .replace("සාදනු ඇත", "සාදන ලදී");
      });
    document
      .querySelector("#change-note")
      ?.scrollIntoView?.({ block: "center" });
    const reveal = report.results.find(
      (result) => result.status === "created" || result.status === "exists",
    );
    lastRevealSheet = reveal?.targetSheet ?? "";
    if (lastRevealSheet) {
      await revealExcelResult(officeRuntime(), lastRevealSheet);
      try {
        // Excel swaps in its own PivotTable Fields pane after a pivot is built: bring ours back.
        await (globalThis as any).Office?.addin?.showAsTaskpane?.();
      } catch {
        // Not supported by this host; the pane stays where it is.
      }
      // Excel selects a new PivotTable a moment after it is built, which opens its field list
      // over our pane. Moving the selection back out a little later closes that list again.
      if (report.results.some((entry) => entry.kind === "pivot-table")) {
        const sheetName = lastRevealSheet;
        for (const delay of [1200, 3000])
          window.setTimeout(() => {
            void revealExcelResult(officeRuntime(), sheetName);
          }, delay);
      }
      const showResult =
        document.querySelector<HTMLButtonElement>("#show-result");
      if (showResult) showResult.hidden = false;
    }
    let replaced = 0;
    const replaceOlder =
      document.querySelector<HTMLInputElement>("#replace-toggle");
    if (!failed.length && replaceOlder?.checked && lastRevealSheet) {
      try {
        // Only sheets with the Office custom property set by VynorAI are returned here.
        const older = (await listVynorSheets(officeRuntime())).filter(
          (sheet) => sheet !== lastRevealSheet,
        );
        if (older.length) {
          const removed = await rollbackCreatedItems(
            officeRuntime(),
            { sheets: older, tables: [] },
            true,
          );
          replaced = removed.removedSheets.length;
          galleryResults = galleryResults.filter(
            (result) => result.targetSheet === lastRevealSheet,
          );
          persistResultGallery();
          renderResultGallery();
          renderChanged([
            ...report.results.map(
              (result) => `${result.kind} - ${result.targetSheet}`,
            ),
            `Removed ${replaced} older VynorAI result sheet(s).`,
          ]);
        }
      } catch (error) {
        log.record("excel:replace-older", "fail", describeError(error));
      }
    }
    document.querySelector<HTMLElement>("#change-note")?.focus();
    // A slow result says where the time went, so a big workbook never looks like a hang.
    const slow = report.results.filter((entry) => (entry.ms ?? 0) >= 4000);
    const seconds = (from: number, to: number) =>
      from && to ? Math.round((to - from) / 1000) : 0;
    const prepareSeconds = seconds(requestStartedAt, previewReadyAt);
    const buildSeconds = seconds(applyStartedAt, Date.now());
    const timing =
      prepareSeconds + buildSeconds >= 8 || slow.length
        ? ` (prepared in ${prepareSeconds}s, built in ${buildSeconds}s${slow.length ? `: ${slow.map((entry) => `${entry.kind} ${((entry.ms ?? 0) / 1000).toFixed(0)}s`).join(", ")}` : ""})`
        : "";
    renderConversation(
      failed.length ? "error" : "assistant",
      failed.length
        ? `Applied ${done.length} of ${report.results.length} planned changes. ${failed
            .map(
              (entry) =>
                `${entry.kind} failed: ${String(entry.error ?? "unknown error").slice(0, 240)}`,
            )
            .join(" ")}`
        : doneSentence(
            report.results,
            report.sourceUnchangedAfterApply,
            textLanguage(),
          ) +
            (replaced ? ` Removed ${replaced} older result sheet(s).` : "") +
            timing,
    );
    setStatus(
      failed.length
        ? `Applied ${done.length} of ${report.results.length} actions. Failed: ${failed.map((result) => result.kind).join(", ")}. See Diagnostics.${auditWarning}`
        : doneSentence(
            report.results,
            report.sourceUnchangedAfterApply,
            textLanguage(),
          ) +
            (replaced ? ` Removed ${replaced} older result sheet(s).` : "") +
            auditWarning,
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
  // The conversation is where a chat reader looks for the answer.
  renderConversation("assistant", text);
}

/** Generated Office Script / VBA: shown as text to copy; the add-in never runs it. */
function showMacro(macro: Extract<MacroResult, { ok: true }>) {
  const list = document.querySelector<HTMLElement>("#insights-list");
  const card = document.querySelector<HTMLElement>("#insights-card");
  if (!list || !card) return;
  list.textContent = "";
  const title = document.createElement("p");
  title.textContent = `${macro.title}: ${macro.steps.join(" ")}`;
  const code = document.createElement("pre");
  code.textContent = macro.code;
  code.style.whiteSpace = "pre-wrap";
  code.style.userSelect = "all";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy code";
  copy.addEventListener("click", () => {
    void navigator.clipboard
      ?.writeText(macro.code)
      .then(() => setStatus("Code copied."))
      .catch(() => setStatus("Select the code and copy it with Ctrl+C."));
  });
  const notes = document.createElement("p");
  notes.className = "muted";
  notes.textContent = macro.notes.join(" ");
  list.append(title, code, copy, notes);
  card.hidden = false;
  card.setAttribute("open", "");
  renderConversation(
    "assistant",
    `${macro.title} is ready below. ${macro.notes.join(" ")}`,
  );
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
      setStatus("Preparing the preview. Nothing changes until you confirm.");
      skipAiOnce = true;
      showInstructionAndPreview();
    });
    insightsActions.appendChild(button);
  }
  insightsCard.hidden = result.insights.length === 0;
  if (result.suggestions.length) hideGenericPills();
}

/** The fixed starter chips are only a fallback; real suggestions come from the data and the request. */
function hideGenericPills() {
  const generic = document.querySelector<HTMLElement>("#starter-suggestions");
  if (generic) generic.hidden = true;
}

/** Puts the AI recommendations in the suggestion row, worded in the person's language. */
function renderAiSuggestions(result: AnalysisResult) {
  if (!insightsCard || !insightsActions) return;
  const usable = result.recommendations
    .map((recommendation) => ({
      recommendation,
      text: recommendationToInstruction(recommendation),
    }))
    .filter((entry) => entry.text);
  if (!usable.length) return;
  insightsActions.textContent = "";
  for (const { recommendation, text } of usable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.textContent = recommendation.title;
    button.title = recommendation.reason;
    button.addEventListener("click", () =>
      useRecommendation(recommendation, text as string),
    );
    insightsActions.appendChild(button);
  }
  insightsCard.hidden = false;
  hideGenericPills();
}

function useRecommendation(
  recommendation: AnalysisResult["recommendations"][number],
  instructionText: string,
) {
  if (instruction) {
    instruction.value = instructionText;
    instruction.dispatchEvent(new Event("input"));
  }
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
  setStatus("Preparing the preview. Nothing changes until you confirm.");
  skipAiOnce = true;
  showInstructionAndPreview();
}

/** A chip is only useful if the person sees what happened: bring the request into view and preview it. */
function showInstructionAndPreview() {
  // The request box sits below the scrolling chat and is always in view: nothing to scroll.
  window.setTimeout(() => inspect?.click(), 50);
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
  output.dataset.workspacePanel = "results";
  output.textContent = "";
  output.classList.add("analysis-card");
  const add = (tag: string, text: string, parent: HTMLElement = output) => {
    const element = document.createElement(tag);
    element.textContent = text; // model text is data, never markup
    parent.appendChild(element);
    return element;
  };
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  add("h3", localizeMessage(language, "Analysis"));
  add("p", result.summary).className = "analysis-summary";
  if (result.columns.length) {
    const section = document.createElement("section");
    section.className = "analysis-section";
    output.appendChild(section);
    add("h3", localizeMessage(language, "Columns"), section);
    for (const column of result.columns)
      add(
        "p",
        `${column.name}: ${column.inferredType}, ${column.role} (${percent(column.confidence)}) - ${column.reason}`,
        section,
      );
  }
  if (result.dataQuality.length) {
    const section = document.createElement("section");
    section.className = "analysis-section";
    output.appendChild(section);
    add("h3", localizeMessage(language, "Data quality"), section);
    for (const issue of result.dataQuality)
      add(
        "p",
        `[${issue.severity}] ${issue.message} (${percent(issue.confidence)})`,
        section,
      );
  }
  const recommendationSection = document.createElement("section");
  recommendationSection.className = "analysis-section";
  output.appendChild(recommendationSection);
  add(
    "h3",
    localizeMessage(language, "Recommendations"),
    recommendationSection,
  );
  if (!result.recommendations.length)
    add(
      "p",
      localizeMessage(language, "No safe recommendation was found."),
      recommendationSection,
    );
  for (const recommendation of result.recommendations) {
    const item = document.createElement("div");
    item.className = "analysis-recommendation";
    recommendationSection.appendChild(item);
    add(
      "p",
      `${recommendation.title} - ${recommendation.kind}${recommendation.chartType ? ` (${recommendation.chartType})` : ""}, ${percent(recommendation.confidence)} - ${recommendation.reason}`,
      item,
    );
    const instructionText = recommendationToInstruction(recommendation);
    if (!instructionText) {
      add(
        "p",
        localizeMessage(
          language,
          "Advice only: no workbook action is available for this.",
        ),
        item,
      );
      continue;
    }
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = localizeMessage(language, "Use this recommendation");
    use.addEventListener("click", () =>
      useRecommendation(recommendation, instructionText),
    );
    item.appendChild(use);
  }
  workspaceNavigation.refresh();
  workspaceNavigation.activate("results");
}

let scriptMode = false;
/** The AI-read request came from "AI reads every request": agreement is the setting itself. */
let autoAi = false;
/** The steps the AI returned run through the reader once without asking the AI again. */
let skipAiOnce = false;

/**
 * What the AI understood is remembered on this device (request text + column names -> the plain steps),
 * so the same request next time needs no AI call. Only sentences are stored, never cell values.
 */
let pendingMemoryKey = "";

/** Steps from the AI planner: plain sentences only; running them goes through the normal preview and approval. */
function renderScript(result: {
  title: string;
  steps: { instruction: string; reason: string }[];
}) {
  if (!analysisOutput) return;
  const output = analysisOutput;
  output.dataset.workspacePanel = "work";
  output.textContent = "";
  output.classList.add("analysis-card");
  const title = document.createElement("h3");
  title.textContent = result.title;
  const list = document.createElement("ol");
  list.className = "analysis-step-list";
  result.steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "analysis-step";
    const number = document.createElement("span");
    number.className = "analysis-step-number";
    number.textContent = String(index + 1);
    const body = document.createElement("div");
    const instructionText = document.createElement("strong");
    instructionText.textContent = step.instruction;
    const reason = document.createElement("span");
    reason.textContent = step.reason;
    body.append(instructionText, reason);
    item.append(number, body);
    list.appendChild(item);
  });
  output.append(title, list);
  const use = document.createElement("button");
  use.type = "button";
  use.textContent = localizeMessage(language, "Use these steps");
  use.addEventListener("click", () => useSteps(result));
  output.appendChild(use);
  workspaceNavigation.refresh();
  workspaceNavigation.activate("work");
}

/** The steps become the instruction and go through the normal preview; nothing changes until Confirm. */
function useSteps(result: { steps: { instruction: string }[] }) {
  if (instruction) {
    instruction.value = result.steps
      .map((step) => step.instruction.replace(/[.;]+$/, ""))
      .join(" then ");
    instruction.dispatchEvent(new Event("input"));
  }
  pendingSpecs = undefined;
  currentPlan = undefined;
  previewFingerprint = "";
  if (apply) apply.disabled = true;
  if (preview) preview.textContent = "No preview yet.";
  log.record("script:use-steps", "pass", { steps: result.steps.length });
  setStatus("Preparing the preview. Nothing changes until you confirm.");
  skipAiOnce = true;
  showInstructionAndPreview();
}

scriptPlan?.addEventListener("click", () => {
  if (!(instruction?.value || "").trim())
    return setStatus("Describe what you want first, then plan the steps.");
  scriptMode = true;
  void startConsent();
});

analyze?.addEventListener("click", () => {
  scriptMode = false;
  void startConsent();
});

async function startConsent() {
  if (!config || !accessToken)
    return setStatus("Sign in before analyzing Excel data.");
  resetAnalysisConsent();
  clearAnalysisOutput();
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
    pendingMemoryKey = memoryKey(
      instruction?.value || "",
      pendingSummary.columns.map((column) => String(column.name)),
    );
    if (consentSummary)
      consentSummary.textContent = JSON.stringify(pendingSummary, null, 2);
    lastSummary = pendingSummary;
    if (scriptMode) {
      // The same request on the same columns was understood before: no AI call is needed.
      const remembered = recallSteps(pendingMemoryKey);
      if (remembered) {
        autoAi = false;
        resetAnalysisConsent();
        renderConversation(
          "assistant",
          localizeMessage(
            language,
            "I remember this request from before, so no AI call was needed.",
          ),
        );
        useSteps({
          steps: remembered.map((instruction) => ({ instruction })),
        });
        return;
      }
    }
    if (consentPanel) {
      consentPanel.hidden = false;
      consentPanel.scrollIntoView?.({ block: "nearest" });
    }
    if (autoAi && consentCheck && consentSend) {
      // "AI reads every request" is on: the setting is the agreement, the summary is still shown above.
      autoAi = false;
      consentCheck.checked = true;
      consentSend.disabled = false;
      setStatus(
        "Asking the AI to read your request (only column names and types are sent)...",
      );
      consentSend.click();
      return;
    }
    setStatus("Review exactly what will be sent, then confirm to continue.");
  } catch (error) {
    pendingSummary = undefined;
    setStatus((error as Error).message);
  }
}

consentCheck?.addEventListener("change", () => {
  if (consentSend)
    consentSend.disabled = !(consentCheck.checked && pendingSummary);
});

consentCancel?.addEventListener("click", () => {
  useBuiltInReader = true;
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
      responseLanguage(instruction?.value || "", language),
      instruction?.value || "",
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
    if (scriptMode) {
      setStatus("Planning…");
      const response = await apiClient().scriptExcel({
        ...request,
        request: request.request || "",
      });
      const planned = response?.result;
      if (
        !planned ||
        typeof planned.title !== "string" ||
        !Array.isArray(planned.steps) ||
        !planned.steps.every(
          (step: any) =>
            step &&
            typeof step.instruction === "string" &&
            typeof step.reason === "string",
        )
      )
        throw new Error("script-invalid");
      log.record("api:script", "pass", { steps: planned.steps.length });
      resetAnalysisConsent();
      if (planned.steps.length === 0) {
        // The AI says this cannot be done: show why, change nothing.
        const reason =
          typeof planned.cannot === "string" && planned.cannot.trim()
            ? planned.cannot.trim().slice(0, 240)
            : "This request cannot be done with the tools available here.";
        renderConversation("assistant", reason);
        setStatus("Nothing was changed.");
        return;
      }
      renderScript(planned);
      // The person already agreed to send the summary; the preview is the next safe step.
      setStatus(
        "The AI understood your request. Preparing the preview; nothing changes until you confirm.",
      );
      rememberSteps(
        pendingMemoryKey,
        planned.steps.map((step: { instruction: string }) => step.instruction),
      );
      useSteps(planned);
      return;
    }
    setStatus("Analyzing the summary...");
    const response = await apiClient().analyzeExcel(request);
    const result = validateAnalysisResult(response?.result, columnCount);
    log.record("api:analysis", "pass", {
      recommendations: result.recommendations.length,
    });
    resetAnalysisConsent();
    renderAnalysis(result);
    renderAiSuggestions(result);
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
      const available = await apiClient().capabilities();
      log.record(
        "self-test:backend:capabilities",
        available.contractVersion === 1 &&
          available.excel.canInspect === report.ready.read &&
          available.excel.canApply === report.ready.write
          ? "pass"
          : "fail",
        {
          actionKinds: available.excel.actionKinds.length,
          writableActionKinds: available.excel.writableActionKinds.length,
          aiAnalysis: available.aiAnalysis,
        },
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
  const advancedWorkbookOptions = document.querySelector<HTMLButtonElement>(
    "#advanced-workbook-options",
  );
  const prefsCard = document.querySelector<HTMLDetailsElement>("#prefs-card");
  const diagnosticsPanel =
    document.querySelector<HTMLElement>("#diagnostics-panel");
  const toggleDiagnostics = document.querySelector<HTMLButtonElement>(
    "#toggle-diagnostics",
  );
  const resultCard = document.querySelector<HTMLElement>("#result-card");
  const previewSummary =
    document.querySelector<HTMLElement>("#preview-summary");
  const previewImpact = document.querySelector<HTMLElement>("#preview-impact");
  const previewWarnings =
    document.querySelector<HTMLElement>("#preview-warnings");

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
      !(event.target as HTMLElement).closest("#status")
    )
      closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  advancedWorkbookOptions?.addEventListener("click", () => {
    if (!prefsCard) return;
    prefsCard.hidden = false;
    prefsCard.open = true;
    closeMenu();
    prefsCard.scrollIntoView({ block: "start" });
    window.setTimeout(() =>
      prefsCard.querySelector<HTMLElement>("select")?.focus(),
    );
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
      "named-range": "named range",
      slicer: "slicer",
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
    if (previewSummary) {
      const columnCount = Number(parsed?.profile?.columnCount ?? 0);
      const from = currentRangeAddress ? ` (${currentRangeAddress})` : "";
      previewSummary.textContent = usingRowsSummary(
        { rows, columns: columnCount, from, warnings },
        textLanguage(),
      );
      if (previewImpact) {
        const impact = [
          [rows, translate(language, "rows_label", "Rows")],
          [columnCount, translate(language, "columns_label", "Columns")],
          [actions.length, translate(language, "changes_label", "Changes")],
          [warnings.length, translate(language, "warnings_label", "Warnings")],
        ];
        previewImpact.replaceChildren(
          ...impact.map(([value, text]) => {
            const item = document.createElement("div");
            item.className = "impact-item";
            const strong = document.createElement("strong");
            strong.textContent = Number(value).toLocaleString("en-US");
            const span = document.createElement("span");
            span.textContent = String(text);
            item.append(strong, span);
            return item;
          }),
        );
        show(previewImpact, true);
      }
      previewWarnings?.replaceChildren(
        ...warnings.map((warning) => {
          const item = document.createElement("li");
          item.textContent = String(warning);
          return item;
        }),
      );
      show(previewWarnings, warnings.length > 0);
      void sheets;
      void label;
    }
    renderPreviewKpis(actions, parsed);
    renderOutcomes(actions);
    configurePreviewTweaks(actions);
    setPreviewBadge(false);
    resultCard.hidden = false;
    workspaceNavigation.refresh();
    workspaceNavigation.activate("results");
  };
  refreshPreviewSummary = renderSummary;
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

const SVG_NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#123a6b", "#d9822b", "#2e8b57", "#8e44ad"];

function drawChart(chart: OutcomeChart): SVGElement {
  const width = 300;
  const height = 150;
  const pad = 18;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const all = chart.series.flatMap((entry) => entry.values);
  const min = Math.min(0, ...all);
  const max = Math.max(1, ...all);
  const range = Math.max(1, max - min);
  const count = Math.max(1, chart.categories.length);
  const step = (width - pad * 2) / count;
  const add = (name: string, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    svg.appendChild(node);
    return node;
  };
  const y = (value: number) =>
    height - pad - ((value - min) / range) * (height - pad * 2);
  add("line", {
    x1: String(pad),
    y1: String(y(0)),
    x2: String(width - pad),
    y2: String(y(0)),
    stroke: "#9aa5b5",
  });

  const type = String(chart.type || "column").toLowerCase();
  const drawLineSeries = (
    entry: OutcomeChart["series"][number],
    index: number,
  ) => {
    const points = entry.values
      .map((value, at) => `${pad + step * (at + 0.5)},${y(value)}`)
      .join(" ");
    add("polyline", {
      points,
      fill: "none",
      stroke: PALETTE[index % PALETTE.length],
      "stroke-width": "2",
    });
  };
  const drawColumns = (stacked: boolean, firstOnly = false) => {
    chart.categories.forEach((_, at) => {
      let stack = 0;
      chart.series.forEach((entry, index) => {
        if (firstOnly && index > 0) return;
        const value = Number(entry.values[at] ?? 0);
        const start = stacked ? stack : 0;
        const end = start + value;
        stack = stacked ? end : stack;
        add("rect", {
          x: String(
            stacked
              ? pad + step * at + step * 0.1
              : pad +
                  step * at +
                  step * 0.1 +
                  ((step * 0.8) / chart.series.length) * index,
          ),
          y: String(y(Math.max(start, end))),
          width: String(
            stacked ? step * 0.8 : (step * 0.8) / chart.series.length,
          ),
          height: String(Math.max(1, Math.abs(y(end) - y(start)))),
          fill: PALETTE[index % PALETTE.length],
        });
      });
    });
  };
  const drawHorizontalBars = () => {
    const series = chart.series[0];
    if (!series) return;
    const rowHeight = (height - pad * 2) / Math.max(1, series.values.length);
    const horizontalMax = Math.max(
      1,
      ...series.values.map((value) => Math.abs(value)),
    );
    series.values.forEach((value, at) => {
      const bar = (Math.abs(value) / horizontalMax) * (width - pad * 2);
      add("rect", {
        x: String(value < 0 ? pad + (width - pad * 2) - bar : pad),
        y: String(pad + rowHeight * at + rowHeight * 0.12),
        width: String(Math.max(1, bar)),
        height: String(Math.max(1, rowHeight * 0.76)),
        fill: PALETTE[0],
      });
    });
  };
  const drawStackedHorizontalBars = () => {
    const rowHeight = (height - pad * 2) / Math.max(1, chart.categories.length);
    chart.categories.forEach((_, at) => {
      const total = Math.max(
        1,
        chart.series.reduce(
          (sum, entry) => sum + Math.max(0, Number(entry.values[at] ?? 0)),
          0,
        ),
      );
      let offset = 0;
      chart.series.forEach((entry, index) => {
        const value = Math.max(0, Number(entry.values[at] ?? 0));
        const segmentWidth = (value / total) * (width - pad * 2);
        add("rect", {
          x: String(pad + offset),
          y: String(pad + rowHeight * at + rowHeight * 0.12),
          width: String(Math.max(1, segmentWidth)),
          height: String(Math.max(1, rowHeight * 0.76)),
          fill: PALETTE[index % PALETTE.length],
        });
        offset += segmentWidth;
      });
    });
  };
  const drawHistogram = () => {
    const values = chart.series[0]?.values ?? [];
    if (!values.length) return;
    const lower = Math.min(...values);
    const upper = Math.max(...values);
    const binCount = Math.max(
      3,
      Math.min(8, Math.ceil(Math.sqrt(values.length))),
    );
    const span = Math.max(1, upper - lower);
    const counts = Array.from({ length: binCount }, () => 0);
    values.forEach((value) => {
      const bin = Math.min(
        binCount - 1,
        Math.floor(((value - lower) / span) * binCount),
      );
      counts[bin] += 1;
    });
    const peak = Math.max(1, ...counts);
    counts.forEach((count, at) => {
      const barWidth = ((width - pad * 2) / binCount) * 0.82;
      const x = pad + ((width - pad * 2) / binCount) * at + barWidth * 0.1;
      const top = height - pad - (count / peak) * (height - pad * 2);
      add("rect", {
        x: String(x),
        y: String(top),
        width: String(barWidth),
        height: String(Math.max(1, height - pad - top)),
        fill: PALETTE[0],
      });
    });
  };
  if (type === "line") chart.series.forEach(drawLineSeries);
  else if (type === "area") {
    chart.series.forEach((entry, index) => {
      const points = entry.values
        .map((value, at) => `${pad + step * (at + 0.5)},${y(value)}`)
        .join(" ");
      const first = `${pad + step * 0.5},${y(0)}`;
      const last = `${pad + step * (entry.values.length - 0.5)},${y(0)}`;
      add("polygon", {
        points: `${first} ${points} ${last}`,
        fill: PALETTE[index % PALETTE.length],
        opacity: "0.2",
      });
      drawLineSeries(entry, index);
    });
  } else if (type === "bar") drawHorizontalBars();
  else if (type === "combo") {
    drawColumns(false, true);
    chart.series.slice(1).forEach(drawLineSeries);
  } else if (type === "stacked-column") drawColumns(true);
  else if (type === "stacked-bar") drawStackedHorizontalBars();
  else if (type === "histogram") drawHistogram();
  else if (type === "waterfall") {
    const series = chart.series[0];
    let running = 0;
    series?.values.forEach((value, at) => {
      const next = running + Number(value || 0);
      add("rect", {
        x: String(pad + step * at + step * 0.1),
        y: String(y(Math.max(running, next))),
        width: String(step * 0.8),
        height: String(Math.max(1, Math.abs(y(next) - y(running)))),
        fill: next >= running ? "#2e8b57" : "#c94c4c",
      });
      running = next;
    });
  } else if (type === "pie") {
    const series = chart.series[0];
    const values = series?.values.map((value) => Math.max(0, value)) ?? [];
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const cx = width / 2;
    const cy = (height - 6) / 2;
    const radius = Math.min(cx - pad, cy - pad / 2);
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      const nextAngle = angle + (value / total) * Math.PI * 2;
      const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
      const startX = cx + radius * Math.cos(angle);
      const startY = cy + radius * Math.sin(angle);
      const endX = cx + radius * Math.cos(nextAngle);
      const endY = cy + radius * Math.sin(nextAngle);
      add("path", {
        d: `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`,
        fill: PALETTE[index % PALETTE.length],
      });
      angle = nextAngle;
    });
  } else drawColumns(false);
  if (chart.showDataLabels && type !== "pie" && type !== "histogram") {
    chart.series.forEach((entry, index) =>
      entry.values.forEach((value, at) => {
        const text = add("text", {
          x: String(
            type === "bar" || type === "stacked-bar"
              ? pad +
                  Math.max(
                    2,
                    (Math.abs(value) / Math.max(1, max)) * (width - pad * 2),
                  )
              : pad + step * (at + 0.5),
          ),
          y: String(
            type === "bar" || type === "stacked-bar"
              ? pad +
                  ((height - pad * 2) / Math.max(1, chart.categories.length)) *
                    at +
                  10
              : Math.max(10, y(value) - 4),
          ),
          "text-anchor":
            type === "bar" || type === "stacked-bar" ? "start" : "middle",
          "font-size": "7",
          fill: "#374151",
        });
        text.textContent = Number(value).toLocaleString("en-US");
        void index;
      }),
    );
  }
  chart.categories.forEach((name, at) => {
    const label = add("text", {
      x: String(pad + step * (at + 0.5)),
      y: String(height - 4),
      "text-anchor": "middle",
      "font-size": "8",
      fill: "#4b5563",
    });
    label.textContent = name.slice(0, 6);
  });
  return svg;
}

/** Key figures (total, top group, rows; or checked, clean, to review) from the plan and the real data. */
function renderPreviewKpis(actions: any[], parsed: any) {
  const container = document.querySelector<HTMLElement>("#preview-kpis");
  if (!container) return;
  container.textContent = "";
  const tiles = lastRange
    ? buildPreviewKpis({
        actions,
        headers: lastRange.headers,
        rows: lastRange.rows,
        sample: parsed?.profile?.sample ?? lastSample,
        normalized: Boolean(parsed?.normalization),
        tr: (text) => localizeMessage(textLanguage(), text),
      })
    : [];
  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = tile.warn ? "kpi warn" : "kpi";
    if (tile.title) box.title = tile.title;
    const label = document.createElement("small");
    label.textContent = tile.label;
    const value = document.createElement("strong");
    value.textContent = tile.value;
    box.append(label, value);
    if (tile.sub) {
      const sub = document.createElement("span");
      sub.textContent = tile.sub;
      box.append(sub);
    }
    container.append(box);
  }
  container.hidden = tiles.length === 0;
}

/** The first thing a person sees: what will exist afterwards, drawn from their own data. */
function renderOutcomes(actions: any[]) {
  const container = document.querySelector<HTMLElement>("#outcomes");
  if (!container) return;
  container.textContent = "";
  if (!lastRange) return;
  for (const outcome of buildOutcomes(
    actions,
    lastRange.headers,
    lastRange.rows,
    textLanguage(),
  )) {
    const box = document.createElement("div");
    box.className = "outcome";
    const title = document.createElement("strong");
    title.textContent = outcome.title;
    const where = document.createElement("div");
    where.className = "where";
    where.textContent = willBeCreatedOn(outcome.where, textLanguage());
    box.appendChild(title);
    box.appendChild(where);
    if (outcome.chart) {
      box.appendChild(drawChart(outcome.chart));
      const legend = document.createElement("div");
      legend.className = "legend";
      legend.textContent = outcome.chart.series
        .map(
          (entry, index) => `${["■", "▲", "●", "◆"][index % 4]} ${entry.name}`,
        )
        .join("   ");
      box.appendChild(legend);
    } else if (outcome.table) {
      const table = document.createElement("table");
      const head = table.insertRow();
      outcome.table.headers.forEach((name, index) => {
        const th = document.createElement("th");
        th.textContent = outcome.table!.dropdownColumns.includes(index)
          ? `${name} ▾`
          : name;
        head.appendChild(th);
      });
      // A total over a sample is not the real total: leave it out and say so below.
      const shownRows = lastSample
        ? outcome.table.rows.filter(
            (row) => row[0] !== "Grand total" && row[0] !== "මුළු එකතුව",
          )
        : outcome.table.rows;
      for (const row of shownRows) {
        const tr = table.insertRow();
        row.forEach((value, index) => {
          const td = tr.insertCell();
          td.textContent = value;
          const bar = outcome.table!.barColumns.find(
            (entry) => entry.index === index,
          );
          if (bar) {
            const share = Math.min(1, Math.max(0, Number(value) / bar.max));
            td.style.background = `linear-gradient(to right, #9ec5f0 ${Math.round(share * 100)}%, transparent ${Math.round(share * 100)}%)`;
          }
        });
      }
      box.appendChild(table);
      if (lastSample) {
        const note = document.createElement("div");
        note.className = "legend";
        note.textContent = samplePreviewNote(
          lastSample.sampledRows,
          lastSample.totalRows,
          textLanguage(),
        );
        box.appendChild(note);
      }
    }
    if (outcome.details.length) {
      const list = document.createElement("ul");
      list.className = "details";
      for (const line of outcome.details) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
      box.appendChild(list);
    }
    container.appendChild(box);
  }
  void refreshSheetNames(container, actions);
}

/**
 * Keep the visible, unconfirmed preview aligned with a tweak while the same
 * request is being checked again by the local and server planners. This never
 * changes the workbook and the apply button remains disabled until that check
 * succeeds.
 */
function renderPendingPreviewSpecs(specs: ExcelColumnSpecs) {
  if (!preview) return;
  let parsed: any;
  try {
    parsed = JSON.parse(preview.textContent || "");
  } catch {
    return;
  }
  if (!Array.isArray(parsed?.actions)) return;
  const actions = parsed.actions.map((action: any) => {
    if (action.kind === "chart" && specs.chart)
      return {
        ...action,
        spec: {
          ...(action.spec ?? {}),
          categoryIndex: specs.chart.category,
          valueIndex: specs.chart.value,
          chartType: specs.chart.chartType,
          ...(specs.chart.showDataLabels
            ? { showDataLabels: true }
            : { showDataLabels: undefined }),
          aggregation: specs.chart.aggregation,
          topN: specs.chart.topN,
          lowest: specs.chart.lowest,
        },
      };
    if (action.kind === "pivot-table" && specs.pivot)
      return {
        ...action,
        spec: {
          ...(action.spec ?? {}),
          rows: specs.pivot.rows,
          values: specs.pivot.values,
          aggregation: specs.pivot.aggregation,
          topN: specs.pivot.topN,
          lowest: specs.pivot.lowest,
        },
      };
    return action;
  });
  preview.textContent = JSON.stringify({ ...parsed, actions }, null, 2);
  refreshPreviewSummary?.();
}

function restoreConfirmedPreview() {
  if (!preview || !confirmedPreviewText) return;
  previewSpecs = confirmedPreviewSpecs
    ? (JSON.parse(JSON.stringify(confirmedPreviewSpecs)) as ExcelColumnSpecs)
    : undefined;
  preview.textContent = confirmedPreviewText;
  refreshPreviewSummary?.();
}

type TweakSelect = HTMLSelectElement | null;
const tweakChartType =
  document.querySelector<HTMLSelectElement>("#tweak-chart-type");
const tweakAggregation =
  document.querySelector<HTMLSelectElement>("#tweak-aggregation");
const tweakCategory =
  document.querySelector<HTMLSelectElement>("#tweak-category");
const tweakValue = document.querySelector<HTMLSelectElement>("#tweak-value");
const tweakTopN = document.querySelector<HTMLSelectElement>("#tweak-top-n");
const tweakRankDirection = document.querySelector<HTMLSelectElement>(
  "#tweak-rank-direction",
);
const tweakDataLabels =
  document.querySelector<HTMLInputElement>("#tweak-data-labels");
const tweakTotals = document.querySelector<HTMLInputElement>("#tweak-totals");

function setTweakOptions(
  select: TweakSelect,
  choices: Array<{ value: string; label: string }>,
  selected?: number | string,
) {
  if (!select) return;
  select.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    option.selected = String(selected ?? "") === choice.value;
    select.appendChild(option);
  }
}

/** Small, deterministic adjustments. Each selection re-runs the existing client/server planner. */
function configurePreviewTweaks(actions: any[]) {
  const panel = document.querySelector<HTMLElement>("#preview-tweaks");
  if (!panel || !lastRange) return;
  const hasChart = actions.some((action) => action.kind === "chart");
  const hasPivot = actions.some((action) => action.kind === "pivot-table");
  // Summarize by, Top-N and sort order: a PivotTable, or a chart that groups its own rows.
  const canGroupRows = canGroup(previewSpecs);
  const grouping = readGrouping(previewSpecs);
  const supportsTotals = Boolean(previewSpecs?.summary || previewSpecs?.format);
  panel.hidden = !hasChart && !hasPivot && !supportsTotals;
  if (panel.hidden) return;
  const columns = lastRange.headers.map((header, index) => ({
    value: String(index),
    label: header,
  }));
  const chart = previewSpecs?.chart;
  const pivot = previewSpecs?.pivot;
  const chartTypes = [
    ["column", "Column"],
    ["bar", "Bar"],
    ["line", "Line"],
    ["pie", "Pie"],
    ["area", "Area"],
    ["combo", "Combo"],
    ["histogram", "Histogram"],
    ["waterfall", "Waterfall"],
    ["stacked-column", "Stacked column"],
    ["stacked-bar", "Stacked bar"],
  ].map(([value, label]) => ({ value, label }));
  setTweakOptions(tweakChartType, chartTypes, chart?.chartType ?? "column");
  setTweakOptions(
    tweakAggregation,
    ["sum", "count", "average", "min", "max"].map((value) => ({
      value,
      label: value[0].toUpperCase() + value.slice(1),
    })),
    grouping?.aggregation ?? "sum",
  );
  setTweakOptions(tweakCategory, columns, chart?.category ?? pivot?.rows ?? 0);
  setTweakOptions(tweakValue, columns, chart?.value ?? pivot?.values ?? 0);
  if (tweakChartType) tweakChartType.closest("label")!.hidden = !hasChart;
  if (tweakAggregation)
    tweakAggregation.closest("label")!.hidden = !canGroupRows;
  if (tweakCategory)
    tweakCategory.closest("label")!.hidden = !hasChart && !hasPivot;
  if (tweakValue) tweakValue.closest("label")!.hidden = !hasChart && !hasPivot;
  if (tweakTopN) {
    tweakTopN.closest("label")!.hidden = !canGroupRows;
    tweakTopN.value = grouping?.topN ? String(grouping.topN) : "";
  }
  if (tweakRankDirection) {
    tweakRankDirection.closest("label")!.hidden = !canGroupRows;
    tweakRankDirection.value = grouping?.lowest ? "bottom" : "top";
  }
  if (tweakDataLabels) {
    tweakDataLabels.closest("label")!.hidden = !hasChart;
    tweakDataLabels.checked = chart?.showDataLabels === true;
  }
  if (tweakTotals) {
    tweakTotals.closest("label")!.hidden = !supportsTotals;
    tweakTotals.checked = Boolean(
      previewSpecs?.summary?.total || previewSpecs?.format?.totalRow,
    );
  }
}

function replanWithTweak(update: (specs: ExcelColumnSpecs) => void) {
  // Only a live, unapplied preview can be adjusted; never re-plan after an apply.
  // currentPlan is intentionally cleared as soon as a re-plan starts. Do not
  // reject a second tweak made while the first one is still being checked.
  if (!previewSpecs || !preview || !previewFingerprint) return;
  const next: ExcelColumnSpecs = {
    ...previewSpecs,
    ...(previewSpecs?.chart ? { chart: { ...previewSpecs.chart } } : {}),
    ...(previewSpecs?.pivot ? { pivot: { ...previewSpecs.pivot } } : {}),
    ...(previewSpecs?.summary ? { summary: { ...previewSpecs.summary } } : {}),
    ...(previewSpecs?.format ? { format: { ...previewSpecs.format } } : {}),
  };
  previewSpecs = next;
  update(next);
  pendingSpecs = next;
  if (apply) apply.disabled = true;
  renderPendingPreviewSpecs(next);
  setStatus("Preview adjusted. Rechecking the plan...");
  void inspect?.click();
}

tweakChartType?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  if (!tweakChartType.value) return;
  replanWithTweak((specs) => {
    if (specs.chart) {
      specs.chart.chartType = tweakChartType.value as NonNullable<
        ExcelColumnSpecs["chart"]
      >["chartType"];
      normalizeChartGrouping(specs);
    }
  });
});
tweakAggregation?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  if (!tweakAggregation.value) return;
  replanWithTweak((specs) => {
    changeGrouping(specs, {
      aggregation: tweakAggregation.value as NonNullable<
        ExcelColumnSpecs["pivot"]
      >["aggregation"],
    });
  });
});
tweakCategory?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    const column = Number(tweakCategory.value);
    if (specs.chart) specs.chart.category = column;
    else if (specs.pivot) specs.pivot.rows = column;
  });
});
tweakValue?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    const column = Number(tweakValue.value);
    if (specs.chart) specs.chart.value = column;
    else if (specs.pivot) specs.pivot.values = column;
  });
});
tweakTopN?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    const value = Number(tweakTopN.value);
    changeGrouping(specs, {
      topN: Number.isInteger(value) && value > 0 ? value : null,
    });
  });
});
tweakRankDirection?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    changeGrouping(specs, { lowest: tweakRankDirection.value === "bottom" });
  });
});
tweakDataLabels?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    if (specs.chart) specs.chart.showDataLabels = tweakDataLabels.checked;
  });
});
tweakTotals?.addEventListener("change", (event) => {
  if (!event.isTrusted) return;
  replanWithTweak((specs) => {
    if (specs.summary) specs.summary.total = tweakTotals.checked;
    if (specs.format) specs.format.totalRow = tweakTotals.checked;
  });
});

/** The preview shows the sheet name the apply will really use (a repeat run gets "(2)"). */
async function refreshSheetNames(container: HTMLElement, actions: any[]) {
  if (!lastRange) return;
  const existing = new Set(await listWorksheetNames(officeRuntime()));
  if (!existing.size) return;
  const source = currentSourceSheet;
  const taken = new Set(existing);
  const labels = container.querySelectorAll<HTMLElement>(".outcome .where");
  const seen = new Map<string, string>();
  actions.forEach((action, index) => {
    const name = String(action.targetSheet ?? "");
    let resolved = seen.get(name);
    if (!resolved) {
      resolved = plannedSheetName(action, source, taken);
      taken.add(resolved);
      seen.set(name, resolved);
    }
    const label = labels[index];
    if (label) label.textContent = willBeCreatedOn(resolved, textLanguage());
  });
}

async function replaceOlderResultSheets(keepSheet: string) {
  if (!config || !accessToken) return;
  if (
    !(await askInPane(
      localizeMessage(
        language,
        "Remove older VynorAI result sheets and keep this result? Your original data is not touched.",
      ),
      localizeMessage(language, "Replace"),
    ))
  )
    return log.record("gallery:replace", "skip", "user cancelled");
  try {
    const older = (await listVynorSheets(officeRuntime())).filter(
      (sheet) => sheet !== keepSheet,
    );
    if (!older.length)
      return setStatus("No older VynorAI result sheets found.");
    const removed = await rollbackCreatedItems(
      officeRuntime(),
      { sheets: older, tables: [] },
      true,
    );
    await apiClient()
      .reportRollback({
        planId: galleryPlanId,
        removedSheets: Math.min(10, removed.removedSheets.length),
        convertedTables: 0,
        removedNames: 0,
      })
      .catch((error) =>
        log.record("api:gallery-replace", "fail", describeError(error)),
      );
    galleryResults = galleryResults.filter(
      (result) => result.targetSheet === keepSheet,
    );
    persistResultGallery();
    renderResultGallery();
    renderChanged([
      ...galleryResults.map(
        (result) => `${result.kind} - ${result.targetSheet}`,
      ),
      `Removed ${removed.removedSheets.length} older VynorAI result sheet(s).`,
    ]);
    setStatus(`Removed ${removed.removedSheets.length} older result sheet(s).`);
    log.record("gallery:replace", "pass", {
      removedSheets: removed.removedSheets.length,
    });
  } catch (error) {
    handleApiError("gallery:replace", error);
  }
}

function renderResultGallery() {
  const gallery = document.querySelector<HTMLElement>("#result-gallery");
  const list = document.querySelector<HTMLElement>("#result-gallery-list");
  const verifiedBanner = document.querySelector<HTMLElement>(
    "#verified-result-banner",
  );
  if (!gallery || !list) return;
  list.replaceChildren();
  const visible = galleryResults.filter(
    (result) => result.status === "created" || result.status === "exists",
  );
  gallery.hidden = visible.length === 0;
  if (verifiedBanner) verifiedBanner.hidden = visible.length === 0;
  // The safety note is for the first preview; once a result exists the person has seen it.
  const safetySummary = document.querySelector<HTMLElement>(".safety-summary");
  if (safetySummary) safetySummary.hidden = visible.length > 0;
  for (const result of visible) {
    const item = document.createElement("article");
    item.className = "result-item";
    const head = document.createElement("div");
    head.className = "result-item-head";
    const title = document.createElement("strong");
    title.textContent = kindTitle(result.kind, textLanguage());
    const target = document.createElement("span");
    target.className = "verified-badge";
    target.textContent = `Verified · ${result.targetSheet}`;
    head.append(title, target);
    const actions = document.createElement("div");
    actions.className = "result-item-actions";
    const show = document.createElement("button");
    show.type = "button";
    show.textContent = translate(language, "show_result", "Show result");
    show.addEventListener("click", () => {
      void revealExcelResult(officeRuntime(), result.targetSheet);
    });
    actions.appendChild(show);
    const evidence = document.createElement("details");
    evidence.className = "result-evidence";
    const evidenceSummary = document.createElement("summary");
    evidenceSummary.textContent = "Show evidence";
    const evidenceList = document.createElement("ul");
    const evidenceLines = [
      `Result read back from sheet ${result.targetSheet}`,
      currentRangeAddress
        ? `Source: ${currentRangeAddress}`
        : "Source recorded in the applied plan",
      `${kindTitle(result.kind, language)} completed with status ${result.status}`,
      ...(result.notes ?? []),
      ...(result.warnings ?? []).map((warning) => `Warning: ${warning}`),
    ];
    for (const line of evidenceLines) {
      const row = document.createElement("li");
      row.textContent = line;
      evidenceList.appendChild(row);
    }
    evidence.append(evidenceSummary, evidenceList);
    const share = document.createElement("button");
    share.type = "button";
    share.textContent = translate(language, "email_report", "Email report");
    share.addEventListener("click", () => prepareEmailComposer());
    actions.appendChild(share);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = translate(language, "refresh_result", "Refresh");
    refresh.disabled = !instruction?.value.trim();
    refresh.title = refresh.disabled
      ? "Enter the original request again to refresh this result."
      : "Create a fresh preview from the current request.";
    refresh.addEventListener("click", () => {
      if (!instruction?.value.trim()) {
        setStatus("Enter the request again before refreshing this result.");
        return;
      }
      currentPlan = undefined;
      previewFingerprint = "";
      pendingSpecs = undefined;
      excludedKinds = new Set<string>();
      setStatus("Refreshing the preview. Nothing changes until you confirm.");
      instruction.focus();
      void inspect?.click();
    });
    actions.appendChild(refresh);
    if (result.status === "created") {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.textContent = translate(language, "undo", "Undo");
      undo.addEventListener("click", async () => {
        const sameSheet = galleryResults.filter(
          (candidate) =>
            candidate.targetSheet === result.targetSheet &&
            candidate.status === "created",
        );
        if (
          !(await askInPane(
            localizeMessage(
              language,
              "Remove this VynorAI result? Your original data is not touched.",
            ),
            localizeMessage(language, "Remove"),
          ))
        )
          return;
        try {
          const removed = await rollbackCreatedItems(
            officeRuntime(),
            rollbackItemsFromApplyReport(galleryPlanId, sameSheet),
            true,
          );
          await apiClient()
            .reportRollback({
              planId: galleryPlanId,
              removedSheets: Math.min(10, removed.removedSheets.length),
              convertedTables: Math.min(1, removed.convertedTables.length),
              removedNames: Math.min(10, removed.removedNames.length),
            })
            .catch((error) =>
              log.record("api:gallery-undo", "fail", describeError(error)),
            );
          galleryResults = galleryResults.filter(
            (candidate) => candidate.targetSheet !== result.targetSheet,
          );
          persistResultGallery();
          lastCreated = rollbackItemsFromApplyReport(
            galleryPlanId,
            galleryResults.filter(
              (candidate) => candidate.status === "created",
            ),
          );
          renderResultGallery();
          markChangeNote("undone");
          setStatus(`Removed ${removed.removedSheets.length} result sheet(s).`);
        } catch (error) {
          handleApiError("gallery:undo", error);
        }
      });
      actions.appendChild(undo);
    }
    const replace = document.createElement("button");
    replace.type = "button";
    replace.textContent = translate(language, "cleanup", "Replace older");
    replace.addEventListener("click", () => {
      void replaceOlderResultSheets(result.targetSheet);
    });
    actions.appendChild(replace);
    item.append(head, actions, evidence);
    list.appendChild(item);
  }
}

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
      document.createTextNode(
        ` ${localizeMessage(language, kind)}${target ? ` → ${target}` : ""}`,
      ),
    );
    stepsContainer.appendChild(row);
  }
}

document.querySelector("#show-result")?.addEventListener("click", () => {
  if (lastRevealSheet) void revealExcelResult(officeRuntime(), lastRevealSheet);
});

rollbackButton?.addEventListener("click", async () => {
  if (!lastCreated || !config || !accessToken) return;
  const items = lastCreated;
  if (
    !(await askInPane(
      localizeMessage(
        language,
        "Remove the result sheets and Table this add-in created? Your original data is not touched.",
      ),
      localizeMessage(language, "Remove"),
      undefined,
      removeResultsCard(items, language),
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
        removedNames: Math.min(10, report.removedNames.length),
      })
      .catch((error) =>
        log.record("api:rollback", "fail", describeError(error)),
      );
    lastCreated = undefined;
    galleryPlanId = "";
    galleryResults = [];
    persistResultGallery();
    renderResultGallery();
    if (rollbackButton) rollbackButton.hidden = true;
    updateEmailUi();
    markChangeNote("undone");
    await logChanges({
      at: new Date(),
      action: "undone",
      request: lastConversationRequest,
      changes: report.removedSheets.map((sheet) => ({
        change: "removed result sheet",
        sheet,
        status: "undone",
      })),
      reference: items.planId,
    });
    // The "changed" list names sheets that no longer exist; clear it with the rest of the result.
    renderChanged([]);
    setStatus(
      `Removed ${report.removedSheets.length} sheet(s), ${report.removedNames.length} named range(s), and converted ${report.convertedTables.length} table(s) back to a range.`,
    );
  } catch (error) {
    handleApiError("rollback", error);
  }
});

document.querySelector("#more-pills")?.addEventListener("click", (event) => {
  document
    .querySelectorAll<HTMLElement>(".pill.extra")
    .forEach((pill) => pill.removeAttribute("hidden"));
  (event.currentTarget as HTMLElement).setAttribute("hidden", "");
});

// Developer tools (technical details, diagnostics, self-test) only show with ?dev=1 or after
// localStorage "vynor.dev" = "1"; normal users never see them.
try {
  if (
    new URLSearchParams(window.location.search).get("dev") === "1" ||
    localStorage.getItem("vynor.dev") === "1"
  )
    document.body.setAttribute("data-dev", "");
} catch {
  // Left hidden.
}

// The apply bar sticks just above the composer, whatever height the composer has.
try {
  const composerBox = document.querySelector<HTMLElement>(".composer");
  if (composerBox && typeof ResizeObserver !== "undefined")
    new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--composer-h",
        `${composerBox.offsetHeight + 4}px`,
      ),
    ).observe(composerBox);
} catch {
  // Falls back to the default offset.
}

const reviewToggle = document.querySelector<HTMLInputElement>("#review-toggle");
try {
  if (reviewToggle && localStorage.getItem("vynor.review") === "off")
    reviewToggle.checked = false;
} catch {
  // Storage can be blocked; the default stays on.
}
reviewToggle?.addEventListener("change", () => {
  try {
    localStorage.setItem("vynor.review", reviewToggle.checked ? "on" : "off");
  } catch {
    // Not persisted.
  }
});

function renderTrace(lines: string[]) {
  const box = document.querySelector<HTMLElement>("#plan-trace");
  const list = document.querySelector<HTMLElement>("#trace-list");
  const count = document.querySelector<HTMLElement>("#trace-n");
  if (!box || !list || !count) return;
  list.textContent = "";
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  }
  count.textContent = String(lines.length);
  box.hidden = false;
}

function renderChanged(lines: string[]) {
  const list = document.querySelector<HTMLElement>("#changed-list");
  if (!list) return;
  list.textContent = "";
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  }
  list.hidden = lines.length === 0;
}

const cleanupButton = document.querySelector<HTMLButtonElement>("#cleanup");
cleanupButton?.addEventListener("click", async () => {
  const mine = await listVynorSheets(officeRuntime());
  const older = mine.filter((name) => name !== lastRevealSheet);
  if (!older.length)
    return setStatus("There are no older VynorAI result sheets.");
  if (
    !(await askInPane(
      `Remove ${older.length} older VynorAI result sheet(s)? The latest result and your original data stay.`,
      "Remove",
      undefined,
      removeResultsCard({ sheets: older }, textLanguage(), lastRevealSheet),
    ))
  )
    return;
  try {
    const report = await rollbackCreatedItems(
      officeRuntime(),
      { sheets: older, tables: [] },
      true,
    );
    setStatus(`Removed ${report.removedSheets.length} older result sheet(s).`);
  } catch (error) {
    handleApiError("cleanup", error);
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

/** Buttons whose text the code writes (toggles) redraw themselves when the language changes. */
const languageHooks: Array<() => void> = [];
function refreshLanguage() {
  applyLanguage(document, language);
  for (const hook of languageHooks) hook();
  renderConversationHistory();
  renderResultGallery();
  const previewNode = document.querySelector<HTMLElement>("#preview");
  if (previewNode && previewNode.textContent?.startsWith("{"))
    previewNode.textContent = previewNode.textContent;
  if (lastStatus) setStatus(lastStatus);
  if (languageButton)
    languageButton.textContent = `${translateLabel()}: ${LANGUAGE_NAMES[language]}`;
}
function translateLabel(): string {
  return language === "si" ? "භාෂාව" : language === "ta" ? "மொழி" : "Language";
}
const aiFirstButton = document.querySelector<HTMLButtonElement>("#ai-first");
const showAiFirst = () => {
  if (aiFirstButton)
    aiFirstButton.textContent = aiFirstOn()
      ? localizeMessage(
          language,
          "AI reads every request: ON (click to turn off)",
        )
      : localizeMessage(
          language,
          "AI reads every request: OFF (click to turn on)",
        );
};
showAiFirst();
languageHooks.push(showAiFirst);
aiFirstButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  setAiFirst(!aiFirstOn());
  showAiFirst();
  setStatus(
    aiFirstOn()
      ? "AI mode is on: each request sends only column names and types to the AI, which turns it into plain steps. You still preview and confirm everything. Turn it off here any time."
      : "AI mode is off: requests are read on this device first; the AI is used only when it cannot read one.",
  );
});
languageButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  language = nextLanguage(language);
  saveLanguage(language);
  // Choosing a language in the pane is the person's answer for everything that follows.
  requestLanguage = undefined;
  refreshLanguage();
});
refreshLanguage();

const selectionChip = document.querySelector<HTMLElement>("#selection-chip");
const selectionText = document.querySelector<HTMLElement>("#selection-text");
const workbookContext =
  document.querySelector<HTMLElement>("#workbook-context");
const contextSelection =
  document.querySelector<HTMLElement>("#context-selection");
const contextBadges = document.querySelector<HTMLElement>("#context-badges");
const contextSuggestions = document.querySelector<HTMLElement>(
  "#context-suggestions",
);
const contextSuggestionList = document.querySelector<HTMLElement>(
  "#context-suggestion-list",
);
const selectionChangeWarning = document.querySelector<HTMLElement>(
  "#selection-change-warning",
);
let selectionTimer: ReturnType<typeof setTimeout> | undefined;
/** The size line of the selection ("41 rows x 9 columns") with its words in the pane's language. */
function describeSelectionLocal(info: WorkspaceSelection | undefined): string {
  return describeSelection(info, {
    cell: translate(language, "cell_label", "cell"),
    row: translate(language, "row_label", "row"),
    rows: translate(language, "rows_label", "rows"),
    column: translate(language, "column_label", "column"),
    columns: translate(language, "columns_label", "columns"),
  });
}
let shownSelection: WorkspaceSelection | undefined;
languageHooks.push(() => {
  if (!shownSelection) return;
  if (selectionText)
    selectionText.textContent = describeSelectionLocal(shownSelection);
  if (contextSelection)
    contextSelection.textContent = describeSelectionLocal(shownSelection);
});

function renderWorkspaceContext(
  info: WorkspaceSelection | undefined,
  schema?: WorkspaceSchema,
) {
  renderExplore(info, schema);
  if (!info) {
    show(workbookContext, false);
    show(contextSuggestions, false);
    show(
      document.querySelector<HTMLElement>("#starter-suggestions"),
      conversationMessages.length === 0,
    );
    return;
  }
  const description = describeSelectionLocal(info);
  if (contextSelection) contextSelection.textContent = description;
  const badgeLabels = [
    ...selectionBadges(info, {
      row: translate(language, "row_label", "row"),
      rows: translate(language, "rows_label", "rows"),
      column: translate(language, "column_label", "column"),
      columns: translate(language, "columns_label", "columns"),
      largeRange: translate(language, "large_range", "Large range"),
      localPreview: translate(language, "local_preview", "Local preview"),
    }),
    officePlatformLabel,
    "Original data preserved",
  ];
  contextBadges?.replaceChildren(
    ...badgeLabels.map((text) => {
      const badge = document.createElement("span");
      badge.className = `context-badge${text === "Original data preserved" ? " safe" : ""}`;
      badge.textContent = text;
      return badge;
    }),
  );
  const suggestions = suggestionsForSelection(info, schema);
  const suggestionIcons: Record<string, string> = {
    chart: "▥",
    pivot: "▦",
    dashboard: "◫",
    quality: "✓",
    formulas: "ƒ",
    forecast: "↗",
    clean: "✦",
  };
  if (contextSuggestionList)
    contextSuggestionList.dataset.count = String(suggestions.length);
  contextSuggestionList?.replaceChildren(
    ...suggestions.map((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "smart-suggestion";
      button.dataset.icon = suggestionIcons[suggestion.id] ?? "•";
      const title = document.createElement("strong");
      title.textContent = translate(
        language,
        `suggestion_${suggestion.id}`,
        suggestion.label,
      );
      const reason = document.createElement("span");
      reason.className = "suggestion-reason";
      reason.textContent = translate(
        language,
        `suggestion_reason_${suggestion.id}`,
        suggestion.reason,
      );
      const relevantRoles: Record<string, string[]> = {
        chart: ["category", "measure"],
        pivot: ["category", "measure"],
        dashboard: ["date", "category", "measure"],
        forecast: ["date", "measure"],
        clean: ["text", "category"],
      };
      const sources = (schema?.columns ?? [])
        .filter(
          (column) =>
            !relevantRoles[suggestion.id] ||
            relevantRoles[suggestion.id].includes(column.role),
        )
        .slice(0, 4)
        .map((column) => column.name);
      const expectedOutputs: Record<string, string> = {
        chart: "Chart result",
        pivot: "PivotTable",
        dashboard: "Dashboard sheet",
        quality: "Quality report",
        formulas: "Formula audit",
        forecast: "Forecast report",
        clean: "Clean result sheet",
      };
      const meta = document.createElement("span");
      meta.className = "suggestion-meta";
      meta.textContent = `${schema?.sampleRows ? 93 : 78}% · ${sources.length ? sources.join(", ") : description} · ${localizeMessage(language, expectedOutputs[suggestion.id])}`;
      button.append(title, reason, meta);
      button.addEventListener("click", () => {
        if (!instruction) return;
        instruction.value = suggestion.instruction;
        instruction.dispatchEvent(new Event("input"));
        instruction.focus();
        // This suggestion was produced from the local schema, so it already has a deterministic
        // intent. Do not send the person through the AI-consent gate just because the generated
        // wording says "recommend" or "best" and names no individual column.
        skipAiOnce = true;
        smartRun?.click();
      });
      return button;
    }),
  );
  show(workbookContext, description !== "");
  show(contextSuggestions, suggestions.length > 0);
  show(
    document.querySelector<HTMLElement>("#starter-suggestions"),
    conversationMessages.length === 0 && suggestions.length === 0,
  );
}

/**
 * Reads a small local-only sample solely to improve the suggestion list. The values are converted
 * straight into aggregate schema facts and never added to chat history, diagnostics or an API call.
 */
async function readWorkspaceContext(): Promise<{
  info: WorkspaceSelection;
  schema?: WorkspaceSchema;
}> {
  return readWorkspaceContextView(officeRuntime(), (error) =>
    log.record("selection:context-schema", "info", describeError(error)),
  );
}

/**
 * The Explore tab: templates and questions made from the selection's real headers (exploreView.ts).
 * A tap only puts its request sentence in the request box and opens the Work tab; the usual
 * preview and approval decide everything after that. The month-end card starts the existing payroll
 * flow, which shows its own figures and asks before it adds anything.
 */
let exploreState: { info?: WorkspaceSelection; schema?: WorkspaceSchema } = {};
/** Counts from the sample that "Noticed" reads (exploreIdeas.ts): they choose the measure and groups. */
let exploreStats: ExploreStats | undefined;
/** The AI's ideas for the current selection; cleared when the selection changes. */
let exploreAiIdeas: ExploreItem[] = [];
/** Which cells and columns the Explore tab is showing now. */
const selectionKey = () =>
  JSON.stringify([
    exploreState.info?.address,
    exploreState.schema?.columns?.map((column) => column.name),
  ]);

function exploreChips(host: string, items: ExploreItem[]) {
  document.querySelector<HTMLElement>(host)?.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "explore-chip";
      button.dataset.explore = item.id;
      const title = document.createElement("b");
      title.textContent = localizeMessage(language, item.title);
      button.append(title);
      if (item.detail) {
        const detail = document.createElement("span");
        detail.textContent = localizeMessage(language, item.detail);
        button.append(detail);
      }
      button.addEventListener("click", () => {
        workspaceNavigation.activate("work");
        if (!instruction) return;
        instruction.value = item.request;
        instruction.dispatchEvent(new Event("input", { bubbles: true }));
        instruction.focus();
      });
      return button;
    }),
  );
}

function renderExplore(
  info: WorkspaceSelection | undefined,
  schema?: WorkspaceSchema,
) {
  exploreState = { info, schema };
  // Only a readable selection with a schema gets items; a blank cell or a single cell gets none.
  const vat = ratesOn(new Date()).vat;
  const view = exploreFor(info?.isBlank ? undefined : schema?.columns, {
    vatRate: vat.value,
    vatUnchecked: !vat.reviewed,
    stats: exploreStats,
  });
  exploreChips("#explore-template-list", view.templates);
  exploreChips("#explore-ai-list", exploreAiIdeas);
  show(
    document.querySelector<HTMLElement>("#explore-ai"),
    view.templates.length > 0 || view.questions.length > 0,
  );
  exploreChips("#explore-question-list", view.questions);
  show(
    document.querySelector<HTMLElement>("#explore-templates"),
    view.templates.length > 0,
  );
  show(
    document.querySelector<HTMLElement>("#explore-ask"),
    view.questions.length > 0,
  );
  show(document.querySelector<HTMLElement>("#explore-close"), view.payroll);
  show(
    document.querySelector<HTMLElement>("#explore-empty"),
    view.templates.length === 0 && view.questions.length === 0,
  );
}
document.querySelector("#explore-close-go")?.addEventListener("click", () => {
  workspaceNavigation.activate("work");
  void offerPayroll("");
});
languageHooks.push(() => renderExplore(exploreState.info, exploreState.schema));

/** What the "Noticed in your data" card last read, so a slow read cannot overwrite a newer one. */
let noticedToken = 0;
const noticedCard = document.querySelector<HTMLElement>("#noticed");
const noticedTiles = document.querySelector<HTMLElement>("#noticed-tiles");

function renderNoticed(tiles: NoticedTile[]) {
  if (!noticedCard || !noticedTiles) return;
  noticedTiles.replaceChildren(
    ...tiles.map((tile) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "noticed-tile";
      const figure = document.createElement("b");
      figure.textContent = tile.figure;
      const label = document.createElement("span");
      label.textContent = localizeMessage(language, tile.label);
      const action = document.createElement("i");
      action.textContent = localizeMessage(
        language,
        tile.tone === "fix"
          ? "Fix"
          : tile.tone === "review"
            ? "Review"
            : "Look",
      );
      button.append(figure, label, action);
      button.addEventListener("click", () => {
        if (!instruction) return;
        instruction.value = tile.request;
        instruction.dispatchEvent(new Event("input", { bubbles: true }));
        instruction.focus();
      });
      return button;
    }),
  );
  show(noticedCard, tiles.length > 0);
}

/** Looks at the first rows of the selection on this device; changes nothing and sends nothing. */
/** "More ideas": the agent gets column names, roles and counts (no cell) after the person agreed. */
async function askAiForIdeas() {
  const columns = (exploreState.schema?.columns ?? []).map((column) => ({
    name: String(column.name ?? "").trim(),
    role: String(column.role ?? ""),
  }));
  if (!columns.length) return;
  if (agentBusy)
    return setStatus(
      "The AI is still working on the last request. Try again when it finishes.",
    );
  const request = ideasRequest(
    columns.filter((column) => column.name),
    exploreStats,
  );
  let agreed = false;
  try {
    agreed = localStorage.getItem(AGENT_CONSENT_KEY) === "1";
  } catch {
    agreed = false;
  }
  if (!agreed) {
    agreed = await askInPane(
      localizeMessage(
        language,
        "The agent sends your request, the column names and small samples of the cells it reads (at most 50 rows at a time) to the VynorAI AI service. Personal data such as e-mail addresses and phone numbers is replaced before anything leaves this workbook. Nothing changes until you approve.",
      ),
      localizeMessage(language, "Agree"),
      localizeMessage(language, "Cancel"),
      agentConsentCard(
        {
          request: localizeMessage(language, "Ideas for the selected columns"),
        },
        language,
      ),
    );
    if (!agreed) return setStatus("Nothing was sent.");
    try {
      localStorage.setItem(AGENT_CONSENT_KEY, "1");
    } catch {
      // Asked again next time.
    }
  }
  const button = document.querySelector<HTMLButtonElement>("#explore-ai-go");
  if (button) button.disabled = true;
  agentBusy = true;
  setStatus("Asking the AI for ideas...");
  // The ideas belong to the columns they were asked for; the person may move on while the AI answers.
  const askedFor = selectionKey();
  try {
    const run = await runAgent({
      request,
      host: createOfficeAgentHost(
        officeRuntime(),
        checkStepWith(agentInputReader()),
        apiClient(),
      ),
      model: agentModel,
      mask: agentMask,
      maxTurns: 2,
    });
    if (selectionKey() !== askedFor) {
      setStatus(
        "The selection changed, so those ideas were dropped. Tap More ideas again.",
      );
      return;
    }
    exploreAiIdeas = parseIdeas(run.reply).map((idea) => ({
      id: "ai" as const,
      title: idea,
      detail: "",
      request: idea,
    }));
    renderExplore(exploreState.info, exploreState.schema);
    setStatus(
      exploreAiIdeas.length
        ? "Ideas ready. Tap one to put it in the request box."
        : "No new ideas this time.",
    );
  } catch (error) {
    log.record("explore:ideas", "fail", describeError(error));
    setStatus("The ideas could not be made. See Diagnostics.");
  } finally {
    agentBusy = false;
    if (button) button.disabled = false;
  }
}
document
  .querySelector("#explore-ai-go")
  ?.addEventListener("click", () => void askAiForIdeas());

let noticedKey = "";
let noticedAt = 0;
/** The same selection read again within this time reuses the last result: no second read of 2,000 rows. */
const NOTICED_REUSE_MS = 30_000;

/**
 * The Noticed card and the Explore counts are not read while the agent works. A selection that
 * changed meanwhile must still be read once it is idle, or the card keeps describing the old cells.
 */
let noticedRetry: ReturnType<typeof setTimeout> | undefined;
function deferNoticed() {
  clearTimeout(noticedRetry);
  noticedRetry = setTimeout(() => {
    if (agentBusy) deferNoticed();
    else void refreshSelectionChip();
  }, 800);
}

async function refreshNoticed(address: string, rows: number, columns: number) {
  if (!noticedCard) return;
  const key = `${address}|${rows}x${columns}`;
  if (key === noticedKey && Date.now() - noticedAt < NOTICED_REUSE_MS) return;
  noticedKey = "";
  const token = (noticedToken += 1);
  if (rows < 4 || columns < 1 || columns > 30) {
    if (exploreStats) {
      exploreStats = undefined;
      exploreAiIdeas = [];
      renderExplore(exploreState.info, exploreState.schema);
    }
    return renderNoticed([]);
  }
  try {
    const bang = address.lastIndexOf("!");
    const sheetName = (bang > 0 ? address.slice(0, bang) : "")
      .replace(/^'|'$/g, "")
      .replace(/''/g, "'");
    const box = parseA1(bang > 0 ? address.slice(bang + 1) : address);
    const last = Math.min(box.lastRow, box.row + NOTICE_MAX_ROWS);
    const read = `${columnLetters(box.column)}${box.row}:${columnLetters(box.lastColumn)}${last}`;
    const values = await officeRuntime().run(async (context: any) => {
      const range = sheetName
        ? context.workbook.worksheets.getItem(sheetName).getRange(read)
        : context.workbook.getSelectedRange();
      range.load("values");
      await context.sync();
      return range.values as unknown[][];
    });
    if (token !== noticedToken) return;
    // Remembered only after a read that worked, so a failed read can be tried again at once.
    noticedKey = key;
    noticedAt = Date.now();
    const [headerRow = [], ...body] = values;
    const stats = columnStats(
      headerRow.map((value: unknown) => String(value ?? "")),
      body as never,
    );
    if (JSON.stringify(stats) !== JSON.stringify(exploreStats)) {
      exploreStats = stats;
      exploreAiIdeas = [];
      renderExplore(exploreState.info, exploreState.schema);
    }
    renderNoticed(
      noticeInData(
        headerRow.map((value: unknown) => String(value ?? "")),
        body as never,
      ),
    );
  } catch {
    noticedKey = "";
    if (token === noticedToken) renderNoticed([]);
  }
}

/** Shows which sheet and cells the next request will use; hidden when nothing can be read. */
async function refreshSelectionChip() {
  if (!selectionChip || !selectionText) return;
  try {
    const { info, schema } = await readWorkspaceContext();
    const text = describeSelectionLocal(info);
    shownSelection = info;
    latestSelectionAddress = info.address;
    selectionText.textContent = text;
    show(selectionChip, text !== "");
    renderWorkspaceContext(info, schema);
    if (!agentBusy) void refreshNoticed(info.address, info.rows, info.columns);
    else deferNoticed();
    const changedAfterPreview = Boolean(
      currentPlan &&
        previewSelectionAddress &&
        info.address !== previewSelectionAddress,
    );
    show(selectionChangeWarning, changedAfterPreview);
    if (changedAfterPreview && apply) apply.disabled = true;
  } catch {
    show(selectionChip, false);
    renderWorkspaceContext(undefined);
  }
}

document
  .querySelector("#refresh-preview-selection")
  ?.addEventListener("click", () => {
    currentPlan = undefined;
    previewFingerprint = "";
    previewSelectionAddress = "";
    show(selectionChangeWarning, false);
    setStatus("Refreshing the preview for the current selection...");
    void inspect?.click();
  });

document.querySelector("#refresh-context")?.addEventListener("click", () => {
  noticedKey = "";
  void refreshSelectionChip();
});
document.querySelector("#context-overview")?.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>("#overview")?.click();
});

/** Keeps the chip current while the person moves around the sheet (one refresh per pause). */
function watchSelection() {
  void refreshSelectionChip();
  try {
    office()?.context?.document?.addHandlerAsync?.(
      office().EventType.DocumentSelectionChanged,
      () => {
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => void refreshSelectionChip(), 500);
      },
    );
  } catch (error) {
    log.record("selection:watch", "info", describeError(error));
  }
}

async function initialize() {
  localStorage.removeItem(LEGACY_SESSION_KEY);
  if (office()?.onReady) {
    try {
      const ready = await log.step(
        "office:ready",
        () => office().onReady(),
        (info: any) => ({
          host: info?.host,
          platform: info?.platform,
        }),
      );
      const platform = String((ready as any)?.platform ?? "");
      officePlatformLabel =
        platform === "OfficeOnline"
          ? "Excel Web"
          : platform === "Mac"
            ? "Excel Mac"
            : platform === "PC"
              ? "Excel Desktop"
              : "Excel";
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
  workbookPrefs = loadPreferences();
  renderPreferences();
  watchSelection();
  if (restoreSession()) {
    restoreConversationHistory();
    void restoreResultGallery();
    updateAuthenticationUi(true);
    recordTokenSummary("session:restore");
    void refreshCapabilities("restore");
    return setStatus(SIGNED_IN_IDLE_STATUS);
  }
  log.record("session:restore", "info", "no unexpired session");
  updateAuthenticationUi(false);
  setStatus("Sign in to inspect selected Excel data.");
}

// --- Excel agent (DeepSeek with tools, like Copilot) ----------------------------------------
// Read tools run at once on bounded, masked data; writes are staged and shown here; nothing
// changes until "Approve and apply"; "Undo" puts everything back. See src/agent.ts.

const AGENT_CONSENT_KEY = "vynorai.m365.agentConsent";
const agentCard = document.querySelector<HTMLElement>("#agent-card");
const agentProgress = document.querySelector<HTMLElement>("#agent-progress");
const agentUsageText = document.querySelector<HTMLElement>("#agent-usage");
const agentUsageDetails = document.querySelector<HTMLDetailsElement>(
  "#agent-usage-details",
);

/** Shows the planner's steps as a numbered list; no steps hides the list. */
function showAgentPlan(steps: readonly string[]) {
  showAgentPlanView(document, steps, selectRangeInWorkbook);
}

async function selectRangeInWorkbook(sheet: string, address: string) {
  await officeRuntime()?.run(async (context: any) => {
    context.workbook.worksheets.getItem(sheet).getRange(address).select();
    await context.sync();
  });
}

/** Where the answer came from; a range is a button that selects it in the workbook. */
function showAgentSources(sources: readonly AnswerSource[]) {
  showAgentSourcesView({
    document,
    sources,
    selectRange: selectRangeInWorkbook,
    recordError: (error) =>
      log.record("agent:source", "fail", describeError(error)),
  });
}
const agentReply = document.querySelector<HTMLElement>("#agent-reply");
const agentChanges = document.querySelector<HTMLOListElement>("#agent-changes");
const agentNote = document.querySelector<HTMLElement>("#agent-note");
const agentBadge = document.querySelector<HTMLElement>("#agent-badge");
const agentApprove =
  document.querySelector<HTMLButtonElement>("#agent-approve");
const agentDiscard =
  document.querySelector<HTMLButtonElement>("#agent-discard");
const agentUndo = document.querySelector<HTMLButtonElement>("#agent-undo");
const agentStop = document.querySelector<HTMLButtonElement>("#agent-stop");
let agentHistory: AgentMessage[] = [];
let agentMask = new PersonalMask();
let agentPending: AgentRun | undefined;
let agentLastUndo: AgentUndo | undefined;
/** Hidden backup sheets that could not be deleted yet. */
let leftoverBackups: string[] = [];
let agentBusy = false;
let agentStopped = false;
/** What the status line says after an apply; the read-back that follows must not overwrite it with "Nothing was changed". */
let lastApplyStatus = "Applied. Undo puts everything back.";
/** What the last model call sent (masked), for the privacy receipt. */
let agentSentMessages: AgentMessage[] = [];
/** The person's request of the current agent run, for the change log. */
let agentLastRequest = "";
/** Verification rounds after an apply (the agent may stage fixes once more). */
let agentRounds = 0;
let agentVerifying = false;

/** The badge words are written in English and localized now; a language switch writes them again. */
function setAgentBadge(english: string) {
  if (agentBadge) setLocalizedText(agentBadge, english);
  agentBadgeEnglish = english;
  refreshAgentChecked();
}

const agentChecked = document.querySelector<HTMLElement>("#agent-checked");
const agentCheckedText = document.querySelector<HTMLElement>(
  "#agent-checked-text",
);
const agentChecksDetails = document.querySelector<HTMLDetailsElement>(
  "#agent-checks-details",
);
let agentBadgeEnglish = "";
/** Problems of the current run (reviewers, lint, apply, verification), first one first. */
let agentIssues: string[] = [];

/**
 * The agent card shows one line (working, checked, or a check that needs attention); the role cards sit
 * under "details". A run that ends with a problem opens the details so the problem is visible.
 */
let agentCheckedPrev = "idle";
function refreshAgentChecked() {
  if (!agentChecked || !agentCheckedText) return;
  const line = checkedLine({
    badge: agentBadgeEnglish,
    progress: agentProgress?.textContent ?? "",
    issues: agentIssues,
  });
  agentChecked.hidden = line.state === "idle";
  agentChecked.dataset.state = line.state;
  const detail = line.detail;
  agentCheckedText.textContent =
    `${localizeMessage(language, line.prefix)}${detail ? ` ${detail}` : ""}`.trim();
  if (agentChecksDetails) {
    if (line.state === "warn") agentChecksDetails.open = true;
    else if (line.state === "ok") agentChecksDetails.open = false;
  }
  // A run just ended: the problem is announced on warn, otherwise the person can type the next request.
  if (agentCheckedPrev === "working" && line.state !== "working") {
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && active.type !== "button");
    if (!typing || active === instruction) {
      if (line.state === "warn")
        document.querySelector<HTMLElement>("#agent-heading")?.focus();
      else if (line.state === "ok") instruction?.focus();
    }
  }
  agentCheckedPrev = line.state;
}
// Escape discards an open preview or plan, unless the person is typing.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement ||
    active instanceof HTMLSelectElement
  )
    return;
  const visible = (button: HTMLButtonElement | null) =>
    !!button &&
    !button.hidden &&
    !button.disabled &&
    button.offsetParent !== null;
  const target = visible(agentDiscard)
    ? agentDiscard
    : visible(cancelPreviewButton)
      ? cancelPreviewButton
      : null;
  if (target) {
    event.preventDefault();
    target.click();
  }
});
if (agentProgress && typeof MutationObserver !== "undefined")
  new MutationObserver(refreshAgentChecked).observe(agentProgress, {
    childList: true,
    characterData: true,
    subtree: true,
  });
languageHooks.push(refreshAgentChecked);
languageHooks.push(() => relocalizeView(document));

function setAgentStage(stage: AgentStage, complete = false) {
  setAgentStageView(document, stage, complete);
}

const show = (element: HTMLElement | null, visible: boolean) => {
  if (element) element.hidden = !visible;
};

// The request box is cleared when the agent starts, so the language is the one taken from the request.
function agentLanguage(): "en" | "si" | "ta" {
  return textLanguage();
}

const agentToolLabel = agentToolLabelView;

/**
 * Under each staged write, a small table of the cells it will overwrite (before, after). The
 * cells are read now, so they are what approval would replace; a read that fails shows
 * "(not read)" and the change itself is unaffected.
 */
async function showChangePreviews(run: AgentRun, host: AgentHost) {
  if (!agentChanges) return;
  const created = new Set(
    run.changes.flatMap((item) =>
      item.change.kind === "create_sheet" ? [item.change.name] : [],
    ),
  );
  const items = [...agentChanges.children] as HTMLElement[];
  for (const [index, item] of run.changes.entries()) {
    const target = previewTarget(item.change, created);
    const li = items[index];
    if (!target || !li) continue;
    let current: unknown[][] | undefined;
    if (!target.newSheet) {
      try {
        current = (await host.readRange(target.sheet, target.address, false))
          .values as unknown[][];
      } catch {
        current = undefined;
      }
    }
    const cells = previewCells(item.change, current, target.newSheet);
    if (!cells.length) continue;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    setLocalizedText(
      summary,
      `Before and after (${cells.length}${target.total > cells.length ? ` of ${target.total.toLocaleString("en-US")}` : ""} cells)`,
    );
    details.append(summary);
    const table = document.createElement("table");
    table.className = "change-preview";
    const head = table.createTHead().insertRow();
    for (const label of ["Cell", "Now", "After approval"])
      setLocalizedText(head.insertCell(), label);
    const body = table.createTBody();
    for (const cell of cells) {
      const row = body.insertRow();
      row.insertCell().textContent = cell.cell;
      // "(empty)" is the pane's own word for a blank cell; every other value is the person's data.
      for (const value of [cell.before, cell.after]) {
        const td = row.insertCell();
        if (value === "(empty)") setLocalizedText(td, value);
        else td.textContent = value;
      }
    }
    details.append(table);
    li.append(details);
  }
}

function renderAgentRun(run: AgentRun) {
  show(agentCard, true);
  const relationship = relationshipEvidence(run.messages);
  showWorkbookMapView(document, relationship);
  setAgentRoleView(
    document,
    "builder",
    "done",
    `${run.changes.length} staged change(s)`,
  );
  if (relationship)
    setAgentRoleView(
      document,
      "relationships",
      "done",
      relationshipLine(relationship),
    );
  if (agentReply) {
    agentReply.textContent = "";
    // The reply itself is shown once, in the chat; this card keeps only the limit notice.
    for (const line of (run.reply
      ? ""
      : run.stoppedAtLimit
        ? localizeMessage(
            language,
            "The agent stopped at its step limit. Try a smaller request.",
          )
        : ""
    ).split(/\n+/)) {
      if (!line.trim()) continue;
      const p = document.createElement("p");
      p.textContent = line;
      agentReply.appendChild(p);
    }
  }
  const keepApplied = !run.changes.length && agentVerifying;
  if (agentChanges && !keepApplied) {
    agentChanges.textContent = "";
    for (const item of run.changes) {
      const li = document.createElement("li");
      setLocalizedText(li, describeChange(item.change));
      agentChanges.appendChild(li);
    }
  }
  const pending = run.changes.length > 0;
  setAgentStage(
    pending ? "approval" : agentVerifying ? "verify" : "review",
    !pending,
  );
  if (!keepApplied) show(agentChanges, pending);
  show(agentNote, pending);
  show(agentApprove, pending);
  show(agentDiscard, pending);
  if (agentBadge)
    setAgentBadge(
      pending
        ? "Waiting for approval"
        : run.phase === "verifying"
          ? "Verifying"
          : "Done",
    );
}

async function agentModel(messages: AgentMessage[]) {
  if (agentStopped) throw new Error("stopped");
  // The last call carries the whole conversation: the privacy receipt is built from it.
  agentSentMessages = messages;
  // A busy service or a dropped connection gets up to two more tries; a refusal does not.
  const response = await retryTransient(
    () =>
      apiClient().agentExcel({
        consent: true,
        language: agentLanguage(),
        messages,
      }),
    { shouldStop: () => agentStopped },
  );
  const reply = response?.reply;
  if (!reply || !Array.isArray(reply.tool_calls))
    throw new Error("agent-invalid");
  if (reply.usage) {
    agentUsage.prompt += Number(reply.usage.prompt) || 0;
    agentUsage.cached += Number(reply.usage.cached) || 0;
    agentUsage.completion += Number(reply.usage.completion) || 0;
  }
  return { content: String(reply.content ?? ""), tool_calls: reply.tool_calls };
}

/** Tokens of the current request, shown under the agent card. */
const agentUsage = { prompt: 0, cached: 0, completion: 0 };
function usageLine(): string {
  const total = agentUsage.prompt + agentUsage.completion;
  if (!total) return "";
  const cached = agentUsage.prompt
    ? Math.round((agentUsage.cached / agentUsage.prompt) * 100)
    : 0;
  return `Used about ${total.toLocaleString("en-US")} tokens (${cached}% of the input from cache).`;
}

function agentInputReader() {
  let cached: Promise<any> | undefined;
  return () =>
    (cached ??= inspectSelectedExcelRange(
      officeRuntime(),
      crypto.randomUUID(),
      500,
    ));
}

/** Calculations each reviewer ran in this request, shown as that reviewer's evidence. */
const helperCalculations = { accuracy: 0, safety: 0 };
let currentReviewer: "accuracy" | "safety" | undefined;
let mapperRan = false;

/**
 * Gives every team role its last state and one line of evidence, so none stays "pending" after a
 * question, a skipped planner or a reviewer that did not run. A verify round only updates the
 * reviewers; the planner, mapper and builder keep what the first round showed.
 */
function finishAgentRoles(reviewed: Awaited<ReturnType<typeof runTeam>>) {
  const states = finalRoleStates({
    planSteps: reviewed.plan?.length ?? 0,
    link: relationshipEvidence(reviewed.run.messages),
    mapperRan,
    changes: reviewed.run.changes.length,
    reviewers: reviewed.reviewers ?? [],
    calculations: helperCalculations,
    reviewSkipped: reviewed.reviewSkipped,
  });
  for (const item of states) {
    if (
      agentVerifying &&
      (item.role === "planner" ||
        item.role === "relationships" ||
        item.role === "builder")
    )
      continue;
    setAgentRoleView(document, item.role, item.state, item.evidence);
  }
  // An answer with nothing staged is never applied, so there is nothing to read back afterwards.
  if (!agentVerifying && reviewed.run.changes.length === 0)
    setAgentRoleView(
      document,
      "verification",
      "skipped",
      "not needed, nothing was changed",
    );
}

async function agentLoop(request: string) {
  agentBusy = true;
  agentStopped = false;
  show(agentCard, true);
  show(agentStop, true);
  show(agentApprove, false);
  show(agentDiscard, false);
  if (agentReply) agentReply.textContent = "";
  // The read-back round after an apply keeps the list of what was applied (check marks, failures and
  // why) on screen; it is replaced only when that round stages fixes of its own.
  if (!agentVerifying) {
    if (agentChanges) agentChanges.textContent = "";
    show(agentChanges, false);
  }
  showAgentPlan([]);
  showAgentSources([]);
  if (!agentVerifying) {
    showWorkbookMapView(document, undefined);
    resetAgentRolesView(document);
  }
  helperCalculations.accuracy = 0;
  helperCalculations.safety = 0;
  currentReviewer = undefined;
  mapperRan = false;
  agentIssues = [];
  if (agentBadge) setAgentBadge("Working");
  if (agentUsageDetails) agentUsageDetails.hidden = true;
  if (agentProgress)
    setLocalizedText(
      agentProgress,
      "Inspecting the selected data and preparing a safe plan.",
    );
  window.requestAnimationFrame(() =>
    agentCard?.scrollIntoView?.({ block: "start", behavior: "smooth" }),
  );
  const readInput = agentInputReader();
  const host = createOfficeAgentHost(
    officeRuntime(),
    checkStepWith(readInput),
    apiClient(),
  );
  try {
    // A team of agents works on the request (agentReview.ts): planner, builder, two reviewers.
    const reviewed = await runTeam({
      request,
      history: agentHistory,
      host,
      model: agentModel,
      mask: agentMask,
      facts: preferenceFacts(workbookPrefs),
      onPhase: (phase: AgentPhase) => {
        if (agentVerifying) setAgentStage("verify");
        else if (phase === "planning") setAgentStage("plan");
        else if (phase === "executing") setAgentStage("preview");
        if (agentBadge)
          setAgentBadge(
            phase === "planning"
              ? "Planning"
              : phase === "executing"
                ? "Executing"
                : phase === "verifying"
                  ? "Verifying"
                  : "Final answer",
          );
        if (phase === "planning") setStatus("Planning…");
        else if (phase === "executing") setStatus("Working…");
        else if (phase === "verifying")
          setStatus("Checking the tool result...");
      },
      onTool: (name, args) => {
        const label = agentToolLabel(name, args);
        if (name === "map_relationships") mapperRan = true;
        if (name === "map_relationships")
          setAgentRoleView(
            document,
            "relationships",
            "active",
            "checking keys",
          );
        else setAgentRoleView(document, "builder", "active", label);
        if (agentProgress) setLocalizedText(agentProgress, label);
        log.record(`agent:tool:${name}`, "info", label.slice(0, 120));
      },
      onTeamPhase: (phase) => {
        if (phase === "plan") {
          setAgentRoleView(document, "planner", "active", "building plan");
          if (!agentVerifying) setAgentStage("plan");
          if (agentBadge) setAgentBadge("Planning");
          setStatus("A planner agent is splitting the request into steps...");
        } else if (phase === "reviewing") {
          setAgentRoleView(document, "planner", "done", "plan ready");
          setAgentRoleView(document, "builder", "done", "preview staged");
          if (!agentVerifying) setAgentStage("review");
          if (agentBadge) setAgentBadge("Reviewing");
        } else if (phase === "revising") {
          if (agentBadge) setAgentBadge("Correcting");
          setStatus("Correcting the plan after the review...");
        }
      },
      onPlan: showAgentPlan,
      onReviewer: (focus) => {
        currentReviewer = focus === "accuracy" ? "accuracy" : "safety";
        if (focus === "accuracy") {
          setAgentRoleView(
            document,
            "accuracy",
            "active",
            "checking calculations",
          );
          setStatus("Checking the result…");
        } else {
          setAgentRoleView(document, "accuracy", "done", "checks completed");
          setAgentRoleView(
            document,
            "safety",
            "active",
            "checking write safety",
          );
          setStatus("Checking safety…");
        }
      },
      onHelperTool: (name, args) => {
        const label = agentToolLabel(name, args);
        if (name === "calculate" && currentReviewer)
          helperCalculations[currentReviewer] += 1;
        if (name === "map_relationships") mapperRan = true;
        if (name === "map_relationships")
          setAgentRoleView(
            document,
            "relationships",
            "active",
            "checking keys",
          );
        if (agentProgress) setLocalizedText(agentProgress, label);
        log.record(`agent:team:${name}`, "info", label.slice(0, 120));
      },
    });
    const run = reviewed.run;
    agentHistory = run.messages;
    agentPending = run.changes.length ? run : undefined;
    log.record("agent:run", "pass", {
      turns: run.turns,
      changes: run.changes.length,
    });
    if (reviewed.review)
      log.record("agent:review", reviewed.review.ok ? "pass" : "info", {
        issues: reviewed.review.issues.length,
        reviewers: reviewed.reviewers?.length ?? 0,
        planSteps: reviewed.plan?.length ?? 0,
        revised: reviewed.revised,
      });
    // Problems the reviewers found and the builder did not fix stay visible on the one-line summary.
    if (reviewed.review && !reviewed.review.ok && !reviewed.revised)
      agentIssues = [...reviewed.review.issues];
    finishAgentRoles(reviewed);
    renderAgentRun(run);
    // The answer and the changes to approve are below the chat: bring them into view above the box.
    window.requestAnimationFrame(() =>
      agentCard?.scrollIntoView?.({ block: "end", behavior: "smooth" }),
    );
    showChangePreviews(run, host).catch((error) =>
      log.record("agent:preview", "fail", describeError(error)),
    );
    if (run.reply) {
      rememberAnswerResults(
        run.reply.slice(0, MAX_CONVERSATION_CHARS),
        answerResults(run.messages, (text) => agentMask.unmask(text)),
      );
      renderConversation("assistant", run.reply, false);
    }
    showAgentSources(
      answerSources(run.messages, (text) => agentMask.unmask(text)),
    );
    const receipt = buildPrivacyReceipt(agentSentMessages);
    if (agentProgress)
      setLocalizedParts(
        agentProgress,
        [describeReview(reviewed)].filter(Boolean),
      );
    // Token and privacy counts are for the curious: collapsed under "Technical details".
    if (agentUsageText) {
      setLocalizedParts(
        agentUsageText,
        [usageLine(), describePrivacyReceipt(receipt)].filter(Boolean),
      );
      if (agentUsageDetails) agentUsageDetails.hidden = false;
    }
    const leaks =
      receipt.leaks.emails + receipt.leaks.phones + receipt.leaks.nic;
    log.record("agent:privacy", leaks ? "fail" : "pass", {
      characters: receipt.characters,
      masked: receipt.masked,
      leaks,
    });
    setStatus(
      run.changes.length
        ? "Preview ready. Nothing changed yet."
        : agentVerifying
          ? lastApplyStatus
          : "The agent answered. Nothing was changed.",
    );
  } catch (error) {
    if (agentProgress) setLocalizedText(agentProgress, "");
    if (agentStopped) {
      // The roles that did not get to work end as skipped, not as "pending" for a request that is over.
      settleActiveRolesView(document, "did not finish");
      if (agentBadge) setAgentBadge("Stopped");
      setStatus("Stopped. Nothing was changed.");
    } else if (error instanceof M365ApiError) {
      settleActiveRolesView(document, "did not finish");
      handleApiError("agent", error);
    } else {
      settleActiveRolesView(document, "did not finish");
      agentIssues = [describeError(error)];
      agentBadgeEnglish = "Failed";
      refreshAgentChecked();
      log.record("agent:run", "fail", describeError(error));
      setStatus("The agent could not finish. Nothing was changed.");
    }
  } finally {
    agentBusy = false;
    show(agentStop, false);
  }
}

let agentStarting = false;
async function startAgent() {
  if (agentStarting) return;
  agentStarting = true;
  try {
    await startAgentRun();
  } catch (error) {
    log.record("agent:start", "fail", describeError(error));
    setStatus("Something went wrong. See Diagnostics.");
  } finally {
    agentStarting = false;
  }
}

async function startAgentRun() {
  const request = (instruction?.value || "").trim();
  if (!request) return setStatus("Describe what you want first.");
  if (!config || !accessToken) return setStatus("Sign in first.");
  if (agentBusy)
    return setStatus(
      "The AI is still working on the last request. Try again when it finishes.",
    );
  // A payroll sheet is a local template: nothing is sent for it.
  if (
    isPayrollRequest(request) &&
    normalizeInstruction(request) !== payrollDeclined
  ) {
    requestLanguage = responseLanguage(request, language);
    if (await offerPayroll(request)) return;
    payrollDeclined = normalizeInstruction(request);
  }
  let agreed = false;
  try {
    agreed = localStorage.getItem(AGENT_CONSENT_KEY) === "1";
  } catch {
    agreed = false;
  }
  if (!agreed) {
    // The card names what this request will really read: the selection's size and personal columns.
    let facts: Parameters<typeof agentConsentCard>[0] = { request };
    try {
      const input = await inspectSelectedExcelRange(
        officeRuntime(),
        crypto.randomUUID(),
      );
      const layout = getCachedHeaderLayout(input);
      facts = {
        request,
        rows: Math.max(0, input.values.length - layout.headerRowCount),
        columns: layout.headers.length,
        sheet: String(input.worksheetName ?? ""),
        headers: layout.headers.map(String),
      };
    } catch {
      // No usable selection: the card still names the request.
    }
    agreed = await askInPane(
      localizeMessage(
        language,
        "The agent sends your request, the column names and small samples of the cells it reads (at most 50 rows at a time) to the VynorAI AI service. Personal data such as e-mail addresses and phone numbers is replaced before anything leaves this workbook. Nothing changes until you approve.",
      ),
      localizeMessage(language, "Agree"),
      localizeMessage(language, "Cancel"),
      agentConsentCard(facts, language),
    );
    if (!agreed) return setStatus("Nothing was sent.");
    try {
      localStorage.setItem(AGENT_CONSENT_KEY, "1");
    } catch {
      // Asked again next time.
    }
  }
  // A new request: earlier backups are no longer needed once the person moved on.
  if (agentLastUndo) {
    const stuck = await dropAgentBackups(officeRuntime(), agentLastUndo).catch(
      () => [] as string[],
    );
    // A backup that could not be deleted is tried again with the next request, never forgotten.
    leftoverBackups = [...leftoverBackups, ...stuck];
    agentLastUndo = undefined;
    show(agentUndo, false);
  }
  if (leftoverBackups.length)
    leftoverBackups = await deleteHiddenSheets(
      officeRuntime(),
      leftoverBackups,
    ).catch(() => leftoverBackups);
  agentRounds = 0;
  agentVerifying = false;
  setAgentStage("inspect");
  agentLastRequest = request;
  requestLanguage = responseLanguage(request, language);
  learnPreferences(request);
  agentUsage.prompt = 0;
  agentUsage.cached = 0;
  agentUsage.completion = 0;
  renderConversation("user", request, false);
  if (instruction) instruction.value = "";
  setStatus("The agent is working. Nothing changes until you approve.");
  await agentLoop(request);
}

const RUN_MODE_KEY = "vynorai.m365.runMode";
try {
  const savedMode = localStorage.getItem(RUN_MODE_KEY);
  if (runMode && ["smart", "local", "agent"].includes(savedMode ?? ""))
    runMode.value = savedMode!;
} catch {
  // Smart remains the safe default when storage is unavailable.
}
runMode?.addEventListener("change", () => {
  try {
    localStorage.setItem(RUN_MODE_KEY, runMode.value);
  } catch {
    // The selected mode still applies to this session.
  }
});
smartRun?.addEventListener("click", () => {
  const request = instruction?.value.trim() ?? "";
  if (!request) return setStatus("Describe what you want first.");
  const mode = (runMode?.value || "smart") as SmartMode;
  if (mode === "agent" && capabilities?.aiAnalysis === false) {
    setStatus(
      translate(
        language,
        "agent_unavailable",
        "Agent workflow is not available for this account. Use local preview.",
      ),
    );
    return;
  }
  const path = chooseSmartPath(
    request,
    mode,
    capabilities?.aiAnalysis !== false,
  );
  if (path === "agent") void startAgent();
  else void inspect?.click();
});
instruction?.addEventListener("keydown", (event) => {
  // Enter sends; Shift+Enter is a new line; Ctrl/Cmd+Enter still sends. Not while an IME is composing.
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  smartRun?.click();
});

document
  .querySelector("#agent-run")
  ?.addEventListener("click", () => void startAgent());

// The agent is a preview: its button shows only when the person turns it on in the menu.
const AGENT_ON_KEY = "vynorai.m365.agentOn";
function agentOn(): boolean {
  try {
    return localStorage.getItem(AGENT_ON_KEY) === "1";
  } catch {
    return false;
  }
}
function showAgentToggle() {
  const on = agentOn();
  show(document.querySelector<HTMLElement>("#agent-run"), on);
  const toggle = document.querySelector<HTMLElement>("#agent-toggle");
  if (toggle)
    toggle.textContent = on
      ? localizeMessage(language, "Agent (preview): ON (click to turn off)")
      : localizeMessage(language, "Agent (preview): OFF (click to turn on)");
}
languageHooks.push(showAgentToggle);
document.querySelector("#agent-toggle")?.addEventListener("click", () => {
  try {
    localStorage.setItem(AGENT_ON_KEY, agentOn() ? "0" : "1");
  } catch {
    // Stays as it was.
  }
  showAgentToggle();
});
showAgentToggle();
agentStop?.addEventListener("click", () => {
  agentStopped = true;
});
agentDiscard?.addEventListener("click", () => {
  agentPending = undefined;
  // The agent must know nothing was applied.
  agentHistory = [
    ...agentHistory,
    {
      role: "user",
      content:
        "[Report from the add-in] The person discarded the staged changes. Nothing was applied.",
    },
  ];
  show(agentChanges, false);
  show(agentNote, false);
  show(agentApprove, false);
  show(agentDiscard, false);
  if (agentBadge) setAgentBadge("Discarded");
  setAgentRoleView(
    document,
    "verification",
    "skipped",
    "not needed, nothing was changed",
  );
  setAgentStage("approval", true);
  setStatus("Discarded. Nothing was changed.");
});

agentApprove?.addEventListener("click", async () => {
  const run = agentPending;
  if (!run || agentBusy) return;
  agentPending = undefined;
  agentBusy = true;
  show(agentApprove, false);
  show(agentDiscard, false);
  if (agentBadge) setAgentBadge("Applying");
  setAgentStage("apply");
  setAgentRoleView(document, "verification", "pending", "waiting for apply");
  agentStopped = false;
  show(agentStop, true);
  setStatus("Applying the approved changes...");
  log.record("agent:approve", "pass", { changes: run.changes.length });
  const readInput = agentInputReader();
  let report: Awaited<ReturnType<typeof applyAgentChanges>>;
  try {
    report = await applyAgentChanges(
      officeRuntime(),
      run.changes.map((item) => item.change),
      runStepWith({
        runtime: officeRuntime(),
        api: apiClient(),
        readInput,
        supportsExcelApi,
        requirements: ACTION_REQUIREMENTS,
        preferences: workbookPrefs,
        language: textLanguage,
      }),
      {
        onProgress: (index, total, label) => {
          if (agentProgress)
            setLocalizedText(
              agentProgress,
              `Applying ${index} of ${total}: ${label.slice(0, 120)}`,
            );
        },
        isCancelled: () => agentStopped,
      },
    );
  } catch (error) {
    agentBusy = false;
    show(agentStop, false);
    setAgentRoleView(document, "verification", "skipped", "did not finish");
    log.record("agent:apply", "fail", describeError(error));
    setStatus("Applying failed. See Diagnostics.");
    return;
  }
  agentBusy = false;
  show(agentStop, false);
  if (agentProgress) setLocalizedText(agentProgress, "");
  agentIssues = report.results
    .filter((result) => result.status === "failed")
    .map(
      (result) =>
        `${result.change}${result.detail ? `: ${result.detail}` : ""}`,
    );
  refreshAgentChecked();
  agentLastUndo = mergeUndo(agentLastUndo, report.undo);
  show(agentUndo, true);
  if (agentChanges) {
    agentChanges.textContent = "";
    for (const result of report.results) {
      const li = document.createElement("li");
      // The glyph is decoration; the word beside it is what a screen reader announces.
      const glyph = document.createElement("span");
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent =
        result.status === "applied"
          ? "✓"
          : result.status === "failed"
            ? "✗"
            : "–";
      const word = document.createElement("span");
      word.className = "sr-only";
      setLocalizedText(
        word,
        result.status === "applied"
          ? "applied"
          : result.status === "failed"
            ? "failed"
            : "skipped",
      );
      const what = document.createElement("span");
      setLocalizedText(what, result.change);
      const colon = document.createElement("span");
      colon.className = "sr-only";
      colon.textContent = ": ";
      li.append(
        glyph,
        word,
        colon,
        " ",
        what,
        `${result.status === "failed" ? ` (${String(result.detail ?? "")})` : ""}${result.ms && result.ms >= 1000 ? ` - ${(result.ms / 1000).toFixed(1)} s` : ""}`,
      );
      agentChanges.appendChild(li);
    }
  }
  show(agentNote, false);
  const failed = report.results.some((result) => result.status === "failed");
  log.record("agent:apply", failed ? "fail" : "pass", {
    results: report.results.map((result) => result.status).join(","),
  });
  await logChanges({
    at: new Date(),
    action: failed ? "partly applied" : "applied",
    request: agentLastRequest,
    changes: report.results.map((result) => ({
      change: result.change,
      status: result.status,
    })),
    reference: "agent",
  });
  // Only the first apply of a request counts; the agent's later fix rounds do not add time.
  if (agentRounds === 0)
    noteVerifiedApply(
      agentApplyKinds(
        run.changes.map((item) => item.change),
        report.results,
      ),
    );
  lastApplyStatus =
    failed || agentStopped
      ? "Partly applied. Undo puts everything back."
      : "Applied. Undo puts everything back.";
  noticedKey = "";
  setStatus(lastApplyStatus);
  // The agent checks what was written once or twice and may stage fixes (they need approval again).
  if (agentRounds < 2 && !agentStopped) {
    agentRounds += 1;
    agentVerifying = true;
    setAgentStage("verify");
    setAgentRoleView(
      document,
      "verification",
      "active",
      "reading results back",
    );
    if (agentBadge) setAgentBadge("Verifying");
    setStatus("Verifying the applied result...");
    await agentLoop(
      appliedReport(
        report.results.map((result) => ({
          change: result.change,
          status: result.status === "applied" ? "applied" : "failed",
          detail: result.detail,
        })),
      ),
    );
    setAgentRoleView(
      document,
      "verification",
      "done",
      readBackLine(report.results),
    );
    agentVerifying = false;
    // The verify round ends on its own wording; the person must still see that the apply is undoable.
    if (!agentPending && !agentStopped) setStatus(lastApplyStatus);
  } else if (agentStopped) {
    // Stop skipped the read-back: the verifier never ran, so it must not keep waiting for the apply.
    setAgentRoleView(document, "verification", "skipped", "did not finish");
  }
});

const mergeUndo = mergeUndoData;

agentUndo?.addEventListener("click", async () => {
  if (!agentLastUndo || agentBusy) return;
  agentBusy = true;
  setStatus("Undoing the agent's changes...");
  try {
    await undoAgentChanges(officeRuntime(), agentLastUndo, async (rollback) => {
      await rollbackCreatedItems(officeRuntime(), rollback as any, true);
    });
    agentLastUndo = undefined;
    agentPending = undefined;
    show(agentUndo, false);
    show(agentChanges, false);
    show(agentNote, false);
    show(agentApprove, false);
    show(agentDiscard, false);
    agentHistory = [
      ...agentHistory,
      {
        role: "user",
        content:
          "[Report from the add-in] The person undid all applied changes.",
      },
    ];
    if (agentBadge) setAgentBadge("Undone");
    log.record("agent:undo", "pass");
    await logChanges({
      at: new Date(),
      action: "undone",
      request: agentLastRequest,
      changes: [],
      reference: "agent",
    });
    noticedKey = "";
    setStatus("Undone. The workbook is back as it was.");
  } catch (error) {
    log.record("agent:undo", "fail", describeError(error));
    setStatus("Undo did not finish. See Diagnostics.");
  } finally {
    agentBusy = false;
  }
});

document.querySelectorAll(".new-chat-action").forEach((button) => {
  button.addEventListener("click", () => {
    agentHistory = [];
    agentMask = new PersonalMask();
    agentPending = undefined;
    show(agentCard, false);
  });
});

// --- Workbook preferences, change log, Sri Lanka pack, WhatsApp summary ---------------------
// Preferences live in the workbook's own document settings (they travel with the file); only
// choices are stored, never cell values. See preferences.ts, changeLog.ts, sriLanka.ts.

let workbookPrefs: WorkbookPreferences = {};
const prefsLine = document.querySelector<HTMLElement>("#prefs-line");
const prefsStyle = document.querySelector<HTMLSelectElement>(
  "#prefs-number-style",
);
const prefsFiscal = document.querySelector<HTMLSelectElement>("#prefs-fiscal");
const prefsCurrency =
  document.querySelector<HTMLSelectElement>("#prefs-currency");
const prefsAudience =
  document.querySelector<HTMLSelectElement>("#prefs-audience");
const prefsChangeLog =
  document.querySelector<HTMLInputElement>("#prefs-changelog");

function prefsFallbackKey(): string | undefined {
  const workbook = workbookStorageFingerprint();
  return workbook ? `${PREFERENCES_KEY}.${workbook}` : undefined;
}

function loadPreferences(): WorkbookPreferences {
  try {
    const raw = office()?.context?.document?.settings?.get?.(PREFERENCES_KEY);
    if (raw != null) return parsePreferences(raw);
  } catch {
    // Settings are not available in this host; the browser copy is used.
  }
  try {
    const key = prefsFallbackKey();
    return key ? parsePreferences(localStorage.getItem(key)) : {};
  } catch {
    return {};
  }
}

function savePreferences(next: WorkbookPreferences) {
  workbookPrefs = parsePreferences(next);
  const text = JSON.stringify(workbookPrefs);
  try {
    const settings = office()?.context?.document?.settings;
    if (settings?.set) {
      settings.set(PREFERENCES_KEY, text);
      settings.saveAsync?.();
    }
  } catch {
    // Kept in the browser copy below.
  }
  try {
    const key = prefsFallbackKey();
    if (key) localStorage.setItem(key, text);
  } catch {
    // Private window: remembered for this session only.
  }
  renderPreferences();
}

function learnPreferences(request: string) {
  const learnt = learnFromRequest(workbookPrefs, request);
  if (!Object.keys(learnt).length) return;
  savePreferences({ ...workbookPrefs, ...learnt });
  log.record("prefs:learnt", "info", Object.keys(learnt).join(","));
}

function renderPreferences() {
  if (prefsLine) prefsLine.textContent = describePreferences(workbookPrefs);
  if (prefsStyle) prefsStyle.value = workbookPrefs.numberStyle ?? "";
  if (prefsFiscal)
    prefsFiscal.value = String(workbookPrefs.fiscalYearStart ?? "");
  if (prefsCurrency) prefsCurrency.value = workbookPrefs.currency ?? "";
  if (prefsAudience) prefsAudience.value = workbookPrefs.audience ?? "";
  if (prefsChangeLog)
    prefsChangeLog.checked = workbookPrefs.changeLog !== false;
}

function updatePreference(change: Partial<WorkbookPreferences>) {
  const next: Record<string, unknown> = { ...workbookPrefs, ...change };
  for (const [key, value] of Object.entries(change))
    if (value === undefined || value === "") delete next[key];
  savePreferences(next as WorkbookPreferences);
}

prefsStyle?.addEventListener("change", () =>
  updatePreference({ numberStyle: (prefsStyle.value || undefined) as any }),
);
prefsFiscal?.addEventListener("change", () =>
  updatePreference({
    fiscalYearStart: prefsFiscal.value ? Number(prefsFiscal.value) : undefined,
  }),
);
prefsCurrency?.addEventListener("change", () =>
  updatePreference({ currency: prefsCurrency.value || undefined }),
);
prefsAudience?.addEventListener("change", () =>
  updatePreference({ audience: (prefsAudience.value || undefined) as any }),
);
prefsChangeLog?.addEventListener("change", () =>
  updatePreference({ changeLog: prefsChangeLog.checked }),
);
document.querySelector("#prefs-forget")?.addEventListener("click", () => {
  savePreferences({});
  setStatus("Forgot the saved choices for this workbook.");
});

/** One line per change in the "VynorAI Log" sheet; never fails an apply or an undo. */
async function logChanges(entry: ChangeLogEntry) {
  if (workbookPrefs.changeLog === false) return;
  const ok = await appendChangeLog(officeRuntime(), changeLogRows(entry));
  log.record("changelog:append", ok ? "pass" : "fail", {
    action: entry.action,
    rows: entry.changes.length,
  });
}

document
  .querySelector("#prefs-holidays")
  ?.addEventListener("click", async () => {
    const year = new Date().getFullYear();
    if (
      !(await askInPane(
        localizeMessage(
          language,
          `Add an "LK Holidays" sheet with the fixed-date holidays of ${year} and ${year + 1}? Poya days and festivals change every year: add them from the gazette. NETWORKDAYS(start, end, LK_Holidays) then skips them.`,
        ),
        localizeMessage(language, "Add"),
        undefined,
        holidaysCard(
          [year, year + 1],
          holidaySheetRows([year, year + 1]).rows.length,
          language,
        ),
      ))
    )
      return;
    const result = await writeHolidaySheet(officeRuntime(), [year, year + 1]);
    if (!result.ok) {
      log.record("lk:holidays", "fail", result.error);
      return setStatus(
        result.error === "HOLIDAY_SHEET_EXISTS"
          ? 'An "LK Holidays" sheet already exists; nothing was changed.'
          : "The holiday sheet could not be added. See Diagnostics.",
      );
    }
    updatePreference({ holidays: true });
    await logChanges({
      at: new Date(),
      action: "applied",
      request: "Add Sri Lanka holiday table",
      changes: [
        {
          change: `${result.rows} holidays added`,
          sheet: "LK Holidays",
          status: "created",
        },
      ],
      reference: "LK_Holidays",
    });
    setStatus(
      `Added the "LK Holidays" sheet (${result.rows} fixed-date holidays). Add Poya days from the gazette; delete the sheet to undo.`,
    );
  });

/**
 * Offers a payroll sheet for the request's month (payroll.ts): employees are copied from the
 * selection when it is an employee list with a basic salary column, else the sheet has blank
 * rows. Returns false when the person says no, so the request is read as usual.
 */
let payrollDeclined = "";
let payrollOpen = false;

async function offerPayroll(request: string): Promise<boolean> {
  // A second click while the question is open does nothing.
  if (payrollOpen) return true;
  payrollOpen = true;
  try {
    return await askAndWritePayroll(request);
  } finally {
    payrollOpen = false;
  }
}

async function askAndWritePayroll(request: string): Promise<boolean> {
  const words = textLanguage();
  let employees: PayrollEmployee[] = [];
  let skipped: string[] = [];
  try {
    const input = await inspectSelectedExcelRange(
      officeRuntime(),
      crypto.randomUUID(),
    );
    const layout = getCachedHeaderLayout(input);
    const map = input.sample
      ? null
      : mapPayrollColumns(layout.headers.map(String));
    if (map) {
      employees = employeesFromSelection(
        input.values.slice(layout.headerRowCount),
        map,
      );
      skipped = map.skipped.map((index) => String(layout.headers[index]));
    }
  } catch {
    // No usable selection: the sheet starts with blank rows.
  }
  const plan = buildPayrollPlan({
    month: monthFromRequest(request, new Date()),
    employees,
    language: words,
  });
  log.record("payroll:offer", "pass", {
    month: plan.sheet,
    employees: employees.length,
    review: plan.needsReview,
  });
  if (
    !(await askInPane(
      payrollQuestion(plan, employees.length, words, skipped),
      localizeMessage(words, "Add"),
      undefined,
      payrollCard(plan, employees.length, words, skipped),
    ))
  )
    return false;
  const result = await writePayrollSheet(officeRuntime(), plan);
  if (!result.ok) {
    log.record("payroll:write", "fail", result.error);
    const message = payrollResult(
      result.error === "PAYROLL_SHEET_EXISTS" ? "exists" : "failed",
      plan.sheet,
      words,
    );
    renderConversation("error", message);
    setStatus(message);
    return true;
  }
  log.record("payroll:write", "pass", { sheet: plan.sheet });
  await logChanges({
    at: new Date(),
    action: "applied",
    request: request || "Add payroll sheet",
    changes: [
      {
        change: `Payroll sheet with ${plan.employees} employee rows`,
        sheet: plan.sheet,
        status: "created",
      },
    ],
    reference: plan.sheet,
  });
  const done = payrollResult("created", plan.sheet, words);
  renderConversation("assistant", done);
  setStatus(done);
  return true;
}

document
  .querySelector("#prefs-payroll")
  ?.addEventListener("click", () => void offerPayroll(""));

/* Share card: one Share button for the latest result, the selected cells or pasted cells. */
const shareImage = document.querySelector<HTMLImageElement>("#share-card-img");
const shareMain = document.querySelector<HTMLButtonElement>("#share-main");
const shareStatus = document.querySelector<HTMLElement>("#share-card-status");
const sharePaste = document.querySelector<HTMLTextAreaElement>("#share-paste");
const shareMessage =
  document.querySelector<HTMLTextAreaElement>("#share-message");
const shareMessageBlock = document.querySelector<HTMLElement>(
  "#share-message-block",
);
let shareState: { card: ShareCard; blob: Blob | null } | undefined;

function setShareStatus(message: string) {
  if (shareStatus) shareStatus.textContent = message;
}

/* Card styles (Summary / Chart / Insight): drawn on this device from the same card. */
const shareStylesRoot = document.querySelector<HTMLElement>("#share-styles");
let shareStyleChoice: ShareStyle | undefined = readShareStyle(browserStorage());
let shareCanvases: Partial<Record<ShareStyle, HTMLCanvasElement>> = {};

/** Draws every style this card can show, fills the picker, and returns the chosen style's picture. */
function renderShareStyles(card: ShareCard): HTMLCanvasElement {
  const available = availableShareStyles(card);
  const style = pickShareStyle(card, shareStyleChoice);
  shareCanvases = {};
  const thumbnails: Partial<Record<ShareStyle, string>> = {};
  for (const name of SHARE_STYLES.filter((item) => available.includes(item))) {
    shareCanvases[name] = drawShareCardStyle(card, name);
    thumbnails[name] = thumbnailDataUrl(shareCanvases[name]!);
  }
  updateStylePicker(shareStylesRoot, available, style, thumbnails);
  return shareCanvases[style]!;
}

onStylePick(shareStylesRoot, async (style) => {
  const canvas = shareCanvases[style];
  if (!shareState || !canvas) return;
  shareStyleChoice = style;
  storeShareStyle(browserStorage(), style);
  const blob = await canvasToBlob(canvas);
  if (shareStyleChoice !== style || !shareState) return;
  shareState = { card: shareState.card, blob };
  if (shareImage) shareImage.src = canvas.toDataURL("image/png");
  updateStylePicker(
    shareStylesRoot,
    availableShareStyles(shareState.card),
    style,
    {},
  );
});

async function showShareCard(
  values: any[][],
  sheet: string,
  source: "sheet" | "pasted" | "selection",
) {
  const currency = workbookPrefs.currency
    ? currencyGuessFor(workbookPrefs.currency, "preference")
    : undefined;
  const card = buildShareCard(values, {
    sheet,
    source,
    language: textLanguage(),
    ...(currency ? { symbol: currency.symbol } : {}),
    ...(workbookPrefs.numberStyle ? { style: workbookPrefs.numberStyle } : {}),
  });
  if (card.kind === "empty") {
    shareState = undefined;
    if (shareImage) shareImage.hidden = true;
    if (shareStylesRoot) shareStylesRoot.hidden = true;
    if (shareMessageBlock) shareMessageBlock.hidden = true;
    if (shareMain) shareMain.disabled = true;
    return setShareStatus(
      localizeMessage(
        textLanguage(),
        "No numbers found there. Pick or paste cells with a header row and a number column.",
      ),
    );
  }
  const canvas = renderShareStyles(card);
  shareState = { card, blob: await canvasToBlob(canvas) };
  if (shareImage) {
    shareImage.src = canvas.toDataURL("image/png");
    shareImage.alt = card.title;
    shareImage.hidden = false;
  }
  if (shareMessage) shareMessage.value = card.message;
  if (shareMessageBlock) shareMessageBlock.hidden = false;
  if (shareMain) shareMain.disabled = false;
  setShareStatus("");
}

async function shareFromResult() {
  const sheet = lastRevealSheet || currentSourceSheet;
  if (!sheet)
    return setShareStatus(
      localizeMessage(textLanguage(), "Make a report first."),
    );
  try {
    const report = await readExcelReportValues(sheet, 60, 30);
    await showShareCard(report.values, sheet, "sheet");
  } catch (error) {
    log.record("share:card", "fail", describeError(error));
    setShareStatus(
      localizeMessage(
        textLanguage(),
        "The card could not be made. See Diagnostics.",
      ),
    );
  }
}

document
  .querySelector("#share-use-result")
  ?.addEventListener("click", () => void shareFromResult());
document
  .querySelector("#share-use-selection")
  ?.addEventListener("click", async () => {
    try {
      const selected = await readSelectedExcelValues(60, 30);
      await showShareCard(selected.values, selected.sheet, "selection");
    } catch (error) {
      log.record("share:card", "fail", describeError(error));
      setShareStatus(
        localizeMessage(
          textLanguage(),
          "The card could not be made. See Diagnostics.",
        ),
      );
    }
  });
sharePaste?.addEventListener("input", () => {
  const text = sharePaste.value;
  if (text.trim())
    showShareCard(parsePastedCells(text), "", "pasted").catch((error) =>
      log.record("share:card", "fail", describeError(error)),
    );
});
document
  .querySelector('#workspace-nav [data-workspace-target="share"]')
  ?.addEventListener("click", () => {
    if (!shareState && (lastRevealSheet || currentSourceSheet))
      void shareFromResult();
  });
shareMain?.addEventListener("click", async () => {
  if (!shareState) return;
  try {
    const outcome = await deliverShare(
      shareState.blob,
      shareMessage?.value.trim() || shareState.card.message,
      browserShareEnv(),
    );
    log.record(
      "share:deliver",
      outcome === "failed" ? "fail" : "pass",
      outcome,
    );
    setShareStatus(shareOutcomeText(outcome, textLanguage()));
  } catch (error) {
    log.record("share:deliver", "fail", describeError(error));
    setShareStatus(shareOutcomeText("failed", textLanguage()));
  }
});
document
  .querySelector("#share-copy-text")
  ?.addEventListener("click", async () => {
    const text = shareMessage?.value.trim() || shareState?.card.message || "";
    if (!text) return;
    const env = browserShareEnv();
    let copied = false;
    try {
      if (env.writeText) {
        await env.writeText(text);
        copied = true;
      }
    } catch {
      // The old copy command is the next try.
    }
    if (!copied) copied = env.execCopy?.(text) ?? false;
    setShareStatus(
      copied
        ? localizeMessage(textLanguage(), "Text copied.")
        : localizeMessage(textLanguage(), "Could not copy the text."),
    );
  });

/* "Saved this month" footer: an estimate kept on this device (timeSaved.ts); nothing is sent. */
function refreshSavedFooter() {
  const footer = document.querySelector<HTMLElement>("#saved-footer");
  const month = document.querySelector<HTMLElement>("#saved-month");
  const streak = document.querySelector<HTMLElement>("#saved-streak");
  if (!footer || !month || !streak) return;
  const text = savedFooterText(readLedger(browserStorage()), new Date());
  month.textContent = text.month ? localizeMessage(language, text.month) : "";
  streak.textContent = text.streak
    ? localizeMessage(language, text.streak)
    : "";
  footer.hidden = !text.month && !text.streak;
}

/** Called after an apply the add-in verified; an apply with no counted work records nothing. */
function noteVerifiedApply(kinds: WorkKind[]) {
  recordVerifiedApply(browserStorage(), kinds);
  refreshSavedFooter();
}
languageHooks.push(refreshSavedFooter);
refreshSavedFooter();

void initialize();
