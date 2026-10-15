import { M365ApiError, type M365ApiClient } from "./api.js";
import { askInPane } from "./confirmDialog.js";
import {
  DraftConsentError,
  buildDraftRequest,
  describeOps,
  draftToOps,
  insertOps,
  lettersToOps,
  newDraftTag,
  parseDelimited,
  planMerge,
  removeLastInserted,
  validateDraft,
  type DocumentDraft,
  type DraftKind,
  type WordRuntimeLike,
} from "./wordDraft.js";

export interface WordPanelDeps {
  client(): M365ApiClient | undefined;
  setStatus(message: string): void;
  readSelection(): Promise<string>;
}

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

const wordRuntime: WordRuntimeLike = {
  run: (callback) => (globalThis as any).Word.run(callback),
};

function value(selector: string): string {
  return (
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
      ?.value ?? ""
  );
}

export function initWordPanels(deps: WordPanelDeps): void {
  const modes = $("#modes");
  const panels: Record<string, HTMLElement | null> = {
    assist: $("#mode-assist"),
    draft: $("#mode-draft"),
    merge: $("#mode-merge"),
  };
  if (modes) modes.hidden = false;
  const show = (name: string) => {
    for (const [key, panel] of Object.entries(panels))
      if (panel) panel.hidden = key !== name;
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "#modes button[data-mode]",
    ))
      button.setAttribute("aria-pressed", String(button.dataset.mode === name));
  };
  modes?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-mode]",
    );
    if (target?.dataset.mode) show(target.dataset.mode);
  });
  show("assist");

  // ---------------------------------------------------------------- Draft
  const kind = $<HTMLSelectElement>("#draft-kind");
  const memoFields = $("#memo-fields");
  const outline = $<HTMLElement>("#draft-outline");
  const generate = $<HTMLButtonElement>("#draft-generate");
  const insert = $<HTMLButtonElement>("#draft-insert");
  const removeButton = $<HTMLButtonElement>("#draft-remove");
  const draftConsent = $<HTMLInputElement>("#draft-consent");
  let current: DocumentDraft | undefined;

  const syncKind = () => {
    if (memoFields) memoFields.hidden = kind?.value !== "memo";
  };
  kind?.addEventListener("change", syncKind);
  syncKind();

  generate?.addEventListener("click", async () => {
    const client = deps.client();
    if (!client) return deps.setStatus("Sign in first.");
    try {
      const request = buildDraftRequest({
        kind: (kind?.value || "report") as DraftKind,
        title: value("#draft-title"),
        brief: value("#draft-brief"),
        audience: value("#draft-audience"),
        tone: (value("#draft-tone") || undefined) as
          | "formal"
          | "friendly"
          | "concise"
          | undefined,
        length: (value("#draft-length") || "standard") as
          | "short"
          | "standard"
          | "detailed",
        language: (value("#draft-language") || "auto") as
          | "auto"
          | "en"
          | "si"
          | "ta",
        includeTable: $<HTMLInputElement>("#draft-table")?.checked === true,
        memo: {
          to: value("#memo-to"),
          from: value("#memo-from"),
          subject: value("#memo-subject"),
        },
        consent: draftConsent?.checked === true,
      });
      generate.disabled = true;
      deps.setStatus("Drafting... this can take up to a minute.");
      const response = await client.draftDocument(request);
      current = validateDraft(response?.draft);
      if (outline)
        outline.textContent = describeOps(draftToOps(current, new Date()));
      if (insert) insert.disabled = false;
      // Consent covers exactly one send.
      if (draftConsent) draftConsent.checked = false;
      deps.setStatus(
        "Draft ready. Read it below. Nothing is in your document yet.",
      );
    } catch (error) {
      current = undefined;
      if (insert) insert.disabled = true;
      if (error instanceof DraftConsentError)
        deps.setStatus("Tick the box to agree before the brief is sent.");
      else if (error instanceof M365ApiError)
        deps.setStatus(
          error.code === "AI_DISABLED_BY_ADMIN"
            ? "AI assistance is turned off for your organization."
            : error.code === "AI_DRAFT_INVALID"
              ? "The draft did not match the safe format. Nothing was inserted. Try again."
              : `Request failed (${error.code}).`,
        );
      else if ((error as Error).message === "AI_DRAFT_INVALID")
        deps.setStatus(
          "The draft did not match the safe format. Nothing was inserted. Try again.",
        );
      else deps.setStatus((error as Error).message);
    } finally {
      if (generate) generate.disabled = false;
    }
  });

  insert?.addEventListener("click", async () => {
    if (!current) return;
    const ok = await askInPane(
      "Add this document to the end of your file? Your existing text is not changed. You can remove it afterwards.",
      "Add",
    );
    if (!ok) return deps.setStatus("Cancelled. Nothing was added.");
    try {
      deps.setStatus("Adding to your document...");
      const ops = draftToOps(current, new Date());
      await insertOps(wordRuntime, ops, {
        tag: newDraftTag(),
        title: current.title,
        confirmed: true,
      });
      deps.setStatus(
        "Added at the end of the document. Use Remove last draft to take it out again.",
      );
    } catch (error) {
      deps.setStatus((error as Error).message);
    }
  });

  const removeLast = async () => {
    const ok = await askInPane(
      "Remove the last block this add-in added? Nothing else in your document is touched.",
      "Remove",
    );
    if (!ok) return deps.setStatus("Cancelled. Nothing was removed.");
    try {
      const report = await removeLastInserted(wordRuntime, true);
      deps.setStatus(
        report.removed
          ? "Removed the last block added by VynorAI."
          : "There is nothing from VynorAI to remove.",
      );
    } catch (error) {
      deps.setStatus((error as Error).message);
    }
  };
  removeButton?.addEventListener("click", removeLast);

  // ---------------------------------------------------------------- Mail merge
  const useSelection = $<HTMLButtonElement>("#merge-use-selection");
  const previewButton = $<HTMLButtonElement>("#merge-preview");
  const mergeInsert = $<HTMLButtonElement>("#merge-insert");
  const mergeRemove = $<HTMLButtonElement>("#merge-remove");
  const summary = $<HTMLElement>("#merge-summary");
  const sample = $<HTMLElement>("#merge-sample");
  let letters: string[] = [];

  useSelection?.addEventListener("click", async () => {
    try {
      const text = await deps.readSelection();
      const template = $<HTMLTextAreaElement>("#merge-template");
      if (template) template.value = text;
      deps.setStatus(
        text.trim()
          ? "Template read from your selection."
          : "Nothing is selected.",
      );
    } catch (error) {
      deps.setStatus((error as Error).message);
    }
  });

  previewButton?.addEventListener("click", () => {
    try {
      const table = parseDelimited(value("#merge-data"));
      const plan = planMerge(value("#merge-template"), table);
      letters = plan.letters;
      const problems: string[] = [];
      if (plan.missingFields.length)
        problems.push(
          `No column for: ${plan.missingFields.map((name) => `{{${name}}}`).join(", ")}. Fix the template or the headers.`,
        );
      if (plan.emptyValues)
        problems.push(`${plan.emptyValues} empty value(s) will be left blank.`);
      if (plan.unusedColumns.length)
        problems.push(`Not used: ${plan.unusedColumns.join(", ")}.`);
      if (summary)
        summary.textContent = [
          `${letters.length} letter(s), fields: ${plan.fields.join(", ")}.`,
          ...problems,
        ].join(" ");
      if (sample) sample.textContent = letters[0] ?? "";
      const blocked = plan.missingFields.length > 0;
      if (mergeInsert) mergeInsert.disabled = blocked;
      deps.setStatus(
        blocked
          ? "Some placeholders have no matching column."
          : "Preview ready. Nothing is in your document yet.",
      );
    } catch (error) {
      letters = [];
      if (mergeInsert) mergeInsert.disabled = true;
      if (summary) summary.textContent = "";
      if (sample) sample.textContent = "";
      deps.setStatus((error as Error).message);
    }
  });

  mergeInsert?.addEventListener("click", async () => {
    if (letters.length === 0) return;
    const ok = await askInPane(
      `Add ${letters.length} letter(s) to the end of your file, one per page? Your existing text is not changed.`,
      "Add",
    );
    if (!ok) return deps.setStatus("Cancelled. Nothing was added.");
    try {
      deps.setStatus("Adding the letters to your document...");
      await insertOps(wordRuntime, lettersToOps(letters), {
        tag: newDraftTag(),
        title: `Mail merge (${letters.length})`,
        confirmed: true,
      });
      deps.setStatus(
        `Added ${letters.length} letter(s) at the end. Nothing was sent to anyone.`,
      );
    } catch (error) {
      deps.setStatus((error as Error).message);
    }
  });
  mergeRemove?.addEventListener("click", removeLast);
}
