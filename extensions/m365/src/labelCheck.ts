/**
 * "Total by Region" means the readable names (Western, Central, ...), not the 20 or so Region IDs.
 * When a staged GROUPBY/PIVOTBY groups on an ID column, the request names that entity without "ID",
 * and another sheet holds the same ID next to a "<Entity> Name" column, the plan goes back to the
 * builder before any reviewer runs. Read-only: it reads header cells only.
 */
import type { AgentHost, StagedChange } from "./agent.js";

const ID_HEADER = /^(.+?)\s*(?:id|code|no|number)\.?$/i;
const NAME_SUFFIX = /^(?:name|title|label|description)$/i;
const HEADER_SCAN = "A1:Z1";
const MAX_SHEETS = 12;

/** The first argument of the GROUPBY/PIVOTBY call in a formula, or undefined. */
function firstArgument(formula: string): string | undefined {
  const match = /\b(?:GROUPBY|PIVOTBY)\s*\(/i.exec(formula);
  if (!match) return undefined;
  let depth = 0;
  let quoted = false;
  let out = "";
  for (let i = match.index + match[0].length; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
    }
    out += ch;
  }
  return out.trim();
}

/** 'Orders'!F2:F3001 as a sheet and a column letter; anything computed is not a plain column. */
function plainColumn(
  argument: string,
): { sheet: string; column: string } | undefined {
  const m =
    /^(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!\$?([A-Z]{1,3})\$?\d+:\$?\3\$?\d+$/.exec(
      argument,
    );
  return m
    ? { sheet: (m[1] ?? m[2]).replace(/''/g, "'"), column: m[3] }
    : undefined;
}

const text = (cell: unknown) => String(cell ?? "").trim();

const escapeRegex = (value: string) =>
  value.replace(/[\\^$.*+?()[\]{}|]/g, (char) => `\\${char}`);

const hasWord = (haystack: string, word: string) =>
  new RegExp(`\\b${escapeRegex(word)}\\b`, "i").test(haystack);

export async function checkLabelGrouping(
  request: string,
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<string[]> {
  const issues: string[] = [];
  for (const { change } of changes) {
    if (change.kind !== "write_formula" || change.fillRange) continue;
    const argument = firstArgument(change.formula);
    const grouped = argument ? plainColumn(argument) : undefined;
    if (!grouped) continue;
    try {
      const read = await host.readRange(
        grouped.sheet,
        `${grouped.column}1:${grouped.column}1`,
        false,
      );
      const header = text(read.values[0]?.[0]);
      const stem = ID_HEADER.exec(header)?.[1]?.trim();
      if (!stem) continue;
      // The person asked for the entity ("by Region"), not for its ID column.
      if (!hasWord(request, stem) || hasWord(request, header)) continue;
      const workbook = (await host.getWorkbook()) as
        | { sheets?: { name?: unknown }[] }
        | undefined;
      const names = (workbook?.sheets ?? [])
        .map((sheet) => text(sheet.name))
        .filter((name) => name && name !== grouped.sheet)
        .slice(0, MAX_SHEETS);
      for (const name of names) {
        const heads =
          (await host.readRange(name, HEADER_SCAN, false)).values[0]?.map(
            text,
          ) ?? [];
        const hasKey = heads.some(
          (head) => head.toLowerCase() === header.toLowerCase(),
        );
        const label = heads.find((head) => {
          const m = new RegExp(`^${escapeRegex(stem)}\\s+(.+)$`, "i").exec(
            head,
          );
          return !!m && NAME_SUFFIX.test(m[1]);
        });
        if (hasKey && label) {
          issues.push(
            `'${change.sheet}'!${change.cell}: the request says "${stem}", but this groups by the "${header}" column, so every ID becomes its own row. Group by the readable "${label}" from sheet '${name}' instead (look each "${header}" up in '${name}', then group the names), so each ${stem.toLowerCase()} appears once, and put the amounts under the matching headers.`,
          );
          break;
        }
      }
    } catch {
      // A check that cannot run never blocks the plan.
    }
  }
  return issues;
}
