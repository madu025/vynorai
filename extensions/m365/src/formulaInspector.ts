export interface FormulaSelection {
  worksheetName: string;
  address: string;
  formulas: unknown[][];
  values: unknown[][];
}

export interface FormulaInspectionItem {
  address: string;
  formula: string;
  references: string[];
  errors: string[];
  possibleCircularReference: boolean;
  explanation: string;
  repair?: {
    candidate?: string;
    guidance: string;
  };
}

export interface FormulaInspection {
  worksheetName: string;
  address: string;
  formulaCellCount: number;
  errorCellCount: number;
  possibleCircularReferenceCount: number;
  items: FormulaInspectionItem[];
}

const ERROR_CODES = [
  "#REF!",
  "#DIV/0!",
  "#VALUE!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#NULL!",
] as const;

function columnLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

function selectionStart(address: string): { column: number; row: number } {
  const local = address.slice(address.lastIndexOf("!") + 1);
  const match = /^\$?([A-Z]{1,3})\$?(\d+)/i.exec(local.trim());
  if (!match)
    throw new Error("The selected formula range has an invalid address.");
  const column =
    match[1]
      .toUpperCase()
      .split("")
      .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  return { column, row: Number(match[2]) - 1 };
}

function references(formula: string): string[] {
  const found =
    formula.match(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gi) ?? [];
  return [
    ...new Set(
      found.map((reference) => reference.replace(/\$/g, "").toUpperCase()),
    ),
  ];
}

