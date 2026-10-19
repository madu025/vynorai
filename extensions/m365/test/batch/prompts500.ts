/**
 * 100 prompts per dataset (500 in all) built from request families filled with each dataset's real
 * column names: English formal and casual, Singlish, Sinhala, polite wording, multi-step sentences,
 * questions and code requests. Every prompt carries the actions it must produce (any one of
 * `expectAny`, all of `expectAll`) so a pass means the right thing was understood, not just something.
 */
import type { Dataset } from "./datasets500.js";

export type Prompt = {
  id: string;
  dataset: string;
  text: string;
  /** "action" goes through the reader/AI path, "macro" through code generation, "answer" is a question. */
  mode: "action" | "macro" | "answer" | "refuse";
  expectAny: string[];
  expectAll?: string[];
  family: string;
};

export function buildPrompts(dataset: Dataset): Prompt[] {
  const names = dataset.columns.map((column) => column.name);
  const of = (kind: string) =>
    dataset.columns
      .filter((column) => column.kind === kind)
      .map((column) => column.name);
  const measures = of("measure");
  const categories = of("category");
  const dates = of("date");
  const people = of("name");
  const m1 = measures[0];
  const m2 = measures[1] ?? measures[0];
  const c1 = categories[0];
  const c2 = categories[1] ?? categories[0];
  const d1 = dates[0];
  const person = people[0];
  const id = of("id")[0];

  const out: Prompt[] = [];
  let counter = 0;
  const add = (
    family: string,
    mode: Prompt["mode"],
    expectAny: string[],
    texts: Array<string | undefined>,
    expectAll?: string[],
  ) => {
    for (const text of texts) {
      if (!text || text.includes("undefined")) continue;
      counter += 1;
      out.push({
        id: `${dataset.id}-${String(counter).padStart(3, "0")}`,
        dataset: dataset.id,
        text,
        mode,
        expectAny,
        expectAll,
        family,
      });
    }
  };

  add(
    "pivot-sum",
    "action",
    ["pivot-table"],
    [
      `pivot table of total ${m1} by ${c1}`,
      `can you make a pivot of ${m1} per ${c1}`,
      `${c1} walata ${m1} total ekak pivot ekak hadanna`,
      `${c1} අනුව ${m1} එකතුව pivot එකක් හදන්න`,
    ],
  );
  add(
    "pivot-avg",
    "action",
    ["pivot-table"],
    [
      `pivot table of average ${m1} by ${c2}`,
      `show the average ${m1} for each ${c2} in a pivot`,
    ],
  );
  add(
    "pivot-count",
    "action",
    ["pivot-table"],
    [
      `pivot table counting rows by ${c1}`,
      `how many records per ${c2}, as a pivot table`,
    ],
  );
  add("top-answer", "answer", [], [`top 5 ${c1} by total ${m1}`]);
  add(
    "pivot-top",
    "action",
    ["pivot-table"],
    [
      `pivot table of total ${m1} by ${c1}, top 3`,
      `bottom 3 ${c2} by ${m1} pivot`,
    ],
  );
  add(
    "chart-bar",
    "action",
    ["chart"],
    [
      `bar chart of total ${m1} by ${c1}`,
      `make a column chart showing ${m1} for each ${c2}`,
      `${c1} wise ${m1} bar chart ekak denna`,
    ],
  );
  add(
    "chart-pie",
    "action",
    ["chart"],
    [`pie chart of ${m1} by ${c2}`, `${c2} wise ${m1} pie chart ekak hadanna`],
  );
  add(
    "chart-line",
    "action",
    ["chart"],
    d1
      ? [
          `line chart of total ${m1} over ${d1}`,
          `trend of ${m1} by ${d1} as a line chart`,
        ]
      : [],
  );
  add(
    "chart-histogram",
    "action",
    ["chart"],
    [`histogram of ${m1}`, `show the distribution of ${m2} as a histogram`],
  );
  add(
    "summary",
    "action",
    ["summary", "pivot-table", "dashboard"],
    [
      `summary of total ${m1} by ${c1}`,
      `summarize ${m2} per ${c2} on a new sheet`,
    ],
  );
  add(
    "clean-trim",
    "action",
    ["clean"],
    [
      "trim extra spaces",
      "this sheet is messy, fix the extra spaces",
      "sheet eka pirisidu karanna",
      "පත්‍රය පිරිසිදු කරන්න",
    ],
  );
  add(
    "clean-dedupe",
    "action",
    ["clean"],
    [
      "remove duplicate rows",
      "delete the duplicates please",
      "duplicate rows ain karanna",
    ],
  );
  add(
    "clean-fill",
    "action",
    ["clean"],
    [`fill blank cells in ${m1} with 0`, "fill empty cells with 0"],
  );
  add(
    "quality",
    "action",
    ["quality"],
    [
      "check the data quality",
      "are there any problems with this data?",
      "data quality report",
      "data wala awul thiyenawada balanna",
    ],
  );
  add(
    "add-ratio",
    "action",
    ["add-column"],
    m1 !== m2
      ? [
          `add a column Ratio that is ${m1} divided by ${m2}`,
          `add a column Product = ${m1} * ${m2}`,
          `add a column Sum that is ${m1} plus ${m2}`,
        ]
      : [],
  );
  add(
    "add-share",
    "action",
    ["add-column"],
    [
      `show each row ${m1} as a percentage of the total ${m1}`,
      `add a column with the share of total ${m1}`,
    ],
  );
  add(
    "add-year",
    "action",
    ["add-column"],
    d1
      ? [
          `add a column Year from ${d1}`,
          `I need a new column with only the month of ${d1}`,
        ]
      : [],
  );
  add(
    "add-flag",
    "action",
    ["add-column"],
    [
      `add a column that says Above or Below depending on whether ${m1} is over the average`,
      `${m1} eka average ekata wada kiyak wenas da kiyala column ekak danna`,
    ],
  );
  add(
    "highlight",
    "action",
    ["format", "view"],
    [
      `highlight ${m1} greater than 100`,
      `mark the rows where ${m2} is bigger than 50`,
      `highlight the top 10 ${m1}`,
      `highlight duplicates in ${c1}`,
    ],
  );
  add("sort", "action", ["view"], [`sort by ${m1} descending`]);
  add(
    "sort-two-keys",
    "refuse",
    [],
    [`show the rows sorted by ${c1} then ${m1}`],
  );
  add(
    "filter",
    "action",
    ["view"],
    [
      `show only rows where ${m1} is greater than 100`,
      `filter ${c1} contains a`,
      `show the first 20 rows sorted by ${m2}`,
    ],
  );
  add(
    "stats-describe",
    "action",
    ["statistics"],
    ["describe the numeric columns", "give me summary statistics"],
  );
  add(
    "stats-correlation",
    "action",
    ["statistics"],
    m1 !== m2 ? [`correlation between ${m1} and ${m2}`] : [],
  );
  add(
    "stats-forecast",
    "action",
    ["statistics"],
    [`predict ${m1} for the next 6 periods`, `forecast ${m2}`],
  );
  add(
    "dashboard",
    "action",
    ["dashboard"],
    [
      `make me a dashboard of ${m1} by ${c1}`,
      "kpi dashboard",
      `${m1} dashboard ekak hadanna`,
    ],
  );
  add("table", "action", ["table"], ["format as a table", "make this a table"]);
  add(
    "named-range",
    "action",
    ["named-range"],
    [`name the ${m1} column Measure`, `create a named range for ${c1}`],
  );
  add(
    "presentable",
    "action",
    ["format"],
    ["make it presentable", "freeze the header and add data bars on " + m1],
  );
  add(
    "validation",
    "action",
    ["format"],
    [`add a drop-down for ${c1}`, `allow only numbers from 0 to 100 in ${m1}`],
  );
  add(
    "split",
    "action",
    ["split-column"],
    person ? [`split ${person} into first name and last name`] : [],
  );
  add(
    "unpivot",
    "action",
    ["unpivot"],
    m1 !== m2 ? [`unpivot ${m1} and ${m2} into Measure and Amount`] : [],
  );
  add(
    "workflow",
    "action",
    ["pivot-table"],
    [
      `clean the data, then pivot total ${m1} by ${c1}, then chart it`,
      `trim spaces and remove duplicates, then make a pivot table of ${m2} by ${c2} with a chart`,
    ],
    ["pivot-table", "clean"],
  );
  add(
    "polite",
    "action",
    ["pivot-table"],
    [
      `could you please make a pivot table of total ${m1} by ${c1}, thanks.`,
      `Hi, I would like you to create a pivot of ${m2} by ${c2}`,
    ],
  );
  add(
    "macro-script",
    "macro",
    [],
    [
      `write an Office Script that sorts by ${m1} descending`,
      "write an Office Script that adds a Total column",
      "write an Office Script that freezes the header and autofits the columns",
    ],
  );
  add(
    "macro-vba",
    "macro",
    [],
    [
      `write a VBA macro that sorts by ${c1}`,
      "write a VBA macro that removes duplicates",
      "write a VBA macro that turns on filter buttons and bolds the header",
    ],
  );
  add(
    "question",
    "answer",
    [],
    [
      `which ${c1} has the highest total ${m1}?`,
      `what is the average ${m2}?`,
      "how many rows are there?",
      `which ${c2} has the lowest total ${m1}?`,
    ],
  );

  // Pad to exactly 100 with threshold variations, then trim.
  let extra = 0;
  while (out.length < 100 && extra < 60) {
    extra += 1;
    const threshold = 10 + extra * 7;
    const variants: Array<[string, Prompt["mode"], string[], string]> = [
      [
        "filter-extra",
        "action",
        ["view"],
        `show only rows where ${m1} is greater than ${threshold}`,
      ],
      [
        "highlight-extra",
        "action",
        ["format", "view"],
        `highlight ${m2} greater than ${threshold}`,
      ],
      [
        "pivot-extra",
        "action",
        ["pivot-table"],
        `pivot table of total ${measures[extra % measures.length]} by ${categories[extra % categories.length]}`,
      ],
      [
        "chart-extra",
        "action",
        ["chart"],
        `chart of ${measures[extra % measures.length]} by ${categories[extra % categories.length]}`,
      ],
    ];
    const [family, mode, expectAny, text] = variants[extra % variants.length];
    if (out.some((prompt) => prompt.text === text)) continue;
    add(family, mode, expectAny, [text]);
  }
  void names;
  void id;
  return out.slice(0, 100);
}
