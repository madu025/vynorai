export const EXCEL_WORKBOOK_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PDF_MIME = "application/pdf";
export const CSV_MIME = "text/csv;charset=utf-8";
export const JPEG_MIME = "image/jpeg";
export const GRAPH_SEND_MAIL_URL =
  "https://graph.microsoft.com/v1.0/me/sendMail";
export const GRAPH_MESSAGES_URL =
  "https://graph.microsoft.com/v1.0/me/messages";
export const MAX_DIRECT_ATTACHMENT_BYTES = 3_000_000;
export const MAX_OUTLOOK_ATTACHMENT_BYTES = 150_000_000;
export const GRAPH_UPLOAD_CHUNK_BYTES = 320 * 1024;
/** Backward-compatible name used by the first XLSX-only release. */
export const MAX_EXCEL_EMAIL_BYTES = MAX_DIRECT_ATTACHMENT_BYTES;

export type GraphBodyType = "Text" | "HTML";
export type GraphDeliveryMode = "send" | "draft";

export interface GraphMailAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
  bytes: number;
  isInline?: boolean;
  contentId?: string;
}

export interface GraphMailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyType?: GraphBodyType;
  attachments?: GraphMailAttachment[];
  saveToSentItems?: boolean;
}

/** Compatibility input for the original single-XLSX email button. */
export interface ExcelEmailRequest {
  to: string;
  subject: string;
  body: string;
  attachmentName: string;
  attachmentBase64: string;
  attachmentBytes: number;
}

export interface GraphMailFetcher {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

function validAddress(address: string): boolean {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(
    address,
  );
}

function validateRecipients(
  label: string,
  values: string[] | undefined,
): string[] {
  const normalized = (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (normalized.length > 20) throw new Error("EMAIL_RECIPIENT_LIMIT");
  if (normalized.some((value) => /[\r\n]/.test(value) || !validAddress(value)))
    throw new Error(`EMAIL_${label.toUpperCase()}_INVALID`);
  return normalized;
}

function validateAttachment(
  attachment: GraphMailAttachment,
): GraphMailAttachment {
  const name = attachment.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\.[A-Za-z0-9]{1,12}$/i.test(name))
    throw new Error("EMAIL_ATTACHMENT_NAME_INVALID");
  if (
    !Number.isInteger(attachment.bytes) ||
    attachment.bytes < 1 ||
    attachment.bytes > MAX_OUTLOOK_ATTACHMENT_BYTES
  )
    throw new Error(
      attachment.bytes > MAX_OUTLOOK_ATTACHMENT_BYTES
        ? "EMAIL_ATTACHMENT_TOO_LARGE"
        : "EMAIL_ATTACHMENT_INVALID",
    );
  if (
    !attachment.contentBytes ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.contentBytes)
  )
    throw new Error("EMAIL_ATTACHMENT_INVALID");
  if (base64ByteLength(attachment.contentBytes) !== attachment.bytes)
    throw new Error("EMAIL_ATTACHMENT_SIZE_MISMATCH");
  if (attachment.isInline && !attachment.contentId)
    throw new Error("EMAIL_INLINE_CONTENT_ID_MISSING");
  return { ...attachment, name };
}

function base64ByteLength(value: string): number {
  return Math.max(
    0,
    Math.floor((value.length * 3) / 4) -
      (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
}

export function validateGraphMailRequest(
  request: GraphMailRequest,
): GraphMailRequest {
  const to = validateRecipients("recipient", request.to);
  if (!to.length) throw new Error("EMAIL_RECIPIENT_INVALID");
  const cc = validateRecipients("cc", request.cc);
  const bcc = validateRecipients("bcc", request.bcc);
  const subject = request.subject.trim();
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject))
    throw new Error("EMAIL_SUBJECT_INVALID");
  const body = request.body.trim();
  if (body.length > 100_000 || /<script\b|javascript:/i.test(body))
    throw new Error("EMAIL_BODY_INVALID");
  const attachments = (request.attachments ?? []).map(validateAttachment);
  return {
    ...request,
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject,
    body,
    bodyType: request.bodyType ?? "Text",
    attachments,
    saveToSentItems: request.saveToSentItems ?? true,
  };
}

function recipientPayload(values: string[]) {
  return values.map((address) => ({ emailAddress: { address } }));
}

export function buildGraphMail(request: GraphMailRequest) {
  const valid = validateGraphMailRequest(request);
  return {
    message: {
      subject: valid.subject,
      body: { contentType: valid.bodyType, content: valid.body },
      toRecipients: recipientPayload(valid.to),
      ...(valid.cc?.length ? { ccRecipients: recipientPayload(valid.cc) } : {}),
      ...(valid.bcc?.length
        ? { bccRecipients: recipientPayload(valid.bcc) }
        : {}),
      ...(valid.attachments?.length
        ? {
            attachments: valid.attachments.map((attachment) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachment.name,
              contentType: attachment.contentType,
              contentBytes: attachment.contentBytes,
              ...(attachment.isInline
                ? { isInline: true, contentId: attachment.contentId }
                : {}),
            })),
          }
        : {}),
    },
    saveToSentItems: valid.saveToSentItems,
  };
}

