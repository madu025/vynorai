import { appendFileSync, readFileSync } from "node:fs";
import { CASES } from "./cases.js";

const file = new URL("../../../../docs/BATCH_PROVEN.md", import.meta.url);
const have = readFileSync(file, "utf8");
const lines = CASES.filter(
  (item) => item.proven && !have.includes(`${item.proven} |`),
).map(
  (item) => `${item.proven} | 2026-10-16 | 8c6315f | ${item.files.join(", ")}`,
);
// Cases proven live in the earlier session that have no matrix row of their own.
appendFileSync(file, lines.join("\n") + "\n");
console.log("seeded", lines.length);
