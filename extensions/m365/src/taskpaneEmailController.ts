import {
  beginM365OAuth,
  completeM365OAuth,
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
  excelValuesToCsv,
  readExcelWorkbookBase64,
  readExcelPdfBase64,
  readExcelReportValues,
  readExcelChartImages,
} from "./officeExcel.js";
import {
  base64Bytes,
  escapeEmailHtml,
  splitEmailAddresses,
  textToBase64,
} from "./taskpanePrimitives.js";
import {
  prepareShareComposer,
  updateShareView,
  type ShareViewElements,
} from "./taskpaneShareView.js";
import {
  buildReportEmailRequest,
  reportEmailConsentMessage,
  reportSummaryText as buildReportSummaryText,
} from "./reportEmailAi.js";
import { validateAssistResult } from "./textAssist.js";
import { emailSendCard } from "./dialogCards.js";
import { askInPane } from "./confirmDialog.js";
import { localizeMessage, type Language } from "./i18n.js";
import type { M365ApiClient } from "./api.js";
import type { DiagnosticsLog } from "./diagnostics.js";
import type { ExcelActionResult } from "./officeExcel.js";

export type EmailFormat =
  | "auto"
  | "xlsx"
  | "pdf"
  | "csv"
  | "xlsx-pdf"
  | "summary";

export interface EmailControllerElements extends ShareViewElements {
  cc: HTMLInputElement | null;
  bcc: HTMLInputElement | null;
  format: HTMLSelectElement | null;
  bodyType: HTMLSelectElement | null;
  deliveryMode: HTMLSelectElement | null;
  includeChart: HTMLInputElement | null;
  aiWrite: HTMLButtonElement | null;
  deliveryStatus: HTMLElement | null;
  reportName: HTMLElement | null;
  attachmentSize: HTMLElement | null;
  draftFallback: HTMLElement | null;
  draftLink: HTMLAnchorElement | null;
  draftNote: HTMLElement | null;
}

export interface EmailControllerDeps {
  elements: EmailControllerElements;
  config: (M365OAuthConfig & { apiBaseUrl?: string }) | undefined;
  getAccessToken: () => string;
  getLanguage: () => Language;
  getTextLanguage: () => Language;
  getReportSheet: () => string | undefined;
  getGalleryResults: () => readonly ExcelActionResult[];
  hasReport: () => boolean;
  apiClient: () => M365ApiClient;
  signInWithOfficeDialog: (authorizeUrl: string) => Promise<string>;
  setStatus: (message: string) => void;
  refreshNavigation: () => void;
  activateShare: () => void;
  log: DiagnosticsLog;
}

