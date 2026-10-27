/**
 * Safe, local schedule metadata for workbook reports.
 *
 * An Office task pane cannot run while it is closed, so this module deliberately does not
 * pretend to provide a server-side/background scheduler. It records the user's intent and the
 * next due time; the task pane can use it when it is opened again.
 */
export type RefreshFrequency = "daily" | "weekly";

export interface ScheduledRefresh {
  request: string;
  frequency: RefreshFrequency;
  weekday?: number;
  nextRunAt: number;
  createdAt: number;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function nextAtNine(now: Date, day: Date): number {
  const next = new Date(day);
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function parseScheduledRefresh(
  text: string,
  now = new Date(),
): ScheduledRefresh | undefined {
  const daily = /\b(?:every|each)\s+day\b/i.test(text);
  const weekly = /\b(?:every|each)\s+week\b/i.test(text);
  const weekdayMatch =
    /\b(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
      text,
    );
  if (!daily && !weekly && !weekdayMatch) return undefined;

  const weekday = weekdayMatch
    ? WEEKDAYS[weekdayMatch[1].toLowerCase()]
    : undefined;
  const request = text
    .replace(
      /\s*(?:and\s+)?(?:refresh|update)\s+(?:this\s+)?(?:result|report|sheet|workbook)?\s*(?:every|each)\s+(?:day|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b[^.]*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  const next = new Date(now);
  if (weekday !== undefined) {
    const distance = (weekday - next.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + distance);
  } else if (weekly) {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }
  return {
    request,
    frequency: weekday !== undefined || weekly ? "weekly" : "daily",
    ...(weekday !== undefined ? { weekday } : {}),
    nextRunAt: nextAtNine(now, next),
    createdAt: now.getTime(),
  };
}

export function parseStoredScheduledRefresh(
  raw: string | null,
): ScheduledRefresh | undefined {
  try {
    const value = raw
      ? (JSON.parse(raw) as Partial<ScheduledRefresh>)
      : undefined;
    if (!value || typeof value.request !== "string" || !value.request.trim())
      return undefined;
    if (value.frequency !== "daily" && value.frequency !== "weekly")
      return undefined;
    const nextRunAt = value.nextRunAt;
    const createdAt = value.createdAt;
    if (
      typeof nextRunAt !== "number" ||
      typeof createdAt !== "number" ||
      !Number.isFinite(nextRunAt) ||
      !Number.isFinite(createdAt)
    )
      return undefined;
    if (
      value.weekday !== undefined &&
      (!Number.isInteger(value.weekday) ||
        value.weekday < 0 ||
        value.weekday > 6)
    )
      return undefined;
    return {
      request: value.request,
      frequency: value.frequency,
      ...(value.weekday === undefined ? {} : { weekday: value.weekday }),
      nextRunAt,
      createdAt,
    };
  } catch {
    return undefined;
  }
}
