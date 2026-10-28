import { kindTitle } from "./outcome.js";
import { buildResultEvidence } from "./resultEvidence.js";
import { localizeMessage, translate, type Language } from "./i18n.js";
import {
  rollbackCreatedItems,
  rollbackItemsFromApplyReport,
  revealExcelResult,
  type ExcelActionResult,
} from "./officeExcel.js";
import { removeResultsCard } from "./dialogCards.js";
import { askInPane } from "./confirmDialog.js";
import type { M365ApiClient } from "./api.js";
import type { DiagnosticsLog } from "./diagnostics.js";

export type ResultRollbackItems = {
  planId: string;
  sheets: string[];
  tables: string[];
  names: string[];
};

export interface ResultGalleryControllerDeps {
  document: Document;
  rollbackButton: HTMLButtonElement | null;
  instruction: HTMLTextAreaElement | HTMLInputElement | null;
  getLanguage: () => Language;
  getTextLanguage: () => Language;
  getPlanId: () => string;
  getResults: () => readonly ExcelActionResult[];
  setResults: (results: ExcelActionResult[]) => void;
  getLastCreated: () => ResultRollbackItems | undefined;
  setLastCreated: (items: ResultRollbackItems | undefined) => void;
  getLastRevealSheet: () => string;
  setLastRevealSheet: (sheet: string) => void;
  getCurrentRequest: () => string;
  getCurrentRange: () => string;
  resetPreview: () => void;
  inspect: () => void;
  prepareEmail: () => void;
  persist: () => void;
  updateEmailUi: () => void;
  renderChanged: (lines: string[]) => void;
  markChangeNote: (action: "undone") => void;
  setStatus: (message: string) => void;
  handleApiError: (step: string, error: unknown) => void;
  officeRuntime: () => any;
  apiClient: () => M365ApiClient;
  listVynorSheets: (runtime: any) => Promise<string[]>;
  askInPane: typeof askInPane;
  log: DiagnosticsLog;
}

