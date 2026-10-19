/**
 * Robustness sweep: every batch case is re-asked in harmless variations (case, politeness, spacing,
 * punctuation) and must resolve to the same actions as the plain sentence. A difference is a place where
 * a person who types a little differently gets a different, or no, result.
 *   npx tsx test/batch/fuzz.ts
 */
import {
  interpretInstruction,
  looksLikeQuestion,
  normalizeInstruction,
} from "../../src/intent.js";
import { selectExcelActions } from "../../src/excel.js";
import { CASES } from "./cases.js";

const HEADERS = [
  "Service ID",
  "RTOM",
  "LEA",
  "PAT Complete Date",
  "Status",
  "Item Code",
  "Requested Quantity",
  "Issued Quantity",
  "UoM",
  "Circuit ID",
];
const rows = Array.from({ length: 50 }, (_, index) => [
  `HK${String(index).padStart(8, "0")}`,
  ["R-HK", "R-GP", "R-HT"][index % 3],
  ["HK", "NT"][index % 2],
  45720 + (index % 30),
  index % 2 ? "Done" : "Open",
  `IC${index % 7}`,
  index * 3,
  index * 2,
  "Nos",
  `C${index}`,
]);

const kinds = (raw: string): string[] => {
  // The task pane normalises the sentence before reading it; so does this sweep.
  const text = normalizeInstruction(raw);
  const interpreted: any = interpretInstruction(text, HEADERS, rows as any);
  return [
    ...new Set([
      ...selectExcelActions(text),
      ...(interpreted.actions as string[]),
    ]),
  ].sort();
};

const VARIANTS: Array<[string, (text: string) => string]> = [
  ["upper case", (text) => text.toUpperCase()],
  ["lower case", (text) => text.toLowerCase()],
  ["please", (text) => `please ${text}`],
  ["could you", (text) => `could you ${text}`],
  ["trailing period", (text) => `${text}.`],
  ["double spaces", (text) => text.replace(/ /g, "  ")],
  ["leading/trailing space", (text) => `  ${text}  `],
  ["thanks", (text) => `${text}, thanks`],
];

let checked = 0;
const differences: string[] = [];
for (const item of CASES) {
  if (
    ![
      "table",
      "chart",
      "pivot-table",
      "clean",
      "add-column",
      "summary",
      "format",
      "quality",
      "statistics",
      "view",
      "dashboard",
      "lookup-columns",
      "split-column",
      "unpivot",
      "named-range",
      "slicer",
      "new-sheet",
    ].includes(item.expect)
  )
    continue;
  if (item.size !== "small") continue;
  const base = kinds(item.en);
  if (!base.length) continue;
  for (const [name, change] of VARIANTS) {
    const varied = change(item.en);
    // A polite question is a question; those are covered by the answer cases.
    if (looksLikeQuestion(varied) && !looksLikeQuestion(item.en)) continue;
    checked += 1;
    const got = kinds(varied);
    if (JSON.stringify(got) !== JSON.stringify(base))
      differences.push(
        `${item.id} [${name}]: ${base.join("+")} -> ${got.join("+") || "nothing"}  | "${varied.trim().slice(0, 90)}"`,
      );
  }
}
console.log(`checked ${checked} variations, ${differences.length} differ`);
for (const line of differences) console.log(line);
process.exit(differences.length ? 1 : 0);
