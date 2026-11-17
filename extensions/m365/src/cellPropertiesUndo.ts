/**
 * Cell properties read back with getCellProperties() are not always valid input for
 * setCellProperties(): a cell with no fill reads "", an absent border reads style "None"
 * with an empty colour and a weight. Excel answers "The argument is invalid or missing or
 * has an incorrect format" for those, so Undo of a format change failed. This turns a
 * snapshot into something Excel accepts, and lists the cells whose fill must be cleared.
 */
type Props = Record<string, any>;

export interface CleanCellProperties {
  cells: Props[][];
  /** [row, column] of the cells that had no fill, which setCellProperties cannot set back. */
  clearFill: [number, number][];
}

/** Only a real empty string is invalid input; undefined means "set this back to unset". */
function empty(value: unknown): boolean {
  return value === "";
}

function cleanBorders(borders: Props): Props {
  const result: Props = {};
  for (const side of Object.keys(borders)) {
    const border = borders[side];
    if (!border || typeof border !== "object") {
      result[side] = border;
      continue;
    }
    if (String(border.style) === "None") {
      // No border: only the style may be given; colour and weight are rejected with it.
      result[side] = { style: "None" };
      continue;
    }
    const kept: Props = { ...border };
    if (empty(kept.color)) delete kept.color;
    if (empty(kept.weight)) delete kept.weight;
    result[side] = kept;
  }
  return result;
}

export function cleanCellProperties(cells: Props[][]): CleanCellProperties {
  const clearFill: [number, number][] = [];
  const cleaned = cells.map((row, r) =>
    row.map((cell, c) => {
      const out: Props = {};
      for (const key of Object.keys(cell ?? {})) {
        const value = cell[key];
        if (key === "fill" && value && typeof value === "object") {
          if (empty(value.color)) clearFill.push([r, c]);
          else out.fill = value;
        } else if (key === "font" && value && typeof value === "object") {
          const font: Props = {};
          for (const name of Object.keys(value))
            if (!empty(value[name])) font[name] = value[name];
          out.font = font;
        } else if (key === "borders" && value && typeof value === "object") {
          out.borders = cleanBorders(value);
        } else if (!empty(value)) {
          out[key] = value;
        }
      }
      return out;
    }),
  );
  return { cells: cleaned, clearFill };
}

/** A short reason from an Office.js error, kept to one line. */
export function describeUndoError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 120);
}
