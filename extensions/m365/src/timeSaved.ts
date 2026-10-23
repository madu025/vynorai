/**
 * "Saved this month" footer (pure, no DOM): every time the person applies a change set that the
 * add-in verified, a small number of minutes is added to a ledger kept in this browser's
 * localStorage. Nothing is sent anywhere.
 *
 * The minutes are an ESTIMATE, not a measurement. Each kind of work has one fixed, deliberately
 * low figure (MINUTES_BY_KIND): roughly what a careful person needs to do the same by hand in
 * Excel. They are never read from a clock, and one apply is capped (MAX_MINUTES_PER_APPLY), so
 * the footer under-promises. The footer names the number as an estimate.
 */

export type WorkKind = "chart" | "cleanup" | "summary" | "format" | "other";

/** Estimated minutes of manual work per kind of work. Conservative, fixed, an estimate. */
export const MINUTES_BY_KIND: Readonly<Record<WorkKind, number>> = {
  chart: 3,
  cleanup: 5,
  summary: 4,
  format: 2,
  other: 2,
};
/** One apply never counts for more than this, however many kinds it holds. */
export const MAX_MINUTES_PER_APPLY = 15;

export const LEDGER_KEY = "vynorai.m365.timeSaved";
const KEEP_DAYS = 400;
const KEEP_MONTHS = 24;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** The result kinds of the classic plan (ExcelActionKind) and the kind of work each one is. */
const PLAN_KIND_WORK: Readonly<Record<string, WorkKind | null>> = {
  "new-sheet": null,
  "named-range": null,
  slicer: null,
  "export-csv": null,
  "export-pdf": null,
  table: "other",
  clean: "cleanup",
  "split-column": "cleanup",
  unpivot: "cleanup",
  quality: "cleanup",
  chart: "chart",
  "pivot-table": "summary",
  summary: "summary",
  statistics: "summary",
  dashboard: "summary",
  format: "format",
  view: "format",
  "add-column": "other",
  "lookup-columns": "other",
};

/** The agent's excel_action tools and the kind of work each one is; unknown tools count for nothing. */
const AGENT_TOOL_WORK: Readonly<Record<string, WorkKind | null>> = {
  pivot_action: "summary",
  chart_action: "chart",
  combine_tables: "summary",
  financial_model: "summary",
  what_if: "summary",
  goal_seek: "summary",
  clean_in_place: "cleanup",
  find_replace: "cleanup",
  delete_rows_where: "cleanup",
  conditional_format: "format",
  page_setup: "format",
  filter_range: "format",
  data_validation: "other",
  table_action: "other",
  edit_rows_columns: "other",
};

export function workKindOfPlanKind(kind: string): WorkKind | null {
  return PLAN_KIND_WORK[kind] ?? null;
}

/** A free-text agent step ("Remove duplicate rows", "Chart sales by region") to a kind of work. */
export function workKindOfInstruction(instruction: string): WorkKind {
  const text = instruction.toLowerCase();
  if (/\b(chart|graph|plot)\b/.test(text)) return "chart";
  if (/\b(clean|dedup\w*|duplicate\w*|blank\w*|trim\w*|fix\w*|remove\w*)\b/.test(text))
    return "cleanup";
  if (/\b(pivot\w*|summar\w*|total\w*|group\w*|report|dashboard)\b/.test(text))
    return "summary";
  if (/\b(format\w*|bold|colou?r\w*|highlight\w*|width|align\w*)\b/.test(text))
    return "format";
  return "other";
}

export interface AgentChangeLike {
  kind: string;
  tool?: string;
  instruction?: string;
}

export function workKindOfAgentChange(change: AgentChangeLike): WorkKind | null {
  switch (change.kind) {
    case "create_chart":
      return "chart";
    case "format_range":
    case "sort_range":
      return "format";
    case "write_formula":
    case "write_values":
      return "other";
    case "create_sheet":
      return null;
    case "vynor_step":
      return workKindOfInstruction(change.instruction ?? "");
    case "excel_action":
      return AGENT_TOOL_WORK[change.tool ?? ""] ?? null;
    default:
      return null;
  }
}

/**
 * The kinds of work in an agent apply, or an empty list when the apply is not one the add-in can
 * vouch for: every staged change must have run (none failed or skipped) and no write may have
 * read back with a mismatch.
 */
export function agentApplyKinds(
  changes: readonly AgentChangeLike[],
  results: readonly { status: string; detail?: unknown }[],
): WorkKind[] {
  if (!changes.length || changes.length !== results.length) return [];
  for (const result of results) {
    if (result.status !== "applied") return [];
    const mismatches = (result.detail as { mismatches?: unknown } | null)
      ?.mismatches;
    if (Array.isArray(mismatches) && mismatches.length) return [];
  }
  return changes
    .map(workKindOfAgentChange)
    .filter((kind): kind is WorkKind => kind !== null);
}

/**
 * The kinds of work in a classic apply: the source must be unchanged after the apply (the
 * add-in's own check), nothing may have failed, and only results that were created now count (a
 * result that "exists" was left as it was).
 */
