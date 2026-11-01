/**
 * Evaluates the staged cross-sheet joins, appends and reconciliations on the real cells before any reviewer model runs: how many
 * result cells would be errors and how many rows would say "Not found". A model reviewer reading
 * the one-line description cannot see the formula `combine_tables` writes, so this check does.
 * The same is done for a lookup the agent writes itself as one spilled `write_formula`
 * (`evaluateLookups`), counted with `formulaResultHealth` as after apply.
 * Read-only: `host.calculate` leaves nothing in the workbook.
 */
import {
  CALC_MAX_ROWS,
  clampReadAddress,
  parseA1,
  type AgentHost,
  type StagedChange,
} from "./agent.js";
import { combineCells } from "./combineSheets.js";
import { formulaResultHealth } from "./formulaResultHealth.js";

/** Share of rows that may say "Not found" before the plan goes back to the builder. */
export const NOT_FOUND_LIMIT = 0.3;

const scalar = (value: unknown): number | undefined => {
  const cell = Array.isArray(value) ? (value as unknown[][])[0]?.[0] : value;
  return typeof cell === "number" && Number.isFinite(cell) ? cell : undefined;
};

export async function evaluateJoins(
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<string[]> {
  const issues: string[] = [];
  for (const { change } of changes) {
    if (change.kind !== "excel_action" || change.tool !== "combine_tables")
      continue;
    const args = change.args as Record<string, any>;
    try {
      const header = async (sheet: string, address: string) => {
        const read = await host.readRange(
          sheet,
          clampReadAddress(address).address,
          false,
        );
        return ((read.values[0] ?? []) as unknown[]).map((cell) =>
          String(cell ?? ""),
        );
      };
      const cells = combineCells({
        mode: args.mode,
        left: {
          sheet: args.left_sheet,
          address: args.left_address,
          headers: await header(args.left_sheet, args.left_address),
        },
        right: {
          sheet: args.right_sheet,
          address: args.right_address,
          headers: await header(args.right_sheet, args.right_address),
        },
        key: args.key,
        rightKey: args.right_key,
        columns: args.columns,
        amount: args.amount,
        rightAmount: args.right_amount,
      });
      const label = `${args.mode === "join" ? "Join" : args.mode === "append" ? "Append" : "Reconcile"} into '${args.sheet}'!${args.cell}`;
      if (args.mode !== "join") {
        let bad = 0;
        for (const cell of cells)
          bad +=
            scalar(
              await host.calculate(
                `=LET(r,${cell.formula.slice(1)},SUM(--ISERROR(r)))`,
              ),
            ) ?? 0;
        if (bad)
          issues.push(
            `${label}: the result holds ${bad} error value(s) when calculated on the real cells.`,
          );
        continue;
      }
      const formula = cells[0].formula.slice(1);
      const errors = scalar(
        await host.calculate(`=LET(r,${formula},SUM(--ISERROR(r)))`),
      );
      if (errors)
        issues.push(
          `${label}: the result holds ${errors} error value(s) when calculated on the real cells.`,
        );
      const missing = scalar(
        await host.calculate(`=LET(r,${formula},SUM(--(r="Not found")))`),
      );
      const rows = scalar(await host.calculate(`=ROWS(${formula})-1`));
      if (missing && rows && missing / rows > NOT_FOUND_LIMIT)
        issues.push(
          `${label}: ${missing} lookup cells say "Not found" over ${rows} rows, so the key is probably wrong; call map_relationships and use the real key.`,
        );
    } catch {
      // A check that cannot run never blocks the plan.
    }
  }
  issues.push(...(await evaluateLookups(changes, host)));
  return issues;
}

/** Staged lookup formulas calculated before apply, at most, per plan. */
export const LOOKUP_CHECK_MAX = 4;

const LOOKUP_FUNCTION = /\b(?:X?LOOKUP|VLOOKUP|HLOOKUP|X?MATCH)\s*\(/i;
/** Parts whose value depends on the cell the formula sits in, or that hide a reference in text. */
const CELL_DEPENDENT =
  /@|\b(?:INDIRECT|OFFSET)\s*\(|\b(?:ROW|COLUMN)\s*\(\s*\)/i;
/** String literals, quoted sheet names and structured-reference brackets are kept as they are. */
const OPAQUE =
  /("(?:[^"]|"")*"|'(?:[^']|'')*'|\[(?:[^[\]]|\[[^\]]*\])*\])|([^"'[]+)/g;
const REF = String.raw`\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3}|\$?\d+:\$?\d+`;
/** An A1 reference with no sheet in front of it (Excel forbids LET names that look like one). */
const UNQUALIFIED = new RegExp(
  String.raw`(?<![\w.!$:])(${REF})(?![\w(!:.])`,
  "gi",
);
const QUALIFIED = new RegExp(
  String.raw`(?:'((?:[^']|'')+)'|([^\s!'"(),;=+\-*/&<>^{}\[\]:]+))!(${REF})(#?)`,
  "gi",
);

interface Area {
  sheet: string;
  column: number;
  row: number;
  lastColumn: number;
  lastRow: number;
}

/** Past the last row and column of any sheet. */
const MAX = 1 << 24;
const quoteSheet = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

function area(sheet: string, ref: string, spill = false): Area {
  const text = ref.replace(/\$/g, "");
  const rows = /^(\d+):(\d+)$/.exec(text);
  const box = rows
    ? {
        column: 0,
        lastColumn: MAX,
        row: Math.min(+rows[1], +rows[2]),
        lastRow: Math.max(+rows[1], +rows[2]),
      }
    : parseA1(text);
  return spill
    ? { sheet, ...box, lastColumn: MAX, lastRow: MAX }
    : { sheet, ...box };
}

const sameSheet = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const overlaps = (a: Area, b: Area) =>
  sameSheet(a.sheet, b.sheet) &&
  a.column <= b.lastColumn &&
  b.column <= a.lastColumn &&
  a.row <= b.lastRow &&
  b.row <= a.lastRow;

/**
 * A staged lookup formula with every unqualified reference given the sheet it is written on, so it
 * means the same on the hidden calculate sheet, and the areas it reads. Undefined when it holds no
 * lookup function or its value depends on its own cell (implicit intersection, INDIRECT, OFFSET,
 * ROW()).
 */
export function lookupProbe(
  formula: string,
  sheet: string,
): { formula: string; reads: Area[] } | undefined {
  const reads: Area[] = [];
  let code = "";
  const body = formula
    .replace(/^=/, "")
    .replace(OPAQUE, (part: string, opaque?: string, plain?: string) => {
      if (opaque !== undefined || plain === undefined) return part;
      code += ` ${plain}`;
      return plain.replace(
        UNQUALIFIED,
        (ref: string, _ref: string, offset: number, all: string) => {
          reads.push(area(sheet, ref, all[offset + ref.length] === "#"));
          return `${quoteSheet(sheet)}!${ref}`;
        },
      );
    });
  if (!LOOKUP_FUNCTION.test(code) || CELL_DEPENDENT.test(code))
    return undefined;
  for (const match of formula.matchAll(QUALIFIED)) {
    const name =
      match[1] !== undefined ? match[1].replace(/''/g, "'") : match[2];
    reads.push(area(name, match[3], match[4] === "#"));
  }
  return { formula: body, reads };
}

/** What a staged change may write: areas, a whole sheet by name, or anything ("unknown"). */
function writes(change: StagedChange): Area[] | { sheet: string } | "unknown" {
  switch (change.kind) {
    case "write_values": {
      const start = area(change.sheet, change.cell);
      return [
        {
          ...start,
          lastRow: start.row + Math.max(1, change.values.length) - 1,
          lastColumn:
            start.column +
            Math.max(1, ...change.values.map((row) => row.length)) -
            1,
        },
      ];
    }
    case "write_formula": {
      const start = area(change.sheet, change.cell);
      const out = change.fillRange
        ? area(change.sheet, change.fillRange)
        : { ...start, lastColumn: MAX, lastRow: MAX };
      return change.header && start.row > 1
        ? [out, { ...start, row: start.row - 1, lastRow: start.row - 1 }]
        : [out];
    }
    case "sort_range":
      return [area(change.sheet, change.address)];
    case "create_sheet":
      return { sheet: change.name };
    case "excel_action":
      return typeof change.args.sheet === "string"
        ? { sheet: change.args.sheet }
        : "unknown";
    case "vynor_step":
      return "unknown";
    default:
      // Formats and charts change no values.
      return [];
  }
}

/** The first column of a calculate result: a scalar, a 2-D array, or `{ rows, columns, first }`. */
function firstColumn(value: unknown): unknown[] {
  const grid =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { first?: unknown }).first
      : value;
  if (!Array.isArray(grid)) return [grid];
  return grid.map((row) => (Array.isArray(row) ? row[0] : row));
}

/**
 * Calculates each staged lookup written as one spilled formula (no `fill_range`) before apply, on
 * up to CALC_MAX_ROWS evenly spaced rows of its first column, and reports errors or a high share of
 * "Not found" in the words of `formulaResultHealth`. Skipped, never guessed: a per-row formula with
 * `fill_range` (its relative references move with each row, so one calculate does not show the
 * column), a formula whose value depends on its own cell, and a formula that reads cells another
 * staged change writes (they are not there before apply). The apply's own health check
 * (`formulaResultHealth` in `applyAgentChanges`) still covers those.
 */
export async function evaluateLookups(
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<string[]> {
  const issues: string[] = [];
  let checked = 0;
  for (const { change } of changes) {
    if (checked >= LOOKUP_CHECK_MAX) break;
    if (change.kind !== "write_formula" || change.fillRange) continue;
    try {
      const probe = lookupProbe(change.formula, change.sheet);
      if (!probe) continue;
      const blocked = changes.some(({ change: other }) => {
        const what = writes(other);
        if (what === "unknown") return true;
        if (!Array.isArray(what))
          return probe.reads.some((read) => sameSheet(read.sheet, what.sheet));
        return what.some((box) =>
          probe.reads.some((read) => overlaps(read, box)),
        );
      });
      if (blocked) continue;
      checked += 1;
      const result = await host.calculate(
        `=LET(vynR,${probe.formula},vynN,ROWS(vynR),vynK,MIN(vynN,${CALC_MAX_ROWS}),INDEX(vynR,1+INT((SEQUENCE(vynK)-1)*vynN/vynK),1))`,
      );
      const health = formulaResultHealth(firstColumn(result));
      if (health.warning)
        issues.push(
          `Lookup in ${quoteSheet(change.sheet)}!${change.cell}: calculated on the real cells before apply (${health.checked} evenly spaced row(s)), ${health.warning} Call map_relationships on the source ranges and fix the key or the lookup column.`,
        );
    } catch {
      // A check that cannot run never blocks the plan.
    }
  }
  return issues;
}
