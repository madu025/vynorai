/**
 * "Noticed in your data": a few things worth a look in the selected cells, found on this device
 * from the first rows of the selection. Each tile carries a request the person can send with one
 * click; nothing is changed and nothing leaves the workbook. Pure.
 */
import { findAnomalies } from "./advancedAnalytics.js";

export type NoticeCell = string | number | boolean | null | undefined;

export interface NoticedTile {
  key: "dates" | "duplicates" | "outliers" | "blanks" | "concentration";
  /** The figure shown big: a count or a percentage. */
  figure: string;
  label: string;
  /** The sentence put in the request box when the tile is clicked. */
  request: string;
  tone: "fix" | "review" | "look";
}

export const NOTICE_MAX_ROWS = 2000;
export const NOTICE_MAX_TILES = 3;

const DATE_TEXT = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/;
const blank = (v: NoticeCell) => v === null || v === undefined || String(v).trim() === "";
const num = (v: NoticeCell): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const KEYISH = /\b(id|no|number|code|ref|phone|nic)\b|id$|^#/i;
const MEASURE = /amount|total|price|cost|revenue|sales|salary|basic|value|qty|quantity|units/i;
const grouped = (n: number) => n.toLocaleString("en-US");

export function noticeInData(headers: string[], allRows: NoticeCell[][]): NoticedTile[] {
  const rows = allRows.slice(0, NOTICE_MAX_ROWS);
  if (rows.length < 3 || headers.length === 0) return [];
  const tiles: NoticedTile[] = [];
  const column = (index: number) => rows.map((row) => row[index]);

  // Dates that are text: Excel cannot sort or group them as dates.
  for (let c = 0; c < headers.length; c += 1) {
    const present = column(c).filter((v) => !blank(v));
    const text = present.filter((v) => typeof v === "string" && DATE_TEXT.test(v.trim()));
    if (present.length >= 3 && text.length / present.length >= 0.8) {
      tiles.push({
        key: "dates",
        figure: grouped(text.length),
        label: `dates in ${headers[c]} are stored as text`,
        request: `fix the dates in ${headers[c]} that are stored as text`,
        tone: "fix",
      });
      break;
    }
  }

  // Exact duplicate rows.
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = JSON.stringify(row.slice(0, headers.length));
    if (row.every(blank)) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const extra = [...seen.values()].reduce((sum, n) => sum + (n > 1 ? n - 1 : 0), 0);
  if (extra > 0)
    tiles.push({
      key: "duplicates",
      figure: grouped(extra),
      label: "rows repeat another row exactly",
      request: "which rows are exact duplicates? tell me the row numbers",
      tone: "review",
    });

  // Unusual numbers in the first measure column.
  const measure = headers.findIndex(
    (h, c) => MEASURE.test(h) && !KEYISH.test(h) && column(c).filter((v) => num(v) !== undefined).length >= 8,
  );
  if (measure >= 0) {
    const outliers = findAnomalies(column(measure).map((v) => num(v) ?? null)).length;
    if (outliers > 0)
      tiles.push({
        key: "outliers",
        figure: grouped(outliers),
        label: `unusual ${headers[measure]} value${outliers === 1 ? "" : "s"}`,
        request: `which ${headers[measure]} values are unusual? tell me which rows`,
        tone: "look",
      });
  }

  // Blank cells in a column that is otherwise filled.
  for (let c = 0; c < headers.length; c += 1) {
    const missing = column(c).filter(blank).length;
    if (missing > 0 && missing <= rows.length * 0.3) {
      tiles.push({
        key: "blanks",
        figure: grouped(missing),
        label: `blank cell${missing === 1 ? "" : "s"} in ${headers[c]}`,
        request: `which rows have a blank ${headers[c]}?`,
        tone: "review",
      });
      break;
    }
  }

  // One group carrying most of the total.
  if (measure >= 0) {
    for (let c = 0; c < headers.length; c += 1) {
      if (c === measure || KEYISH.test(headers[c])) continue;
      const labels = column(c).filter((v) => typeof v === "string" && !blank(v) && !DATE_TEXT.test(String(v).trim()));
      const distinct = new Set(labels.map((v) => String(v).trim()));
      if (labels.length < rows.length * 0.8 || distinct.size < 2 || distinct.size > 20) continue;
      const totals = new Map<string, number>();
      let all = 0;
      rows.forEach((row) => {
        const amount = num(row[measure]);
        const label = typeof row[c] === "string" ? String(row[c]).trim() : "";
        if (amount === undefined || amount < 0 || !label) return;
        totals.set(label, (totals.get(label) ?? 0) + amount);
        all += amount;
      });
      const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && all > 0 && top[1] / all >= 0.6) {
        tiles.push({
          key: "concentration",
          figure: `${Math.round((top[1] / all) * 100)}%`,
          label: `of ${headers[measure]} comes from one ${headers[c]} (${top[0]})`,
          request: `how much of ${headers[measure]} comes from each ${headers[c]}?`,
          tone: "look",
        });
        break;
      }
    }
  }

  const order = { fix: 0, review: 1, look: 2 } as const;
  return tiles.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, NOTICE_MAX_TILES);
}