export function validateExcelEmailRequest(
  request: ExcelEmailRequest,
): ExcelEmailRequest {
  if (!/\.xlsx$/i.test(request.attachmentName.trim()))
    throw new Error("EMAIL_ATTACHMENT_NAME_INVALID");
  const valid = validateGraphMailRequest({
    to: [request.to],
    subject: request.subject,
    body: request.body,
    attachments: [
      {
        name: request.attachmentName,
        contentType: EXCEL_WORKBOOK_MIME,
        contentBytes: request.attachmentBase64,
        bytes: request.attachmentBytes,
      },
    ],
  });
  const attachment = valid.attachments?.[0];
  if (!attachment || attachment.bytes > MAX_DIRECT_ATTACHMENT_BYTES)
    throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
  return {
    ...request,
    to: valid.to[0],
    subject: valid.subject,
    body: valid.body,
    attachmentName: attachment.name,
  };
}

export function buildGraphExcelMail(request: ExcelEmailRequest) {
  const validRequest = validateExcelEmailRequest(request);
  return buildGraphMail({
    to: [validRequest.to],
    subject: validRequest.subject,
    body: validRequest.body,
    bodyType: "Text",
    attachments: [
      {
        name: validRequest.attachmentName,
        contentType: EXCEL_WORKBOOK_MIME,
        contentBytes: validRequest.attachmentBase64,
        bytes: validRequest.attachmentBytes,
      },
    ],
  });
}

function authHeaders(accessToken: string): Record<string, string> {
  if (!accessToken) throw new Error("EMAIL_ACCESS_TOKEN_MISSING");
  return { authorization: `Bearer ${accessToken}` };
}

async function graphJson(
  accessToken: string,
  fetcher: GraphMailFetcher,
  url: string,
  init: RequestInit,
): Promise<any> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      ...authHeaders(accessToken),
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("EMAIL_PERMISSION_DENIED");
    if (response.status === 413) throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
    throw new Error(`EMAIL_GRAPH_FAILED_${response.status}`);
  }
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob !== "function") throw new Error("EMAIL_BASE64_UNAVAILABLE");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function needsUploadSession(request: GraphMailRequest): boolean {
  const attachments = request.attachments ?? [];
  return (
    attachments.some(
      (attachment) => attachment.bytes >= MAX_DIRECT_ATTACHMENT_BYTES,
    ) ||
    attachments.reduce((total, attachment) => total + attachment.bytes, 0) >=
      MAX_DIRECT_ATTACHMENT_BYTES
  );
}

async function sendDirectGraphMail(
  accessToken: string,
  request: GraphMailRequest,
  fetcher: GraphMailFetcher,
): Promise<void> {
  const valid = validateGraphMailRequest(request);
  const response = await fetcher(GRAPH_SEND_MAIL_URL, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken),
      "content-type": "application/json",
    },
    body: JSON.stringify(buildGraphMail(valid)),
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("EMAIL_PERMISSION_DENIED");
    if (response.status === 413) throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
    throw new Error(`EMAIL_SEND_FAILED_${response.status}`);
  }
}

