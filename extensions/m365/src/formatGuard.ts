/**
 * A percent format shows 0.25 as 25%. Put on a column of amounts (157400 shows as 15740000%) it
 * ruins the numbers on screen, so the apply leaves such a format off and says so.
 */
export function percentMisfit(
  numberFormat: unknown,
  values: readonly (readonly unknown[])[],
): boolean {
  const formats = Array.isArray(numberFormat)
    ? numberFormat.flat()
    : [numberFormat];
  if (
    !formats.some(
      (format) => typeof format === "string" && format.includes("%"),
    )
  )
    return false;
  return values.some((row) =>
    row.some((cell) => typeof cell === "number" && Math.abs(cell) > 10),
  );
}
