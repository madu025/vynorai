/**
 * Suggestion cards for the empty chat, built from the real column names of the table the
 * person is on: icon, bold title and one line of what it does. Pure and display only: it reads
 * the schema facts (names and roles), never cell values. A card puts its request in the input;
 * nothing runs until the person presses Run.
 */
import type { WorkspaceSchema } from "./smartWorkspace.js";

export interface IdleSuggestion {
  icon: string;
  title: string;
  hint: string;
  /** The request placed in the composer. */
  text: string;
}

// The landing screen is deliberately a short decision surface.  Four cards fit as a complete
// 2×2 grid in normal Excel task panes and as four deliberate scroll stops in compact panes.
// More choices belong in Explore, not half-hidden behind the workspace navigation.
const MAX = 4;

export function idleSuggestions(
  schema: WorkspaceSchema | undefined,
): IdleSuggestion[] {
  const columns = schema?.columns ?? [];
  if (!columns.length) return [];
  const byRole = (role: string) =>
    columns.filter((column) => column.role === role).map((c) => c.name);
  const measures = byRole("measure");
  const categories = byRole("category");
  const ids = byRole("identifier");
  const dates = byRole("date");
  const out: IdleSuggestion[] = [];
  if (measures[0] && categories[0])
    out.push({
      icon: "Σ",
      title: `Total ${measures[0]} by ${categories[0]}`,
      hint: "Answered here, nothing is changed",
      text: `total ${measures[0]} by ${categories[0]}`,
    });
  if (ids[0])
    out.push({
      icon: "⧉",
      title: `Find duplicate ${ids[0]}`,
      hint: `Checks the ${ids[0]} column for repeats`,
      text: `find duplicate ${ids[0]}`,
    });
  const blank = schema?.blankColumns?.[0];
  if (blank)
    out.push({
      icon: "✓",
      title: `Fill blank cells in ${blank}`,
      hint: "Shows the blanks first, you pick the value",
      text: `fill blank cells in ${blank}`,
    });
  if (measures[0] && dates[0])
    out.push({
      icon: "↗",
      title: `${measures[0]} over time`,
      hint: `By ${dates[0]}, as a chart preview`,
      text: `chart of ${measures[0]} by ${dates[0]}`,
    });
  if (measures[0] && !categories[0])
    out.push({
      icon: "Σ",
      title: `Summarize ${measures[0]}`,
      hint: "Total, average, smallest and largest",
      text: `summarize ${measures[0]}`,
    });
  if (out.length < 3)
    out.push({
      icon: "▤",
      title: "Check data quality",
      hint: "Blanks, duplicates and odd values",
      text: "check data quality",
    });
  const cross = crossSheet(
    schema,
    columns.map((c) => c.name),
  );
  const merged = [
    ...out.slice(0, 3),
    ...cross.slice(0, 1),
    ...out.slice(3),
    ...cross.slice(1),
  ];
  // The generic suggestion is always the last one.
  return [
    ...merged.slice(0, MAX - 1),
    {
      icon: "ƒ",
      title: "Inspect formulas",
      hint: "Check formulas and errors in this table",
      text: "Inspect selected formulas and formula errors.",
    },
  ];
}

/** "Bring <column> from <Sheet> into <Active>" when another sheet shares a key column with this table. */
function crossSheet(
  schema: WorkspaceSchema | undefined,
  names: string[],
): IdleSuggestion[] {
  const others = schema?.otherSheets ?? [];
  const active =
    /^'?([^'!]+)'?!/.exec(schema?.tableAddress ?? "")?.[1] ?? "this sheet";
  const mine = new Set(names.map((name) => name.toLowerCase()));
  const found: IdleSuggestion[] = [];
  for (const other of others) {
    const key = other.headers.find(
      (header) =>
        mine.has(header.toLowerCase()) &&
        /(^|\s)(id|code|no|number)$/i.test(header),
    );
    const extra = other.headers.find(
      (header) =>
        header !== key &&
        !mine.has(header.toLowerCase()) &&
        !/id$/i.test(header),
    );
    if (!key || !extra) continue;
    found.push({
      icon: "⇄",
      title: `Bring ${extra} from ${other.name}`,
      hint: `Matched by ${key}, on a new sheet`,
      text: `bring the ${extra} from ${other.name} into the ${active} sheet by ${key}, on a new sheet`,
    });
    if (found.length === 2) break;
  }
  return found;
}