function explain(formula: string, refs: string[]): string {
  const functionMatch = /^=\s*([A-Z][A-Z0-9.]*)\s*\(/i.exec(formula);
  if (functionMatch) {
    const name = functionMatch[1].toUpperCase();
    const meanings: Record<string, string> = {
      SUM: "Adds the selected numbers",
      AVERAGE: "Calculates the average of the selected numbers",
      COUNT: "Counts numeric cells",
      COUNTA: "Counts non-empty cells",
      MIN: "Returns the smallest value",
      MAX: "Returns the largest value",
      IF: "Tests a condition and returns one of two results",
      IFERROR: "Shows a fallback when the inner calculation errors",
      XLOOKUP: "Looks up a matching value and returns a related value",
      VLOOKUP: "Looks up a value in the first table column",
      INDEX: "Returns a value at a selected position",
      MATCH: "Finds the position of a matching value",
    };
    return `${meanings[name] ?? `${name} runs its Excel calculation`} using ${refs.length} cell reference${refs.length === 1 ? "" : "s"}.`;
  }
  if (/\//.test(formula))
    return "Divides one value by another; a zero or blank divisor causes #DIV/0!.";
  if (/\*/.test(formula))
    return "Calculates a multiplication using the listed cell references.";
  if (/[-+]/.test(formula))
    return "Calculates with addition or subtraction using the listed cell references.";
  return "Uses the listed cell references.";
}

const SAFE_REPAIR_FUNCTIONS = new Set([
  "ABS",
  "AVERAGE",
  "AVERAGEIF",
  "AVERAGEIFS",
  "COUNT",
  "COUNTA",
  "COUNTIF",
  "COUNTIFS",
  "IF",
  "IFERROR",
  "INDEX",
  "MATCH",
  "MAX",
  "MAXIFS",
  "MIN",
  "MINIFS",
  "ROUND",
  "SUM",
  "SUMIF",
  "SUMIFS",
  "VLOOKUP",
  "XLOOKUP",
]);

/** A repair candidate is advice only; it is never written to the selected source cell. */
function repairSuggestion(
  formula: string,
  errors: string[],
): FormulaInspectionItem["repair"] | undefined {
  if (errors.includes("#REF!"))
    return {
      guidance:
        "A deleted reference cannot be reconstructed safely. Choose the intended source cell before creating a repaired copy.",
    };
  if (!errors.includes("#DIV/0!")) return undefined;
  if (/^=\s*IFERROR\s*\(/i.test(formula))
    return {
      guidance:
        "This formula already handles calculation errors. Review the zero or blank divisor instead of wrapping it again.",
    };
  if (
    formula.length > 1000 ||
    /[\r\n\[]/.test(formula) ||
    /\b(?:WEBSERVICE|HYPERLINK|RTD|DDE)\s*\(/i.test(formula)
  )
    return {
      guidance:
        "This formula is outside the safe automatic repair subset. Review it manually.",
    };
  const functions = [...formula.matchAll(/\b([A-Z][A-Z0-9.]*)\s*\(/gi)].map(
    (match) => match[1].toUpperCase(),
  );
  if (functions.some((name) => !SAFE_REPAIR_FUNCTIONS.has(name)))
    return {
      guidance:
        "This formula uses a function outside the safe automatic repair subset. Review it manually.",
    };
  return {
    candidate: `=IFERROR(${formula.slice(1)},"")`,
    guidance:
      "Suggested repair suppresses the division error with a blank result. It is advisory and is not applied to your source cell.",
  };
}

/** True only for an explicit formula-inspection request; ordinary questions remain local data questions. */
export function isFormulaInspectionRequest(instruction: string): boolean {
  return /\b(?:inspect|explain|check|find)\b.*\bformulas?\b|\bformula\s+(?:errors?|check|inspect|explain)\b|\b(?:repair|fix)\b.*(?:#REF!|#DIV\/0!|formulas?)/i.test(
    instruction,
  );
}

/**
 * Produces a local, read-only formula report and optional advisory repair candidate. It never
 * evaluates, writes, repairs, or transmits formulas. A direct self reference is a possible
 * circular reference; longer cycles remain Excel's calculation-engine responsibility.
 */
export function inspectFormulas(input: FormulaSelection): FormulaInspection {
  const start = selectionStart(input.address);
  const items: FormulaInspectionItem[] = [];
  let errorCellCount = 0;
  let possibleCircularReferenceCount = 0;
  for (let row = 0; row < input.formulas.length; row += 1) {
    for (let column = 0; column < input.formulas[row].length; column += 1) {
      const formula = String(input.formulas[row][column] ?? "");
      const value = String(input.values[row]?.[column] ?? "");
      if (!formula.startsWith("=")) continue;
      const cell = `${columnLetter(start.column + column)}${start.row + row + 1}`;
      const refs = references(formula);
      const errors = ERROR_CODES.filter(
        (code) => formula.includes(code) || value.includes(code),
      );
      const possibleCircularReference = refs.includes(cell);
      if (errors.length) errorCellCount += 1;
      if (possibleCircularReference) possibleCircularReferenceCount += 1;
      items.push({
        address: cell,
        formula,
        references: refs,
        errors,
        possibleCircularReference,
        explanation: explain(formula, refs),
        repair: repairSuggestion(formula, errors),
      });
    }
  }
  return {
    worksheetName: input.worksheetName,
    address: input.address,
    formulaCellCount: items.length,
    errorCellCount,
    possibleCircularReferenceCount,
    items,
  };
}

export function formatFormulaInspection(report: FormulaInspection): string {
  if (report.formulaCellCount === 0)
    return "No formulas were found in the selected cells.";
  const header = `${report.formulaCellCount} formula cell(s), ${report.errorCellCount} error cell(s), ${report.possibleCircularReferenceCount} possible direct circular reference(s).`;
  const details = report.items.slice(0, 20).map((item) => {
    const warnings = [
      ...item.errors,
      ...(item.possibleCircularReference
        ? ["possible direct circular reference"]
        : []),
    ];
    const repair = item.repair
      ? ` ${item.repair.candidate ? `Suggested repair: ${item.repair.candidate}. ` : ""}${item.repair.guidance}`
      : "";
    return `${item.address}: ${item.formula}. ${item.explanation}${warnings.length ? ` Warning: ${warnings.join(", ")}.` : ""}${repair}`;
  });
  return [header, ...details].join(" ");
}