async function uploadGraphAttachment(
  accessToken: string,
  draftId: string,
  attachment: GraphMailAttachment,
  fetcher: GraphMailFetcher,
): Promise<void> {
  const session = await graphJson(
    accessToken,
    fetcher,
    `${GRAPH_MESSAGES_URL}/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.name,
          size: attachment.bytes,
          ...(attachment.isInline
            ? { isInline: true, contentId: attachment.contentId }
            : {}),
        },
      }),
    },
  );
  if (typeof session.uploadUrl !== "string" || !session.uploadUrl)
    throw new Error("EMAIL_UPLOAD_SESSION_INVALID");
  const bytes = base64ToBytes(attachment.contentBytes);
  for (let start = 0; start < bytes.length; start += GRAPH_UPLOAD_CHUNK_BYTES) {
    const end = Math.min(bytes.length, start + GRAPH_UPLOAD_CHUNK_BYTES) - 1;
    const chunk = bytes.slice(start, end + 1);
    const response = await fetcher(session.uploadUrl, {
      method: "PUT",
      headers: {
        "content-length": String(chunk.byteLength),
        "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
      },
      body: chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength,
      ) as ArrayBuffer,
    });
    if (!response.ok) throw new Error(`EMAIL_UPLOAD_FAILED_${response.status}`);
  }
}

async function sendThroughGraphDraft(
  accessToken: string,
  request: GraphMailRequest,
  fetcher: GraphMailFetcher,
  deliveryMode: GraphDeliveryMode = "send",
): Promise<void> {
  const valid = validateGraphMailRequest(request);
  const draft = await graphJson(accessToken, fetcher, GRAPH_MESSAGES_URL, {
    method: "POST",
    body: JSON.stringify({
      subject: valid.subject,
      body: { contentType: valid.bodyType, content: valid.body },
      toRecipients: recipientPayload(valid.to),
      ...(valid.cc?.length ? { ccRecipients: recipientPayload(valid.cc) } : {}),
      ...(valid.bcc?.length
        ? { bccRecipients: recipientPayload(valid.bcc) }
        : {}),
    }),
  });
  if (typeof draft.id !== "string" || !draft.id)
    throw new Error("EMAIL_DRAFT_INVALID");
  for (const attachment of valid.attachments ?? [])
    await uploadGraphAttachment(accessToken, draft.id, attachment, fetcher);
  if (deliveryMode === "send")
    await graphJson(
      accessToken,
      fetcher,
      `${GRAPH_MESSAGES_URL}/${encodeURIComponent(draft.id)}/send`,
      { method: "POST", body: "{}" },
    );
}

/** Sends directly when possible and switches to a resumable draft for large attachments. */
export async function sendGraphMailAdaptive(
  accessToken: string,
  request: GraphMailRequest,
  fetcher: GraphMailFetcher = fetch,
  deliveryMode: GraphDeliveryMode = "send",
): Promise<"direct" | "upload-session" | "draft"> {
  const valid = validateGraphMailRequest(request);
  if (
    valid.attachments?.some(
      (attachment) => attachment.bytes > MAX_OUTLOOK_ATTACHMENT_BYTES,
    )
  )
    throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
  if (deliveryMode === "send" && !needsUploadSession(valid)) {
    await sendDirectGraphMail(accessToken, valid, fetcher);
    return "direct";
  }
  try {
    await sendThroughGraphDraft(accessToken, valid, fetcher, deliveryMode);
  } catch (error) {
    if (error instanceof Error && /403|PERMISSION_DENIED/.test(error.message))
      throw new Error("EMAIL_LARGE_ATTACHMENT_PERMISSION_REQUIRED");
    throw error;
  }
  return deliveryMode === "draft" ? "draft" : "upload-session";
}

export async function sendExcelWorkbookEmail(
  accessToken: string,
  request: ExcelEmailRequest,
  fetcher: GraphMailFetcher = fetch,
): Promise<void> {
  const validRequest = validateExcelEmailRequest(request);
  const valid = validateGraphMailRequest({
    to: [validRequest.to],
    subject: validRequest.subject,
    body: validRequest.body,
    attachments: [
      {
        name: validRequest.attachmentName,
        contentType: EXCEL_WORKBOOK_MIME,
        contentBytes: validRequest.attachmentBase64,
        bytes: validRequest.attachmentBytes,
      },
    ],
  });
  await sendDirectGraphMail(accessToken, valid, fetcher);
}

export const OUTLOOK_WEB_COMPOSE_URL =
  "https://outlook.office.com/mail/deeplink/compose";
/** Outlook on the web reads the whole compose link, so it is kept well under common URL limits. */
const MAX_COMPOSE_URL_LENGTH = 6000;

/**
 * A link that opens a new message in Outlook on the web with the recipients, subject and a text body
 * already filled in. It needs no Microsoft Graph permission, so it works where an administrator has not
 * approved Mail.Send. Attachments cannot be passed through a link; the body carries the summary only.
 */
export function outlookWebDraftUrl(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): { url: string; bodyTruncated: boolean } {
  const build = (body: string) => {
    const parts = [
      ["to", input.to.join(",")],
      ["cc", (input.cc ?? []).join(",")],
      ["bcc", (input.bcc ?? []).join(",")],
      ["subject", input.subject],
      ["body", body],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
    return `${OUTLOOK_WEB_COMPOSE_URL}?${parts.join("&")}`;
  };
  let body = input.body;
  let url = build(body);
  let bodyTruncated = false;
  while (url.length > MAX_COMPOSE_URL_LENGTH && body.length > 40) {
    body = `${body.slice(0, Math.max(40, Math.floor(body.length * 0.8)))}…`;
    bodyTruncated = true;
    url = build(body);
  }
  return { url, bodyTruncated };
}

/** True when the failure is Microsoft refusing the Graph permission (admin approval, denied or cancelled consent). */
export function isGraphConsentFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /OAuth authorization failed: (access_denied|consent_required|interaction_required|invalid_scope|unauthorized_client)|AADSTS(65001|65004|90094|90095|900941|50105)|EMAIL_PERMISSION_DENIED|EMAIL_LARGE_ATTACHMENT_PERMISSION_REQUIRED|Graph.*\b(401|403)\b/i.test(
    text,
  );
}
