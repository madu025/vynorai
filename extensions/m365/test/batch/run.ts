/**
 * Offline batch: every non-proven case goes through the same path the task pane uses
 * (interpretInstruction -> adaptForSampledRange -> createExcelPreviewPlan) and through the server
 * planner for parity. No Excel needed. Output: docs/BATCH_REPORT.md (section "Phase 2").
 *   npx tsx test/batch/run.ts [--all]   (--all also runs the proven cases)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  excelPlansMatch,
} from "../../src/excel.js";
import {
  answerQuestion,
  interpretInstruction,
  looksLikeQuestion,
} from "../../src/intent.js";
import { createServerExcelPreviewPlan } from "../../../../backend/src/services/m365ExcelPlan.js";
import { CASES, type BatchCase } from "./cases.js";

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
const rtoms = ["R-HK", "R-GP", "R-HT", "R-KL", "R-WT"];
const rows = Array.from({ length: 200 }, (_, index) => [
  `HK2024${String(index).padStart(6, "0")}`,
  rtoms[index % rtoms.length],
  ["HK", "NT", "KPT", "BDG"][index % 4],
  45720 + (index % 30),
  ["S", "E", "X"][index % 3],
  `OSPACC${String(index % 20).padStart(3, "0")}`,
  (index % 7) + 1,
  index % 11 === 0 ? null : (index % 5) + 1,
  index % 9 === 0 ? "km" : "Ea",
  `0112${String(index).padStart(6, "0")}`,
]);

const input = (size: BatchCase["size"]) => {
  const base: any = {
    workbookId: "w",
    worksheetName: "detail-report",
    address: "A1:J201",
    values: [HEADERS, ...rows],
    hasHeaders: true,
  };
  if (size === "small") return base;
  const total = size === "520k" ? 520126 : 50001;
  return {
    ...base,
    address: `A1:J${total}`,
    sample: { totalRows: total, sampledRows: 201 },
  };
};

interface Outcome {
  id: string;
  variant: "en" | "si";
  size: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

function runOne(item: BatchCase, text: string, variant: "en" | "si"): Outcome {
  const done = (status: Outcome["status"], detail: string): Outcome => ({
    id: item.id,
    variant,
    size: item.size,
    status,
    detail,
  });
  if (item.expect === "gap") return done("skip", "known gap: not implemented");
  if (item.expect === "ui" || item.expect === "formula-inspector")
    return done("skip", "live only");
  try {
    const data = input(item.size);
    if (item.expect === "answer") {
      if (!looksLikeQuestion(text))
        return done("fail", "not recognised as a question");
      const answer = answerQuestion(text, HEADERS, rows as any);
      return answer
        ? done("pass", answer.answer.slice(0, 80))
        : done("fail", "no deterministic answer");
    }
    if (item.id === "q-large") return done("skip", "live only");
    const interpreted: any = interpretInstruction(text, HEADERS, rows as any);
    let actions = interpreted.actions as any[];
    let specs = interpreted.specs ?? {};
    if (!actions.length)
      return done(
        "fail",
        `not understood: ${(interpreted.problems ?? []).join(" ") || "no action"}`,
      );
    if (data.sample) {
      const adapted = adaptForSampledRange(actions, specs);
      actions = adapted.actions;
      specs = adapted.specs;
    }
    if (!actions.includes(item.expect))
      return done("fail", `expected ${item.expect}, got ${actions.join("+")}`);
    let local: any;
    try {
      local = createExcelPreviewPlan(data, actions, 500, specs);
    } catch (error) {
      const message = (error as Error).message;
      return ["table", "slicer", "new-sheet"].includes(item.expect) &&
        item.size === "520k"
        ? done("pass", `refused: ${message.slice(0, 80)}`)
        : done("fail", `plan failed: ${message.slice(0, 160)}`);
    }
    if (["table", "slicer", "new-sheet"].includes(item.expect) && data.sample)
      return done("fail", "should have been refused on a very large range");
    let server: any;
    try {
      server = createServerExcelPreviewPlan(data, actions, 500, specs);
    } catch (error) {
      return done(
        "fail",
        `server plan failed: ${(error as Error).message.slice(0, 160)}`,
      );
    }
    return excelPlansMatch(local, server)
      ? done("pass", `${actions.join("+")} plan ok`)
      : done("fail", "client/server plans differ");
  } catch (error) {
    return done("fail", `exception: ${(error as Error).message.slice(0, 160)}`);
  }
}

function provenIds(): Set<string> {
  if (process.argv.includes("--all")) return new Set();
  const lines = readFileSync(
    new URL("../../../../docs/BATCH_PROVEN.md", import.meta.url),
    "utf8",
  ).split("\n");
  const proven = new Set<string>();
  for (const line of lines) {
    const [id, , commit, files] = line.split("|").map((part) => part.trim());
    if (
      !id ||
      !commit ||
      !files ||
      id.startsWith("#") ||
      id.startsWith("Format")
    )
      continue;
    try {
      const diff = execSync(
        `git diff --stat ${commit} HEAD -- ${files
          .split(",")
          .map((f) => f.trim())
          .join(" ")}`,
        { cwd: new URL("../../../../", import.meta.url), encoding: "utf8" },
      );
      if (!diff.trim()) proven.add(id);
    } catch {
      // an unknown commit means the case must be retested
    }
  }
  return proven;
}

const proven = provenIds();
const outcomes: Outcome[] = [];
for (const item of CASES) {
  if (item.proven && proven.has(item.proven)) continue;
  outcomes.push(runOne(item, item.en, "en"));
  if (item.si) outcomes.push(runOne(item, item.si, "si"));
}
const count = (status: Outcome["status"]) =>
  outcomes.filter((outcome) => outcome.status === status).length;
const report = [
  "## Phase 2 - offline batch",
  "",
  `proven and skipped: ${CASES.filter((item) => item.proven && proven.has(item.proven)).length}; ran: ${outcomes.length}; pass ${count("pass")}, fail ${count("fail")}, skipped ${count("skip")}`,
  "",
  "| id | variant | size | status | detail |",
  "|---|---|---|---|---|",
  ...outcomes.map(
    (outcome) =>
      `| ${outcome.id} | ${outcome.variant} | ${outcome.size} | ${outcome.status} | ${outcome.detail.replace(/\|/g, "/")} |`,
  ),
  "",
].join("\n");
writeFileSync(
  new URL("../../../../docs/BATCH_REPORT.md", import.meta.url),
  `# Batch report\n\n${report}`,
);
console.log(
  `ran ${outcomes.length}: pass ${count("pass")} fail ${count("fail")} skip ${count("skip")}`,
);
for (const outcome of outcomes.filter((entry) => entry.status === "fail"))
  console.log(`FAIL ${outcome.id}/${outcome.variant}: ${outcome.detail}`);
