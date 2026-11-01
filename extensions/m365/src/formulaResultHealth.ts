/**
 * Checks the values a written formula produced, after apply, without a model: how many cells are
 * Excel errors (#SPILL!, #N/A, #REF!) and how many are a lookup's "not found" fallback. A join that
 * fills a whole column with "Not found" looks fine to a reviewer that only reads the formula, so the
 * add-in counts the results itself. Pure; the Office.js writer reads the values and calls it.
 */

/** Cells checked at most; a column of 520k rows is judged on its top part. */
export const HEALTH_MAX_ROWS = 2000;

/** Below this many cells, a high miss share is still reported only when every cell missed. */
const MIN_ROWS_FOR_SHARE = 5;
/** Share of "not found" results above which the join is reported as probably wrong (as in resultCheck.ts). */
const MISS_SHARE_LIMIT = 0.3;

const ERROR =
  /^#(?:SPILL!|N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!|CALC!|FIELD!|BUSY!|BLOCKED!|CONNECT!|UNKNOWN!|GETTING_DATA)/;
const MISS =
  /^(?:not\s*found|no\s*match|missing|n\/a|none found|not\s*in\s*list)$/i;

export interface FormulaResultHealth {
  checked: number;
  errors: number;
  misses: number;
  /** The first error value seen, such as "#SPILL!". */
  firstError?: string;
  /** Set when the result needs the agent's (and the person's) attention. */
  warning?: string;
}

export function formulaResultHealth(
  values: readonly unknown[],
): FormulaResultHealth {
  const cells = values.slice(0, HEALTH_MAX_ROWS);
  let errors = 0;
  let misses = 0;
  let firstError: string | undefined;
  for (const cell of cells) {
    if (typeof cell !== "string") continue;
    const text = cell.trim();
    if (ERROR.test(text)) {
      errors += 1;
      firstError ??= text;
    } else if (MISS.test(text)) misses += 1;
  }
  const checked = cells.length;
  const health: FormulaResultHealth = { checked, errors, misses };
  if (firstError) health.firstError = firstError;
  if (!checked) return health;
  const percent = (count: number) => Math.round((count / checked) * 100);
  if (errors > 0)
    health.warning = `${errors} of ${checked} result cell(s) are errors (first: ${firstError}).`;
  else if (
    misses === checked ||
    (checked >= MIN_ROWS_FOR_SHARE && misses / checked >= MISS_SHARE_LIMIT)
  )
    health.warning = `${misses} of ${checked} result cell(s) (${percent(misses)}%) are "not found": the lookup key or column is probably wrong.`;
  return health;
}
