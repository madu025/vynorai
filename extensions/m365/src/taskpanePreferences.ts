import {
  CHANGE_LOG_SHEET,
  changeLogRows,
  type ChangeLogEntry,
} from "./changeLog.js";
import type { DiagnosticStatus } from "./diagnostics.js";
import { appendChangeLog } from "./officeSriLanka.js";
import {
  describePreferences,
  learnFromRequest,
  parsePreferences,
  PREFERENCES_KEY,
  type WorkbookPreferences,
} from "./preferences.js";

export interface WorkbookPreferencesControllerDeps {
  document: Document;
  office: () => any;
  officeRuntime: () => any;
  workbookStorageFingerprint: () => string | undefined;
  getPreferences: () => WorkbookPreferences;
  setPreferences: (value: WorkbookPreferences) => void;
  setStatus: (message: string) => void;
  record: (step: string, status: DiagnosticStatus, detail?: unknown) => void;
}

export interface WorkbookPreferencesController {
  load(): WorkbookPreferences;
  save(next: WorkbookPreferences): void;
  learn(request: string): void;
  render(): void;
  update(change: Partial<WorkbookPreferences>): void;
  logChanges(entry: ChangeLogEntry): Promise<void>;
  bind(): void;
}

export function createWorkbookPreferencesController(
  deps: WorkbookPreferencesControllerDeps,
): WorkbookPreferencesController {
  const { document } = deps;
  const fallbackKey = () => {
    const workbook = deps.workbookStorageFingerprint();
    return workbook ? `${PREFERENCES_KEY}.${workbook}` : undefined;
  };
  const load = (): WorkbookPreferences => {
    try {
      const raw = deps
        .office()
        ?.context?.document?.settings?.get?.(PREFERENCES_KEY);
      if (raw != null) return parsePreferences(raw);
    } catch {
      // Settings are not available in this host; the browser copy is used.
    }
    try {
      const key = fallbackKey();
      return key ? parsePreferences(localStorage.getItem(key)) : {};
    } catch {
      return {};
    }
  };
  const render = () => {
    const preferences = deps.getPreferences();
    const line = document.querySelector<HTMLElement>("#prefs-line");
    const style = document.querySelector<HTMLSelectElement>(
      "#prefs-number-style",
    );
    const fiscal = document.querySelector<HTMLSelectElement>("#prefs-fiscal");
    const currency =
      document.querySelector<HTMLSelectElement>("#prefs-currency");
    const audience =
      document.querySelector<HTMLSelectElement>("#prefs-audience");
    const prefix = document.querySelector<HTMLInputElement>(
      "#prefs-result-prefix",
    );
    const changeLog =
      document.querySelector<HTMLInputElement>("#prefs-changelog");
    if (line) line.textContent = describePreferences(preferences);
    if (style) style.value = preferences.numberStyle ?? "";
    if (fiscal) fiscal.value = String(preferences.fiscalYearStart ?? "");
    if (currency) currency.value = preferences.currency ?? "";
    if (audience) audience.value = preferences.audience ?? "";
    if (prefix) prefix.value = preferences.resultSheetPrefix ?? "";
    if (changeLog) changeLog.checked = preferences.changeLog !== false;
  };
  const save = (next: WorkbookPreferences) => {
    const preferences = parsePreferences(next);
    deps.setPreferences(preferences);
    const text = JSON.stringify(preferences);
    try {
      const settings = deps.office()?.context?.document?.settings;
      if (settings?.set) {
        settings.set(PREFERENCES_KEY, text);
        settings.saveAsync?.();
      }
    } catch {
      // Kept in the browser copy below.
    }
    try {
      const key = fallbackKey();
      if (key) localStorage.setItem(key, text);
    } catch {
      // Private window: remembered for this session only.
    }
    render();
  };
  const learn = (request: string) => {
    const learnt = learnFromRequest(deps.getPreferences(), request);
    if (!Object.keys(learnt).length) return;
    save({ ...deps.getPreferences(), ...learnt });
    deps.record("prefs:learnt", "info", Object.keys(learnt).join(","));
  };
  const update = (change: Partial<WorkbookPreferences>) => {
    const next: Record<string, unknown> = {
      ...deps.getPreferences(),
      ...change,
    };
    for (const [key, value] of Object.entries(change))
      if (value === undefined || value === "") delete next[key];
    save(next as WorkbookPreferences);
  };
  const logChanges = async (entry: ChangeLogEntry) => {
    if (deps.getPreferences().changeLog === false) return;
    const ok = await appendChangeLog(
      deps.officeRuntime(),
      changeLogRows(entry),
    );
    deps.record("changelog:append", ok ? "pass" : "fail", {
      action: entry.action,
      rows: entry.changes.length,
      sheet: CHANGE_LOG_SHEET,
    });
  };
  const bind = () => {
    document
      .querySelector<HTMLSelectElement>("#prefs-number-style")
      ?.addEventListener("change", (event) =>
        update({
          numberStyle:
            (event.currentTarget as HTMLSelectElement).value ||
            (undefined as any),
        }),
      );
    document
      .querySelector<HTMLSelectElement>("#prefs-fiscal")
      ?.addEventListener("change", (event) => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        update({ fiscalYearStart: value ? Number(value) : undefined });
      });
    document
      .querySelector<HTMLSelectElement>("#prefs-currency")
      ?.addEventListener("change", (event) =>
        update({
          currency:
            (event.currentTarget as HTMLSelectElement).value || undefined,
        }),
      );
    document
      .querySelector<HTMLSelectElement>("#prefs-audience")
      ?.addEventListener("change", (event) =>
        update({
          audience:
            (event.currentTarget as HTMLSelectElement).value ||
            (undefined as any),
        }),
      );
    document
      .querySelector<HTMLInputElement>("#prefs-result-prefix")
      ?.addEventListener("change", (event) =>
        update({
          resultSheetPrefix:
            (event.currentTarget as HTMLInputElement).value.trim() || undefined,
        }),
      );
    document
      .querySelector<HTMLInputElement>("#prefs-changelog")
      ?.addEventListener("change", (event) =>
        update({
          changeLog: (event.currentTarget as HTMLInputElement).checked,
        }),
      );
    document.querySelector("#prefs-forget")?.addEventListener("click", () => {
      save({});
      deps.setStatus("Forgot the saved choices for this workbook.");
    });
  };
  return { load, save, learn, render, update, logChanges, bind };
}