export function createEmailController(deps: EmailControllerDeps) {
  let sending = false;

  const reportSheet = () => deps.getReportSheet();
  const elements = () => deps.elements;

  function updateUi(signedIn = Boolean(deps.getAccessToken())): void {
    updateShareView(
      {
        card: elements().card,
        note: elements().note,
        to: elements().to,
        subject: elements().subject,
        body: elements().body,
        send: elements().send,
      },
      {
        signedIn,
        hasReport: deps.hasReport(),
        configured: Boolean(deps.config?.graphScopes?.length),
        sending,
      },
    );
  }

  function prepare(recipient = "", openShare = true): void {
    const language = deps.getLanguage();
    const current = elements();
    if (current.deliveryStatus) {
      current.deliveryStatus.className = "delivery-status";
      current.deliveryStatus.textContent = localizeMessage(
        language,
        "Not sent yet · approval required",
      );
    }
    if (current.reportName)
      current.reportName.textContent = reportSheet() || "Workbook report";
    if (current.attachmentSize)
      current.attachmentSize.textContent = localizeMessage(
        language,
        "Size calculated after approval",
      );
    updateUi();
    deps.refreshNavigation();
    if (openShare) deps.activateShare();
    prepareShareComposer(
      {
        card: current.card,
        note: current.note,
        to: current.to,
        subject: current.subject,
        body: current.body,
        send: current.send,
      },
      {
        recipient,
        reportSheet: reportSheet() || "Workbook",
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
    const config = deps.config;
    if (!config) throw new Error("EMAIL_PERMISSION_NOT_CONFIGURED");
    const scopes = scopesOverride ?? config.graphScopes;
    if (!scopes?.length) throw new Error("EMAIL_PERMISSION_NOT_CONFIGURED");
    const graphConfig: M365OAuthConfig = {
      ...config,
      scopes: [...new Set(scopes)],
    };
    const attemptStorage = createOAuthAttemptStorage();
    const authorizeUrl = await deps.log.step("email:oauth-authorize-url", () =>
      beginM365OAuth(graphConfig, attemptStorage),
    );
    const callbackUrl = await deps.signInWithOfficeDialog(authorizeUrl);
    const tokens = await deps.log.step(
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

  function reportSummaryText(values: any[][], truncated: boolean): string {
    return buildReportSummaryText(
      [...deps.getGalleryResults()],
      reportSheet() || "Workbook",
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
    const results = deps
      .getGalleryResults()
      .slice(-20)
      .map(
        (result) =>
          `<li>${escapeEmailHtml(`${result.kind}: ${result.name} on ${result.targetSheet} (${result.status})`)}</li>`,
      )
      .join("");
    return `<h3>VynorAI Excel report</h3><p>Report sheet: ${escapeEmailHtml(reportSheet() || "Workbook")}</p><ul>${results}</ul>${rows ? `<table border="1" cellpadding="4" cellspacing="0"><tbody>${rows}</tbody></table>` : ""}${truncated ? "<p><em>Report preview truncated to a bounded local sample.</em></p>" : ""}`;
  }

  async function buildEmailRequest(): Promise<{
    request: GraphMailRequest;
    format: string;
  }> {
    const current = elements();
    const requested = (current.format?.value || "auto") as EmailFormat;
    const bodyType = current.bodyType?.value === "Text" ? "Text" : "HTML";
    const sheet = reportSheet();
    let values: any[][] = [];
    let truncated = false;
    if (sheet && requested !== "xlsx") {
      const report = await readExcelReportValues(sheet, 200, 30);
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
    ) =>
      attachments.push({ name, contentType, contentBytes, bytes, ...options });
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
      addFile(
        "VynorAI-Excel-Report.pdf",
        PDF_MIME,
        file.base64,
        file.byteLength,
      );
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
    if (requested === "summary" && !values.length && sheet) {
      const report = await readExcelReportValues(sheet, 200, 30);
      values = report.values;
      truncated = report.truncated;
    }
    const charts =
      current.includeChart && sheet
        ? current.includeChart.checked
          ? await readExcelChartImages(sheet, 3)
          : []
        : [];
    const baseMessage =
      current.body?.value.trim() ||
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
        to: splitEmailAddresses(current.to?.value || ""),
        cc: splitEmailAddresses(current.cc?.value || ""),
        bcc: splitEmailAddresses(current.bcc?.value || ""),
        subject: current.subject?.value.trim() || "VynorAI Excel report",
        body,
        bodyType,
        attachments,
      },
    };
  }

  async function offerOutlookDraft(): Promise<void> {
    const current = elements();
    if (
      !current.draftFallback ||
      !current.draftLink ||
      !current.to ||
      !current.subject
    )
      return;
    let values: any[][] = [];
    let truncated = false;
    try {
      const sheet = reportSheet();
      if (sheet) {
        const report = await readExcelReportValues(sheet, 30, 8);
        values = report.values;
        truncated = report.truncated;
      }
    } catch {
      // The draft still opens with the message only.
    }
    const message =
      current.body?.value.trim() ||
      "Please find the approved VynorAI report summary below.";
    const draft = outlookWebDraftUrl({
      to: splitEmailAddresses(current.to.value),
      cc: splitEmailAddresses(current.cc?.value || ""),
      bcc: splitEmailAddresses(current.bcc?.value || ""),
      subject: current.subject.value.trim() || "VynorAI Excel report",
      body: `${message}\n\n${reportSummaryText(values, truncated)}`,
    });
    current.draftLink.href = draft.url;
    if (current.draftNote)
      current.draftNote.textContent = draft.bodyTruncated
        ? "The summary was shortened for the link. Attach the workbook yourself if you need all of it."
        : "Attachments cannot be added through a link; attach the workbook yourself if you need it.";
    current.draftFallback.hidden = false;
    deps.log.record("email:outlook-draft-link", "pass", {
      recipient: "redacted",
    });
  }

  async function writeAiMessage(): Promise<void> {
    const current = elements();
    if (!current.body || !current.aiWrite) return;
    const sheet = reportSheet();
    if (!sheet) return deps.setStatus("Create a report first.");
    current.aiWrite.disabled = true;
    try {
      const report = await readExcelReportValues(sheet, 200, 30);
      const summary = reportSummaryText(report.values, report.truncated);
      if (
        !(await askInPane(
          reportEmailConsentMessage(summary),
          "Send and write",
          "Cancel",
        ))
      )
        return deps.setStatus("Nothing was sent to AI.");
      deps.setStatus("Writing the message...");
      const response = await deps
        .apiClient()
        .assistText(buildReportEmailRequest(summary, true));
      const answer = validateAssistResult(response?.result);
      current.body.value = answer.text.slice(0, 4000);
      updateUi();
      deps.setStatus(
        "The message was written by AI. Read and edit it before you send the report.",
      );
    } catch (error) {
      deps.setStatus(
        `The message could not be written (${String((error as Error)?.message ?? error).slice(0, 120)}). Write it yourself or try again.`,
      );
    } finally {
      current.aiWrite.disabled = false;
    }
  }

  async function send(): Promise<void> {
    const current = elements();
    if (!current.to || !current.subject || !current.body || !current.send)
      return;
    const to = current.to.value.trim();
    const subject = current.subject.value.trim();
    if (!to || !subject)
      return deps.setStatus("Enter a recipient and subject first.");
    if (
      !(await askInPane(
        `Deliver the reviewed report to ${to}? The selected format may include workbook data, report details and charts.`,
        "Send Excel report",
        undefined,
        emailSendCard(to, subject, deps.getTextLanguage()),
      ))
    )
      return;
    sending = true;
    updateUi();
    try {
      deps.setStatus("Preparing the approved report variants...");
      const prepared = await deps.log.step(
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
      if (current.reportName) {
        const names = (prepared.request.attachments ?? []).map(
          (attachment) => attachment.name,
        );
        current.reportName.textContent = names.join(", ") || "Summary in email";
      }
      if (current.attachmentSize) {
        const bytes = (prepared.request.attachments ?? []).reduce(
          (total, attachment) => total + attachment.bytes,
          0,
        );
        current.attachmentSize.textContent = bytes
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
        current.deliveryMode?.value === "draft" ? "draft" : "send";
      deps.setStatus(
        requiresLargePermission || deliveryMode === "draft"
          ? "Requesting Microsoft draft and large-attachment permission..."
          : "Requesting Microsoft email permission...",
      );
      const config = deps.config;
      const graphToken = await acquireGraphMailToken(
        requiresLargePermission || deliveryMode === "draft"
          ? (config?.graphLargeScopes ?? config?.graphScopes)
          : config?.graphScopes,
      );
      deps.setStatus(
        deliveryMode === "draft"
          ? "Creating and verifying the Outlook draft..."
          : "Sending and verifying the approved report...",
      );
      const delivery = await deps.log.step("email:send-report", () =>
        sendGraphMailAdaptive(
          graphToken,
          prepared.request,
          fetch,
          deliveryMode,
        ),
      );
      deps.log.record("email:send", "pass", {
        recipient: "redacted",
        delivery,
        format: prepared.format,
        attachments: prepared.request.attachments?.length ?? 0,
      });
      deps.setStatus(
        deliveryMode === "draft"
          ? `Outlook draft created for ${to} and verified by Microsoft Graph.`
          : `Report sent to ${to} and verified by Microsoft Graph.`,
      );
      if (current.deliveryStatus) {
        current.deliveryStatus.className = "delivery-status sent";
        current.deliveryStatus.textContent =
          deliveryMode === "draft"
            ? "Draft created · verified by Microsoft Graph"
            : "Sent · verified by Microsoft Graph";
      }
    } catch (error) {
      deps.log.record("email:send", "fail", emailErrorMessage(error));
      if (isGraphConsentFailure(error)) {
        await offerOutlookDraft();
        deps.setStatus(
          "Microsoft did not give this add-in permission to send mail (your organization's administrator may need to approve it). Nothing was sent. Use the link below to open the report as a draft in Outlook on the web.",
        );
      } else deps.setStatus(emailErrorMessage(error));
      if (current.deliveryStatus) {
        current.deliveryStatus.className = "delivery-status failed";
        current.deliveryStatus.textContent =
          "Not sent · review the error and retry";
      }
    } finally {
      sending = false;
      updateUi();
    }
  }

  function bind(): void {
    elements().to?.addEventListener("input", () => updateUi());
    elements().subject?.addEventListener("input", () => updateUi());
    elements().aiWrite?.addEventListener("click", () => void writeAiMessage());
    elements().send?.addEventListener("click", () => void send());
  }

  return { hasReport: deps.hasReport, updateUi, prepare, bind };
}
