import { MAX_TEXT_CHARS, buildAssistRequest } from "./textAssist.js";

export interface ReportResultLine {
  kind: string;
  name: string;
  targetSheet: string;
  status: string;
}

/** Room left for the "Facts" frame around the summary inside the text limit. */
const SUMMARY_LIMIT = MAX_TEXT_CHARS - 400;

/**
 * The exact text shown to the person and, after consent, sent to the AI: result lines plus at most
 * 40 report rows. No other cell of the workbook is ever included. Over-long text is cut on a line
 * boundary and says so, so it is never truncated silently.
 */
export function reportSummaryText(
  results: ReportResultLine[],
  sheet: string,
  values: unknown[][],
  truncated: boolean,
): string {
  const resultLines = results
    .slice(-20)
    .map((r) => `- ${r.kind}: ${r.name} on ${r.targetSheet} (${r.status})`);
  const tableLines = values
    .slice(0, 40)
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "));
  const lines = [
    "VynorAI Excel report",
    `Report sheet: ${sheet}`,
    resultLines.length ? "Results:" : "Results: none recorded",
    ...resultLines,
    ...tableLines,
    truncated ? "[Report preview truncated to a bounded local sample]" : "",
  ].filter(Boolean);
  let text = lines.join("\n");
  if (text.length > SUMMARY_LIMIT) {
    const kept: string[] = [];
    let size = 0;
    for (const line of lines) {
      if (size + line.length + 1 > SUMMARY_LIMIT - 60) break;
      kept.push(line);
      size += line.length + 1;
    }
    kept.push("[Summary shortened to fit the AI limit]");
    text = kept.join("\n");
  }
  return text;
}

/** What the person is asked to approve before anything leaves the task pane. */
export function reportEmailConsentMessage(summary: string): string {
  return `Send this report summary to VynorAI AI to write the email message? Only the text below is sent, no other cells.\n\n${summary}`;
}

/** Request for the existing text assist route; consent is a precondition of building it. */
export function buildReportEmailRequest(summary: string, consent: boolean) {
  return buildAssistRequest({
    host: "excel",
    task: "report-email",
    tone: "friendly",
    text: summary,
    consent,
  });
}
