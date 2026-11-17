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

function empty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function cleanBorders(borders: Props): Props {
  const result: Props = {};
  for (const side of Object.keys(borders)) {
    const border = borders[side];
    if (!border || typeof border !== "object") continue;
    const style = border.style;
    if (empty(style) || String(style) === "None") {
      // No border: only the style may be given; colour and weight are rejected with it.
      result[side] = { style: "None" };
      continue;
    }
    const kept: Props = { style };
    if (!empty(border.color)) kept.color = border.color;
    if (!empty(border.weight)) kept.weight = border.weight;
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
        if (key === "fill") {
          if (empty(value?.color)) clearFill.push([r, c]);
          else out.fill = { color: value.color };
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
