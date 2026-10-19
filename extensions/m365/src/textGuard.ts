/**
 * Excel treats a string written through Range.values as if it were typed: "007" becomes 7, "1/2"
 * becomes a date, "TRUE" a boolean. When a result sheet copies text from the source, each such cell
 * gets a leading apostrophe (Excel's text prefix, the same mechanism `literal` uses for "=") so the
 * cell stays the text it was. Per cell rather than per column, because a cleaned column can hold
 * text identifiers next to real numbers.
 */
type Cell = string | number | boolean | null;

const WOULD_BE_PARSED = /^\s*[+\-.]?\d|^\s*(true|false)\s*$/i;

/** True when Excel would turn this string into a number, date, time or boolean on write. */
export function wouldBeConverted(cell: Cell): cell is string {
  return typeof cell === "string" && WOULD_BE_PARSED.test(cell);
}

/** The cell to write: text Excel would convert gets the text prefix; everything else is unchanged. */
export function guardText(cell: Cell): Cell {
  return wouldBeConverted(cell) ? `'${cell}` : cell;
}
