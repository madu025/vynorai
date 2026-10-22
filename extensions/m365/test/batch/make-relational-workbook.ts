import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  relationalWorkbookSheets,
  relationalWorkbookXlsx,
} from "./relationalWorkbook.js";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test-data/xlsx",
);
mkdirSync(out, { recursive: true });
const file = join(out, "vynor-relational-10-sheet.xlsx");
writeFileSync(file, relationalWorkbookXlsx());
for (const sheet of relationalWorkbookSheets())
  console.log(
    `${sheet.name}: ${sheet.rows.length} data rows x ${sheet.headers.length} columns`,
  );
console.log(file);
