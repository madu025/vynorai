/**
 * Checks a staged `combine_tables` join or reconcile against the real cells before the person is
 * asked to approve it: a result beside its source data spills into the table (#SPILL!), and a key
 * column that matches almost nothing fills the whole column with "Not found".
 */
import { AgentToolError, type AgentHost } from "./agent.js";

const MIN_SHARE = 0.5;

const loose = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^0+(?=\d)/, "");

export async function guardCombine(
  args: Record<string, unknown>,
  host: AgentHost,
  readAddress: (address: string) => { address: string; clipped: boolean },
): Promise<void> {
  const mode = String(args.mode);
  const target = String(args.sheet);
  if (
    (mode === "join" || mode === "append") &&
    (target === args.left_sheet || target === args.right_sheet)
  )
    throw new AgentToolError(
      `Write the ${mode} result on a new sheet (stage create_sheet, then use it as sheet): beside or over '${target}' a spilled formula gives #SPILL! or covers the data.`,
    );
  if (mode === "append") return;
  const read = async (sheet: string, address: string) => {
    const clamped = readAddress(address);
    const result = await host.readRange(sheet, clamped.address, false);
    const [header = [], ...rows] = result.values as unknown[][];
    return {
      header: header.map((cell) => String(cell ?? "")),
      rows,
      clipped: clamped.clipped,
    };
  };
  let left;
  let right;
  try {
    left = await read(String(args.left_sheet), String(args.left_address));
    right = await read(String(args.right_sheet), String(args.right_address));
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    return;
  }
  const find = (header: string[], name: unknown, where: string) => {
    const at = header.findIndex((cell) => loose(cell) === loose(name));
    if (at < 0)
      throw new AgentToolError(
        `There is no column "${String(name)}" in the header row of ${where} (${header.slice(0, 12).join(", ")}). Use the exact header, or tell the person it does not exist.`,
      );
    return at;
  };
  const li = find(
    left.header,
    args.key,
    `${args.left_sheet}!${args.left_address}`,
  );
  const ri = find(
    right.header,
    args.right_key || args.key,
    `${args.right_sheet}!${args.right_address}`,
  );
  if (left.clipped || right.clipped)
    throw new AgentToolError(
      `The ${mode} key ranges are too large to verify completely for duplicate keys. Narrow the ranges before applying this ${mode}.`,
    );
  const rightKeys = new Set(right.rows.map((row) => loose(row[ri])));
  const duplicateKeys = (rows: unknown[][], index: number) => {
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
      const key = loose(row[index]);
      if (!key) continue;
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    return duplicates;
  };
  const rejectDuplicates = (
    rows: unknown[][],
    index: number,
    table: typeof right,
    side: string,
  ) => {
    const duplicates = duplicateKeys(rows, index);
    if (duplicates.size)
      throw new AgentToolError(
        `The ${mode} key "${table.header[index]}" has ${duplicates.size} duplicate value(s) in ${side}. ${mode === "join" ? "XLOOKUP would silently use the first match; deduplicate or aggregate that table before joining." : "Reconcile counts and amounts would be ambiguous; deduplicate or aggregate both tables first."}`,
      );
  };
  if (mode === "join")
    rejectDuplicates(right.rows, ri, right, String(args.right_sheet));
  else {
    rejectDuplicates(left.rows, li, left, String(args.left_sheet));
    rejectDuplicates(right.rows, ri, right, String(args.right_sheet));
  }
  const present = left.rows.filter((row) => loose(row[li]) !== "");
  if (!present.length) return;
  const matched = present.filter((row) => rightKeys.has(loose(row[li]))).length;
  if (matched / present.length < MIN_SHARE)
    throw new AgentToolError(
      `Only ${matched} of ${present.length} values of "${left.header[li]}" exist in "${right.header[ri]}", so most rows would say "Not found". Call map_relationships on both ranges to find the real key, or tell the person the sheets do not share one.`,
    );
}