export function createResultGalleryController(
  deps: ResultGalleryControllerDeps,
) {
  async function replaceOlderResultSheets(keepSheet: string): Promise<void> {
    if (
      !(await deps.askInPane(
        localizeMessage(
          deps.getLanguage(),
          "Remove older VynorAI result sheets and keep this result? Your original data is not touched.",
        ),
        localizeMessage(deps.getLanguage(), "Replace"),
      ))
    ) {
      deps.log.record("gallery:replace", "skip", "user cancelled");
      return;
    }
    try {
      const older = (await deps.listVynorSheets(deps.officeRuntime())).filter(
        (sheet) => sheet !== keepSheet,
      );
      if (!older.length) {
        deps.setStatus("No older VynorAI result sheets found.");
        return;
      }
      const removed = await rollbackCreatedItems(
        deps.officeRuntime(),
        { sheets: older, tables: [] },
        true,
      );
      await deps
        .apiClient()
        .reportRollback({
          planId: deps.getPlanId(),
          removedSheets: Math.min(10, removed.removedSheets.length),
          convertedTables: 0,
          removedNames: 0,
        })
        .catch((error) =>
          deps.log.record("api:gallery-replace", "fail", String(error)),
        );
      const remaining = deps
        .getResults()
        .filter((result) => result.targetSheet === keepSheet);
      deps.setResults(remaining);
      deps.persist();
      render();
      deps.renderChanged([
        ...remaining.map((result) => `${result.kind} - ${result.targetSheet}`),
        `Removed ${removed.removedSheets.length} older VynorAI result sheet(s).`,
      ]);
      deps.setStatus(
        `Removed ${removed.removedSheets.length} older result sheet(s).`,
      );
      deps.log.record("gallery:replace", "pass", {
        removedSheets: removed.removedSheets.length,
      });
    } catch (error) {
      deps.handleApiError("gallery:replace", error);
    }
  }

  function render(): void {
    const gallery = deps.document.querySelector<HTMLElement>("#result-gallery");
    const list = deps.document.querySelector<HTMLElement>(
      "#result-gallery-list",
    );
    const operationHistory =
      deps.document.querySelector<HTMLElement>("#operation-history");
    const verifiedBanner = deps.document.querySelector<HTMLElement>(
      "#verified-result-banner",
    );
    if (!gallery || !list) return;
    list.replaceChildren();
    const visible = deps
      .getResults()
      .filter(
        (result) => result.status === "created" || result.status === "exists",
      );
    gallery.hidden = visible.length === 0;
    if (operationHistory) operationHistory.hidden = visible.length === 0;
    if (verifiedBanner) verifiedBanner.hidden = visible.length === 0;
    const safetySummary =
      deps.document.querySelector<HTMLElement>(".safety-summary");
    if (safetySummary) safetySummary.hidden = visible.length > 0;
    for (const result of visible) {
      const item = deps.document.createElement("article");
      item.className = "result-item";
      const head = deps.document.createElement("div");
      head.className = "result-item-head";
      const title = deps.document.createElement("strong");
      title.textContent = kindTitle(result.kind, deps.getTextLanguage());
      const target = deps.document.createElement("span");
      target.className = "verified-badge";
      target.textContent = `Verified · ${result.targetSheet}`;
      head.append(title, target);
      const summary = deps.document.createElement("p");
      summary.className = "result-item-summary";
      summary.textContent = `Saved on ${result.targetSheet}. Verified by reading the result back from Excel.`;
      const actions = deps.document.createElement("div");
      actions.className = "result-item-actions";
      const show = deps.document.createElement("button");
      show.type = "button";
      show.className = "result-primary-action";
      show.textContent = translate(
        deps.getLanguage(),
        "show_result",
        "Show result",
      );
      show.addEventListener("click", () => {
        void revealExcelResult(deps.officeRuntime(), result.targetSheet);
      });
      actions.appendChild(show);
      const evidence = deps.document.createElement("details");
      evidence.className = "result-evidence";
      const evidenceSummary = deps.document.createElement("summary");
      evidenceSummary.textContent = "Show evidence";
      const evidenceList = deps.document.createElement("ul");
      for (const line of buildResultEvidence({
        request: result.request ?? deps.getCurrentRequest(),
        sourceRange: result.sourceRange ?? deps.getCurrentRange(),
        result,
      })) {
        const row = deps.document.createElement("li");
        row.textContent = line;
        evidenceList.appendChild(row);
      }
      evidence.append(evidenceSummary, evidenceList);
      const more = deps.document.createElement("details");
      more.className = "result-more-actions";
      const moreSummary = deps.document.createElement("summary");
      moreSummary.textContent = "More actions";
      const moreActions = deps.document.createElement("div");
      moreActions.className = "result-more-actions-list";
      const share = deps.document.createElement("button");
      share.type = "button";
      share.textContent = translate(
        deps.getLanguage(),
        "email_report",
        "Email report",
      );
      share.addEventListener("click", () => {
        deps.setLastRevealSheet(result.targetSheet);
        deps.prepareEmail();
      });
      moreActions.appendChild(share);
      const refresh = deps.document.createElement("button");
      refresh.type = "button";
      refresh.textContent = translate(
        deps.getLanguage(),
        "refresh_result",
        "Refresh",
      );
      refresh.disabled = !deps.instruction?.value.trim();
      refresh.title = refresh.disabled
        ? "Enter the original request again to refresh this result."
        : "Create a fresh preview from the current request.";
      refresh.addEventListener("click", () => {
        if (!deps.instruction?.value.trim()) {
          deps.setStatus(
            "Enter the request again before refreshing this result.",
          );
          return;
        }
        deps.resetPreview();
        deps.setStatus(
          "Refreshing the preview. Nothing changes until you confirm.",
        );
        deps.instruction.focus();
        deps.inspect();
      });
      moreActions.appendChild(refresh);
      if (result.status === "created") {
        const undo = deps.document.createElement("button");
        undo.type = "button";
        undo.textContent = translate(deps.getLanguage(), "undo", "Undo");
        undo.addEventListener("click", () => void undoResult(result));
        moreActions.appendChild(undo);
      }
      const replace = deps.document.createElement("button");
      replace.type = "button";
      replace.textContent = translate(
        deps.getLanguage(),
        "cleanup",
        "Replace older",
      );
      replace.addEventListener(
        "click",
        () => void replaceOlderResultSheets(result.targetSheet),
      );
      moreActions.appendChild(replace);
      more.append(moreSummary, moreActions);
      actions.appendChild(more);
      item.append(head, summary, actions, evidence);
      list.appendChild(item);
    }
  }

  async function undoResult(result: ExcelActionResult): Promise<void> {
    const sameSheet = deps
      .getResults()
      .filter(
        (candidate) =>
          candidate.targetSheet === result.targetSheet &&
          candidate.status === "created",
      );
    if (
      !(await deps.askInPane(
        localizeMessage(
          deps.getLanguage(),
          "Remove this VynorAI result? Your original data is not touched.",
        ),
        localizeMessage(deps.getLanguage(), "Remove"),
      ))
    )
      return;
    try {
      const removed = await rollbackCreatedItems(
        deps.officeRuntime(),
        rollbackItemsFromApplyReport(deps.getPlanId(), sameSheet),
        true,
      );
      await deps
        .apiClient()
        .reportRollback({
          planId: deps.getPlanId(),
          removedSheets: Math.min(10, removed.removedSheets.length),
          convertedTables: Math.min(1, removed.convertedTables.length),
          removedNames: Math.min(10, removed.removedNames.length),
        })
        .catch((error) =>
          deps.log.record("api:gallery-undo", "fail", String(error)),
        );
      const remaining = deps
        .getResults()
        .filter((candidate) => candidate.targetSheet !== result.targetSheet);
      deps.setResults(remaining);
      deps.persist();
      deps.setLastCreated(
        rollbackItemsFromApplyReport(
          deps.getPlanId(),
          remaining.filter((candidate) => candidate.status === "created"),
        ),
      );
      render();
      deps.markChangeNote("undone");
      deps.setStatus(
        `Removed ${removed.removedSheets.length} result sheet(s).`,
      );
    } catch (error) {
      deps.handleApiError("gallery:undo", error);
    }
  }

  function bindRollback(): void {
    deps.rollbackButton?.addEventListener("click", async () => {
      const items = deps.getLastCreated();
      if (!items) return;
      if (
        !(await deps.askInPane(
          localizeMessage(
            deps.getLanguage(),
            "Remove the result sheets and Table this add-in created? Your original data is not touched.",
          ),
          localizeMessage(deps.getLanguage(), "Remove"),
          undefined,
          removeResultsCard(items, deps.getLanguage()),
        ))
      ) {
        deps.log.record("rollback:confirm", "skip", "user cancelled");
        return;
      }
      try {
        const report = await deps.log.step("excel:rollback", () =>
          rollbackCreatedItems(deps.officeRuntime(), items, true),
        );
        await deps
          .apiClient()
          .reportRollback({
            planId: items.planId,
            removedSheets: Math.min(10, report.removedSheets.length),
            convertedTables: Math.min(1, report.convertedTables.length),
            removedNames: Math.min(10, report.removedNames.length),
          })
          .catch((error) =>
            deps.log.record("api:rollback", "fail", String(error)),
          );
        deps.setLastCreated(undefined);
        deps.setResults([]);
        deps.persist();
        render();
        if (deps.rollbackButton) deps.rollbackButton.hidden = true;
        deps.updateEmailUi();
        deps.markChangeNote("undone");
        deps.renderChanged([]);
        deps.setStatus(
          `Removed ${report.removedSheets.length} sheet(s), ${report.removedNames.length} named range(s), and converted ${report.convertedTables.length} table(s) back to a range.`,
        );
      } catch (error) {
        deps.handleApiError("rollback", error);
      }
    });
  }

  return { render, replaceOlderResultSheets, bindRollback };
}
