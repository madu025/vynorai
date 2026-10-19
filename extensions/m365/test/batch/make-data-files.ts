/**
 * Writes the five test datasets as real .xlsx files for live testing in Excel on the web:
 *   npx tsx test/batch/make-data-files.ts   ->   extensions/m365/test-data/xlsx/*.xlsx
 * Text IDs use the Text format (leading zeros kept); the "text-date" column is text on purpose.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DATASETS } from "./datasets500.js";
import { buildXlsx, type XlsxCell } from "./xlsxWriter.js";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test-data/xlsx",
);
mkdirSync(out, { recursive: true });
for (const dataset of DATASETS) {
  const headers = dataset.columns.map((column) => column.name);
  const textColumns = dataset.columns
    .map((column, index) => (column.kind === "id" ? index : -1))
    .filter((index) => index >= 0);
  const rows: XlsxCell[][] = dataset.rows.map((row) =>
    row.map((cell, index) =>
      dataset.columns[index].kind === "date" && typeof cell === "number"
        ? { date: cell }
        : cell,
    ),
  );
  const file = join(out, `vynor-test-${dataset.id}.xlsx`);
  writeFileSync(file, buildXlsx(dataset.sheet, headers, rows, textColumns));
  console.log(file, `${dataset.rows.length} rows x ${headers.length} columns`);
}
