export interface ShareViewElements {
  card: HTMLElement | null;
  note: HTMLElement | null;
  to: HTMLInputElement | null;
  subject: HTMLInputElement | null;
  body: HTMLTextAreaElement | null;
  send: HTMLButtonElement | null;
}

export function updateShareView(
  elements: ShareViewElements,
  options: {
    signedIn: boolean;
    hasReport: boolean;
    configured: boolean;
    sending: boolean;
  },
): void {
  const available = options.signedIn && options.hasReport;
  if (elements.card) elements.card.hidden = !available;
  if (elements.note && available) {
    elements.note.textContent = options.configured
      ? "Choose XLSX, PDF, CSV, summary or automatic fallback. Charts and bounded report details stay local until you approve Send."
      : "Email is not configured for this deployment. An administrator must add the Microsoft Graph Mail.Send delegated permission to runtime-config.js.";
  }
  if (elements.send) {
    elements.send.disabled =
      !available ||
      !options.configured ||
      options.sending ||
      !elements.to?.value.trim() ||
      !elements.subject?.value.trim();
  }
}

export function prepareShareComposer(
  elements: ShareViewElements,
  options: { recipient?: string; reportSheet: string },
): void {
  if (elements.to && options.recipient && !elements.to.value)
    elements.to.value = options.recipient;
  if (elements.subject && !elements.subject.value)
    elements.subject.value = `VynorAI Excel report - ${options.reportSheet || "Workbook"}`;
  if (elements.body && !elements.body.value)
    elements.body.value =
      "Please find the approved VynorAI Excel report attached.";
  elements.card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  elements.to?.focus();
}