export function classicApplyKinds(
  results: readonly { kind: string; status: string }[],
  sourceUnchanged: boolean,
): WorkKind[] {
  if (!sourceUnchanged || results.some((result) => result.status === "failed"))
    return [];
  return results
    .filter((result) => result.status === "created")
    .map((result) => workKindOfPlanKind(result.kind))
    .filter((kind): kind is WorkKind => kind !== null);
}

/** Each kind counts once per apply, and the total is capped. */
export function minutesForKinds(kinds: readonly WorkKind[]): number {
  let total = 0;
  for (const kind of new Set(kinds)) total += MINUTES_BY_KIND[kind];
  return Math.min(total, MAX_MINUTES_PER_APPLY);
}

export interface TimeLedger {
  v: 1;
  /** Estimated minutes per calendar month, "YYYY-MM". */
  months: Record<string, number>;
  /** Number of verified applies per calendar day, "YYYY-MM-DD", for the streak. */
  days: Record<string, number>;
}

export const emptyLedger = (): TimeLedger => ({ v: 1, months: {}, days: {} });

const two = (n: number) => String(n).padStart(2, "0");
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
export const monthKey = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}`;

const count = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), max)
    : undefined;

/** Reads what localStorage holds; anything unexpected gives an empty ledger, never an error. */
export function parseLedger(raw: string | null | undefined): TimeLedger {
  const ledger = emptyLedger();
  if (!raw) return ledger;
  try {
    const data = JSON.parse(raw) as Partial<TimeLedger> | null;
    if (!data || typeof data !== "object" || data.v !== 1) return ledger;
    for (const [key, value] of Object.entries(data.months ?? {})) {
      const minutes = count(value, 1_000_000);
      if (MONTH_PATTERN.test(key) && minutes) ledger.months[key] = minutes;
    }
    for (const [key, value] of Object.entries(data.days ?? {})) {
      const applies = count(value, 100_000);
      if (DAY_PATTERN.test(key) && applies) ledger.days[key] = applies;
    }
  } catch {
    return emptyLedger();
  }
  return ledger;
}

function newest<T>(record: Record<string, T>, keep: number): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(-keep),
  );
}

/** A new ledger with these minutes added to the day and month of `now`; nothing for 0 minutes. */
export function addToLedger(
  ledger: TimeLedger,
  minutes: number,
  now: Date,
): TimeLedger {
  if (!(minutes > 0)) return ledger;
  const day = dayKey(now);
  const month = monthKey(now);
  return {
    v: 1,
    months: newest(
      { ...ledger.months, [month]: (ledger.months[month] ?? 0) + minutes },
      KEEP_MONTHS,
    ),
    days: newest(
      { ...ledger.days, [day]: (ledger.days[day] ?? 0) + 1 },
      KEEP_DAYS,
    ),
  };
}

export const monthMinutes = (ledger: TimeLedger, now: Date): number =>
  ledger.months[monthKey(now)] ?? 0;

/**
 * Days in a row with at least one verified apply, ending today. A streak whose last day was
 * yesterday is still alive (today is not over); one that ended earlier is 0.
 */
export function streakDays(ledger: TimeLedger, now: Date): number {
  const at = (back: number) =>
    dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12));
  let back = ledger.days[at(0)] ? 0 : ledger.days[at(1)] ? 1 : -1;
  if (back < 0) return 0;
  let streak = 0;
  while (streak < KEEP_DAYS && ledger.days[at(back)]) {
    streak += 1;
    back += 1;
  }
  return streak;
}

/** "25 min", "1 h", "1 h 5 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export interface SavedFooterText {
  /** English; the pane localizes it with localizeMessage. Empty when there is nothing to show. */
  month: string;
  streak: string;
}

/** The footer lines: nothing at all until an apply was recorded; a streak shows from 2 days. */
export function savedFooterText(ledger: TimeLedger, now: Date): SavedFooterText {
  const minutes = monthMinutes(ledger, now);
  const streak = streakDays(ledger, now);
  return {
    month: minutes
      ? `About ${formatMinutes(minutes)} saved this month (estimate)`
      : "",
    streak: streak >= 2 ? `${streak} day streak` : "",
  };
}

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or undefined where the host blocks it (private window, cleared site data). */
export function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readLedger(storage: StorageLike | undefined): TimeLedger {
  try {
    return parseLedger(storage?.getItem(LEDGER_KEY));
  } catch {
    return emptyLedger();
  }
}

/** Adds one verified apply to the stored ledger and returns it; a blocked store changes nothing. */
export function recordVerifiedApply(
  storage: StorageLike | undefined,
  kinds: readonly WorkKind[],
  now: Date = new Date(),
): TimeLedger {
  const before = readLedger(storage);
  const minutes = minutesForKinds(kinds);
  if (!storage || minutes <= 0) return before;
  const after = addToLedger(before, minutes, now);
  try {
    storage.setItem(LEDGER_KEY, JSON.stringify(after));
  } catch {
    return before;
  }
  return after;
}
