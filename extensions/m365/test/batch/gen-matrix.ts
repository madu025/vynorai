import { writeFileSync } from "node:fs";
import { CASES } from "./cases.js";

const rows = CASES.map(
  (item) =>
    `| ${item.id} | ${item.area} | ${item.en.replace(/\|/g, "/")} | ${item.si ?? ""} | ${item.size} | ${item.expect} | ${item.proven ? "proven: " + item.proven : ""} |`,
);
writeFileSync(
  new URL("../../../../docs/BATCH_TEST_MATRIX.md", import.meta.url),
  [
    "# Batch test matrix (generated from extensions/m365/test/batch/cases.ts)",
    "",
    `${CASES.length} cases. Regenerate with \`npx tsx test/batch/gen-matrix.ts\` from extensions/m365.`,
    "",
    "| id | area | request | Sinhala/Singlish | size | expect | status |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"),
);
console.log("cases", CASES.length);
