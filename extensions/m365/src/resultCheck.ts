/**
 * Evaluates the staged cross-sheet joins, appends and reconciliations on the real cells before any reviewer model runs: how many
 * result cells would be errors and how many rows would say "Not found". A model reviewer reading
 * the one-line description cannot see the formula `combine_tables` writes, so this check does.
 * Read-only: `host.calculate` leaves nothing in the workbook.
 */
import { clampReadAddress, type AgentHost, type StagedChange } from "./agent.js";
import { combineCells } from "./combineSheets.js";

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
      const rows = scalar(
        await host.calculate(`=ROWS(${formula})-1`),
      );
      if (missing && rows && missing / rows > NOT_FOUND_LIMIT)
        issues.push(
          `${label}: ${missing} lookup cells say "Not found" over ${rows} rows, so the key is probably wrong; call map_relationships and use the real key.`,
        );
    } catch {
      // A check that cannot run never blocks the plan.
    }
  }
  return issues;
}
