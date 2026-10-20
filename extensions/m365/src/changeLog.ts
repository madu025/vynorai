/**
 * Change log (pure part): one row per applied or undone change, written to a "VynorAI Log" sheet
 * so an owner or auditor can see what the add-in changed, when, and for which request. Copilot in
 * Excel keeps no such record. The Office writer is `appendChangeLog` in officeSriLanka.ts.
 */

export const CHANGE_LOG_SHEET = "VynorAI Log";
export const CHANGE_LOG_HEADER = [
  "Time",
  "Action",
  "Request",
  "Change",
  "Sheet",
  "Status",
  "Reference",
] as const;

export interface ChangeLogEntry {
  at: Date;
  action: "applied" | "partly applied" | "undone";
  request: string;
  changes: Array<{ change: string; sheet?: string; status: string }>;
  /** Plan id or "agent". */
  reference?: string;
}

const REQUEST_MAX = 250;
const CHANGE_MAX = 200;
const ROWS_MAX = 50;

/**
 * Text that Excel could read as a formula (=, +, -, @) or that holds control characters is made
 * plain text, so a request can never run as a formula in the log.
 */
export function plainCell(value: unknown, max = CHANGE_MAX): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, max);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** Local time as "2026-10-20 13:05:09", the same on every machine that reads the sheet. */
export function logTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** Rows to append: one per change (at most 50), or one row when the list is empty. */
export function changeLogRows(entry: ChangeLogEntry): string[][] {
  const time = logTime(entry.at);
  const request = plainCell(entry.request, REQUEST_MAX);
  const reference = plainCell(entry.reference ?? "", 80);
  const changes = entry.changes.length
    ? entry.changes.slice(0, ROWS_MAX)
    : [{ change: "", sheet: "", status: entry.action }];
  const rows = changes.map((item) => [
    time,
    entry.action,
    request,
    plainCell(item.change),
    plainCell(item.sheet ?? "", 31),
    plainCell(item.status, 40),
    reference,
  ]);
  if (entry.changes.length > ROWS_MAX)
    rows.push([
      time,
      entry.action,
      request,
      `${entry.changes.length - ROWS_MAX} more change(s) not listed`,
      "",
      "",
      reference,
    ]);
  return rows;
}
