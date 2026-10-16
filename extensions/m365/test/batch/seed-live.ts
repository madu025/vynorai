/** Appends cases that passed live to docs/BATCH_PROVEN.md: npx tsx test/batch/seed-live.ts <commit> <id,id,...> */
import { appendFileSync, readFileSync } from "node:fs";
import { CASES } from "./cases.js";

const [commit, list] = process.argv.slice(2);
const file = new URL("../../../../docs/BATCH_PROVEN.md", import.meta.url);
const have = readFileSync(file, "utf8");
const lines: string[] = [];
for (const id of (list ?? "").split(",").filter(Boolean)) {
  const item = CASES.find((entry) => entry.id === id);
  if (!item) throw new Error(`unknown case ${id}`);
  if (have.includes(`${id} |`)) continue;
  lines.push(
    `${id} | ${new Date().toISOString().slice(0, 10)} | ${commit} | ${item.files.join(", ")}`,
  );
}
appendFileSync(file, lines.join("\n") + "\n");
console.log("appended", lines.length);
