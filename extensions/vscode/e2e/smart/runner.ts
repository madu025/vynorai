import * as fs from "fs";
import * as path from "path";
import { classifyFailure, FailureCategory } from "./model";

export interface ScenarioRecord {
  name: string;
  status: "pass" | "flaky" | "fail" | "model_variance";
  attempts: number;
  durationMs: number;
  creditsUsed?: number;
  category?: FailureCategory;
  explanation?: string;
  errors: string[];
  evidence: string[];
}

const REPORT_DIR = path.join(__dirname, "..", "..", "smart-report");
const records: ScenarioRecord[] = [];

/** Thrown by a scenario check; `evidence` goes to the classifier and report. */
export class CheckFailed extends Error {
  constructor(
    message: string,
    public evidence = "",
  ) {
    super(message);
  }
}

/**
 * Run a scenario against the real model with one retry.
 * - Passes first time: "pass".
 * - Fails, then passes: "flaky" (reported, never hidden).
 * - Fails twice: the classifier decides. PRODUCT_BUG and INFRA fail the run;
 *   MODEL_VARIANCE is reported for a human but does not block the release.
 */
export async function smartScenario(
  name: string,
  expectation: string,
  attempt: (attemptNo: number) => Promise<{ creditsUsed?: number } | void>,
  options: { retries?: number } = {},
): Promise<void> {
  const retries = options.retries ?? 1;
  const record: ScenarioRecord = {
    name,
    status: "pass",
    attempts: 0,
    durationMs: 0,
    errors: [],
    evidence: [],
  };
  const started = Date.now();
  try {
    for (let i = 0; i <= retries; i++) {
      record.attempts = i + 1;
      try {
        const result = await attempt(i + 1);
        if (result?.creditsUsed !== undefined)
          record.creditsUsed = result.creditsUsed;
        record.status = i === 0 ? "pass" : "flaky";
        return;
      } catch (error) {
        const err = error as Error & { evidence?: string };
        record.errors.push(err.message);
        if (err.evidence) record.evidence.push(err.evidence);
      }
    }
    const verdict = await classifyFailure({
      scenario: name,
      expectation,
      error: record.errors.join("\n---\n"),
      evidence: record.evidence.join("\n---\n"),
    });
    record.category = verdict.category;
    record.explanation = verdict.explanation;
    if (verdict.category === "MODEL_VARIANCE") {
      record.status = "model_variance";
      return;
    }
    record.status = "fail";
    throw new Error(
      `[${verdict.category}] ${name}: ${verdict.explanation}\n${record.errors.join("\n")}`,
    );
  } finally {
    record.durationMs = Date.now() - started;
    records.push(record);
    writeReport();
  }
}

function writeReport() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, "report.json"),
    JSON.stringify({ at: new Date().toISOString(), records }, null, 2),
  );
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = records
    .map(
      (r) =>
        `<tr class="${r.status}"><td>${esc(r.name)}</td><td>${r.status}</td>` +
        `<td>${r.attempts}</td><td>${(r.durationMs / 1000).toFixed(1)}s</td>` +
        `<td>${r.creditsUsed ?? ""}</td><td>${esc(r.category ?? "")}</td>` +
        `<td>${esc(r.explanation ?? r.errors.join(" | "))}</td></tr>`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(REPORT_DIR, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>VynorAI Smart E2E</title>
<style>body{font:14px system-ui;margin:24px}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
.pass td:nth-child(2){color:#167a2d}.flaky td:nth-child(2),.model_variance td:nth-child(2){color:#a86b00}.fail td:nth-child(2){color:#b00020;font-weight:600}</style>
<h1>VynorAI Smart E2E</h1><p>${new Date().toISOString()}</p>
<table><tr><th>Scenario</th><th>Status</th><th>Attempts</th><th>Time</th><th>Credits</th><th>Category</th><th>Details</th></tr>
${rows}</table>`,
  );
}
