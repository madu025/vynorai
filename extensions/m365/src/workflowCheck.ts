/**
 * A sentence can name several jobs ("clean it, pivot Sales by Region, chart it and add a summary").
 * The planner keeps the jobs it understood; this finds the ones it did not, so a request is never
 * dropped silently. It only reads the sentence and the chosen action kinds, so it is cheap and exact.
 */
type Job = {
  /** What the person asked for, in the words used in the message. */
  label: string;
  /** Matches the sentence when the job is named. */
  mention: RegExp;
  /** Action kinds that fulfil it; any one is enough. */
  covers: string[];
  /** One example the person can say to get it. */
  example: string;
};

const JOBS: Job[] = [
  {
    label: "clean-up",
    mention:
      /\b(clean(?:\s?up)?|tidy|trim(?:\s+spaces)?|dedup\w*|deduplicate|remove duplicates?)\b/,
    covers: ["clean"],
    example: "clean the data: trim spaces and remove duplicates",
  },
  {
    label: "summary",
    mention: /\bsummar(?:y|ize|ise|ies)\b(?!\s+(?:sheet|worksheet|tab)\b)/,
    covers: ["summary", "dashboard", "pivot-table", "statistics"],
    example: "summary of total <value column> by <category column>",
  },
  {
    label: "PivotTable",
    mention: /\bpivot\b/,
    covers: ["pivot-table", "dashboard"],
    example: "pivot table of total <value column> by <category column>",
  },
  {
    label: "chart",
    mention: /\b(chart|graph|histogram)\b/,
    covers: ["chart", "dashboard"],
    example: "column chart of total <value column> by <category column>",
  },
  {
    label: "quality check",
    mention: /\b(quality check|data quality|audit)\b/,
    covers: ["quality"],
    example: "data quality report",
  },
  {
    label: "formatting",
    mention: /\b(highlight|conditional format\w*|colou?r scale)\b/,
    // A view can carry the highlight itself ("highlight the top 10").
    covers: ["format", "view"],
    example: "highlight <column> greater than <number>",
  },
  {
    label: "split",
    mention: /\bsplit\b/,
    covers: ["split-column"],
    example: "split <column> into first name and last name",
  },
  {
    label: "unpivot",
    mention: /\bunpivot\b/,
    covers: ["unpivot"],
    example: "unpivot the month columns",
  },
  {
    label: "lookup",
    mention: /\b(v?lookup|look up)\b/,
    covers: ["lookup-columns", "add-column"],
    example: "look up <columns> from <sheet> by <key column>",
  },
  {
    label: "statistics",
    mention: /\b(correlation|forecast|describe|statistics|anomal\w+)\b/,
    covers: ["statistics", "dashboard"],
    example: "describe the numeric columns",
  },
];

export type UnhandledJob = { label: string; example: string };

/**
 * Jobs the sentence names that none of the planned actions cover. `actions` are the final action
 * kinds of the plan.
 */
export function findUnhandledJobs(
  instruction: string,
  actions: readonly string[],
): UnhandledJob[] {
  const text = instruction.toLocaleLowerCase().replace(/[_-]+/g, " ");
  return JOBS.filter(
    (job) =>
      job.mention.test(text) &&
      !job.covers.some((kind) => actions.includes(kind)),
  ).map(({ label, example }) => ({ label, example }));
}

/** One sentence for the pane, or undefined when every named job is in the plan. */
export function describeUnhandledJobs(
  jobs: readonly UnhandledJob[],
): string | undefined {
  if (!jobs.length) return undefined;
  const parts = jobs.map((job) => `${job.label} (say: "${job.example}")`);
  return `Not in this plan: ${parts.join("; ")}. Ask for ${jobs.length === 1 ? "it" : "each"} as a separate step after this one.`;
}
