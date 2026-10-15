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
  if (functionMatch)
    return `${functionMatch[1].toUpperCase()} uses ${refs.length} cell reference${refs.length === 1 ? "" : "s"}.`;
  if (/\//.test(formula))
    return "Calculates a division; inspect a zero or blank divisor if it errors.";
  if (/\*/.test(formula))
    return "Calculates a multiplication using the listed cell references.";
  if (/[-+]/.test(formula))
    return "Calculates with addition or subtraction using the listed cell references.";
  return "Uses the listed cell references.";
}

/** True only for an explicit formula-inspection request; ordinary questions remain local data questions. */
export function isFormulaInspectionRequest(instruction: string): boolean {
  return /\b(?:inspect|explain|check|find)\b.*\bformulas?\b|\bformula\s+(?:errors?|check|inspect|explain)\b/i.test(
    instruction,
  );
}

/**
 * Produces a local, read-only formula report. It deliberately does not evaluate, repair, or
 * transmit formulas. A direct self reference is a possible circular reference; longer cycles
 * remain Excel's calculation-engine responsibility.
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
    return `${item.address}: ${item.formula}. ${item.explanation}${warnings.length ? ` Warning: ${warnings.join(", ")}.` : ""}`;
  });
  return [header, ...details].join(" ");
}
