import { parseExpression } from "./expression.js";
import {
  CLEAN_OPERATIONS,
  isSafeColumnName,
  type CleanOperation,
  type ComputeOperator,
} from "./transform.js";

type Cell = string | number | boolean | null;

export interface InstructionSpecs {
  /** A separate, explicitly approved workbook-email request handled by the task pane. */
  email?: { to: string };
  namedRange?: { source: number; name?: string };
  slicer?: { source: number };
  chart?: {
    category: number;
    value: number;
    chartType:
      | "column"
      | "line"
      | "bar"
      | "pie"
      | "stacked-column"
      | "stacked-bar"
      | "area"
      | "combo"
      | "histogram"
      | "waterfall";
    extraValues?: number[];
    showDataLabels?: boolean;
    pivotResult?: boolean;
  };
  /** Bring a column from another sheet; the pane resolves the sheet's headers. */
  lookup?: {
    sheet: string;
    returnHeader: string;
    keyHeader: string;
    keyHeaders?: string[];
    matchMode?: "exact" | "approximate";
    method?: "index-match" | "xlookup";
  };
  lookupColumns?: {
    sheet: string;
    returnHeaders: string[];
    keyHeader: string;
    keyHeaders?: string[];
    matchMode?: "exact" | "approximate";
    method?: "index-match" | "xlookup";
  };
  pivot?: {
    filter?: number;
    subRows?: number;
    rows: number;
    values: number;
    aggregation?: "sum" | "count" | "average" | "min" | "max";
    columns?: number;
    extraValues?: number[];
    showAs?: "percent-of-total" | "percent-of-column";
    /** Keep only the N rows with the largest values. */
    topN?: number;
    lowest?: boolean;
  };
  view?: {
    sort?: { column: number; direction: "asc" | "desc" };
    filter?: {
      column: number;
      operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains";
      value: string | number;
    };
    /** A row test in the closed expression grammar. */
    where?: string;
    highlight?: {
      column: number;
      rule:
        | "top-n"
        | "bottom-n"
        | "above-average"
        | "below-average"
        | "duplicates";
      n?: number;
    };
    limit?: number;
  };
  statistics?: {
    mode:
      | "describe"
      | "correlation"
      | "forecast"
      | "advanced-forecast"
      | "financial"
      | "anomaly"
      | "insights";
    columns?: number[];
    pair?: [number, number];
    value?: number;
    periods?: number;
    category?: number;
    date?: number;
  };
  dashboard?: {
    category: number;
    values: number[];
    aggregation?: "sum" | "count" | "average" | "min" | "max";
  };
  quality?: { mode?: "data" | "formula" | "repair" };
  clean?: {
    operations: CleanOperation[];
    fillBlanks?: string | number;
    fillBlanksColumn?: number;
  };
  format?: {
    freezeHeader?: boolean;
    totalRow?: boolean;
    conditional?: Array<{
      column: number;
      rule:
        | "data-bars"
        | "color-scale"
        | "negative"
        | "duplicates"
        | "icon-set"
        | "custom-formula"
        | "top-n"
        | "bottom-n"
        | "text-contains"
        | "date-range";
      operator?: ">" | ">=" | "<" | "<=" | "=" | "<>";
      value?: number;
      n?: number;
      text?: string;
      startDate?: string;
      endDate?: string;
    }>;
    validation?: Array<{
      column: number;
      rule: "list" | "non-negative" | "between" | "max-length" | "date";
      min?: number;
      max?: number;
    }>;
    dependentDropdown?: { child: number; parent: number };
    inputMessage?: {
      column: number;
      title?: string;
      message?: string;
    };
  };
  summary?: {
    group: number;
    values: Array<{
      column: number;
      aggregation: "sum" | "count" | "average" | "min" | "max";
    }>;
    total?: boolean;
  };
  addColumn?: {
    name: string;
    left?: number;
    operator?: ComputeOperator;
    right?: number;
    expression?: string;
    derived?:
      | "running-total"
      | "rank"
      | "percent-change"
      | "moving-average"
      | "yoy"
      | "date-group"
      | "combine";
    source?: number;
    source2?: number;
    window?: number;
    lag?: number;
    group?: "month" | "quarter" | "year";
  };
  split?: { source: number; firstName: string; lastName: string };
  unpivot?: { values: number[]; name: string; value: string };
}

export interface InterpretedInstruction {
  actions: Array<
    | "table"
    | "named-range"
    | "slicer"
    | "clean"
    | "add-column"
    | "lookup-columns"
    | "split-column"
    | "unpivot"
    | "chart"
    | "pivot-table"
    | "view"
    | "summary"
    | "format"
    | "quality"
    | "statistics"
    | "dashboard"
    | "export-csv"
    | "export-pdf"
  >;
  specs: InstructionSpecs;
  problems: string[];
}

const WORD_OPERATORS: Array<[RegExp, ComputeOperator]> = [
  [/\bdivided\s+by\b|\bover\b/i, "/"],
  [/\bmultiplied\s+by\b|\btimes\b/i, "*"],
  [/\bminus\b|\bless\b/i, "-"],
  [/\bplus\b/i, "+"],
];

const findHeader = (headers: string[], text: string): number => {
  const wanted = text.trim().toLocaleLowerCase();
  return headers.findIndex((header) => header.toLocaleLowerCase() === wanted);
};

/**
 * Deterministic reading of the clean and computed-column requests. Anything it cannot match to
 * real headers is reported as a problem instead of being guessed.
 */
/** "Add column Manager from Staff by Name": bring a column from another sheet by a key. */
export const LOOKUP_PHRASE =
  /^(?:please\s+)?(?:add|get|bring|fetch|lookup|vlookup|xlookup|pull)\s+(?:in\s+)?(?:the\s+)?(?:column\s+)?["']?([A-Za-z][\w ]{0,39}?)["']?\s+from\s+(?:the\s+)?(?:sheet\s+)?["']?([^"'\n]{1,31}?)["']?\s+(?:by|using|matching|on|with|where)\s+["']?([^"'\n]+?)["']?\s*\.?$/i;

/** "Add columns Manager and Department from Staff by Name". */
export const LOOKUP_COLUMNS_PHRASE =
  /^(?:please\s+)?(?:add|get|bring|fetch|lookup|pull)\s+columns?\s+(.+?)\s+from\s+(?:the\s+)?(?:sheet\s+)?["']?([^"'\n]{1,31}?)["']?\s+(?:by|using|matching|on|with|where)\s+["']?([^"'\n]+?)["']?\s*\.?$/i;

/**
 * Everyday wordings of three computed-column requests, rewritten into the explicit form the reader
 * already understands ("add a column NAME that is EXPRESSION"). Needs the headers, so a column that
 * does not exist is never invented: with no matching header the sentence is returned unchanged.
 */
function rewriteColumnWishes(text: string, headers: string[]): string {
  if (!/\b(?:add|new|create|make|show|give|need|put)\b/i.test(text))
    return text;
  // A pivot, chart or summary can show a share itself; only a per-row column is rewritten here.
  if (/\b(?:pivot|chart|graph|dashboard|summary|summari[sz]e)\b/i.test(text))
    return text;
  const column = mentioned(headers, text);
  if (column < 0) return text;
  const name = headers[column];
  // "show each row Qty as a percentage of the total Qty", "add a column with the share of total Qty"
  if (
    /\b(?:percentage|percent|share|proportion|fraction)\s+of\s+(?:the\s+)?(?:grand\s+)?(?:total|sum)\b/i.test(
      text,
    )
  )
    return `add a column ${name} Share that is [${name}] / COLSUM([${name}])`;
  // "add a column that says Above or Below depending on whether Qty is over the average"
  if (
    /\b(?:above|over|higher|greater)\b[^.]*\b(?:below|under|lower|less)\b[^.]*\baverage\b|\b(?:above|below)\s+(?:or\s+(?:above|below)\s+)?(?:the\s+)?average\b[^.]*\bcolumn\b/i.test(
      text,
    ) &&
    /\bcolumn\b|\bsays?\b|\blabel\b/i.test(text)
  )
    return `add a column ${name} Level that is IF([${name}] > COLAVG([${name}]), "Above", "Below")`;
  // "I need a new column with only the month of Order Date"
  const part =
    /\b(?:new\s+)?column\b[^.]*?\b(year|month|day|quarter|weekday)\b[^.]*?\b(?:of|from)\b/i.exec(
      text,
    );
  if (part) {
    const label = part[1][0].toUpperCase() + part[1].slice(1).toLowerCase();
    return `add a column ${label} from ${name}`;
  }
  return text;
}

export function interpretInstruction(
  rawInstruction: string,
  headers: string[],
  rows: Cell[][] = [],
  sequenceDepth = 0,
): InterpretedInstruction {
  const instruction = normalizeInstruction(rawInstruction);
  const result: InterpretedInstruction = {
    actions: [],
    specs: {},
    problems: [],
  };
  const text = rewriteColumnWishes(instruction.replace(/[_]+/g, " "), headers);
  // A view sorts by one column. Say so instead of reading "then B" as a separate, meaningless step.
  const twoKeySort =
    /\bsort(?:ed)?\s+(?:the\s+(?:rows|data|sheet)\s+)?by\s+(.+?)[\s,]+(?:and\s+)?then\s+(?:by\s+)?(.+)$/i.exec(
      text,
    );
  if (
    twoKeySort &&
    mentioned(headers, twoKeySort[1]) >= 0 &&
    mentioned(headers, twoKeySort[2]) >= 0
  ) {
    result.problems.push(
      `Sorting by two columns is not supported yet. Sort by one column, for example: sort by ${headers[mentioned(headers, twoKeySort[1])]}.`,
    );
    return result;
  }
  // These requests need capabilities that are deliberately outside the add-in's
  // current permission and Office.js safety boundary. Return an actionable
  // refusal instead of falling through to the generic "unsupported action"
  // hint, and never invent a plan that could appear to have succeeded.
  if (/\bsparklines?\b/i.test(text)) {
    result.problems.push(
      "Sparklines are not available in this Excel add-in yet. Use a line chart on a new result sheet instead.",
    );
    return result;
  }
  if (
    /\b(?:refresh|update)\b.*\b(?:every|each|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|day)/i.test(
      text,
    )
  ) {
    result.problems.push(
      "Scheduled refresh is not available in this add-in yet. Run the request again when you want a fresh, reviewed result.",
    );
    return result;
  }
  if (
    /\bemail\b.*\b(?:result|sheet|workbook|report)\b|\bsend\b.*\b(?:result|sheet|workbook|report)\b.*\b(?:email|finance team|team)\b/i.test(
      text,
    )
  ) {
    const recipient = text.match(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i,
    )?.[0];
    if (!recipient) {
      result.problems.push(
        "Add a recipient email address, then use the Email Excel workbook panel and approve the send.",
      );
    } else {
      result.specs.email = { to: recipient };
      result.problems.push(
        "Email preview is ready. Review the recipient and current XLSX workbook, then approve the send.",
      );
    }
    return result;
  }
  if (sequenceDepth === 0) {
    // "if A > 1 then x otherwise y" is one expression, not two steps: keep its own "then".
    const guarded = text.replace(
      /\b(if\s+[^;]*?)\s+then\s+/gi,
      "$1 IFTHENKEEP ",
    );
    const clauses = guarded
      .split(/\s+(?:and\s+)?then\s+|\s*;\s*/i)
      .map((clause) =>
        clause
          .replace(/IFTHENKEEP/g, "then")
          .replace(/^[,\s]+|[,.\s]+$/g, "")
          .trim(),
      )
      .filter(Boolean);
    if (clauses.length > 1) {
      const parts = clauses.map((clause) =>
        interpretInstruction(clause, headers, rows, sequenceDepth + 1),
      );
      const actions: InterpretedInstruction["actions"] = [];
      const specs: InstructionSpecs = {};
      const problems = parts.flatMap((part, index) =>
        part.problems.map((problem) => `Step ${index + 1}: ${problem}`),
      );
      for (const part of parts) {
        for (const action of part.actions)
          if (!actions.includes(action)) actions.push(action);
        for (const [key, value] of Object.entries(part.specs) as Array<
          [
            keyof InstructionSpecs,
            NonNullable<InstructionSpecs[keyof InstructionSpecs]>,
          ]
        >) {
          const previous = specs[key];
          if (!previous) {
            (specs as Record<string, unknown>)[key] = value;
            continue;
          }
          if (key === "format") {
            const oldFormat = previous as NonNullable<
              InstructionSpecs["format"]
            >;
            const newFormat = value as NonNullable<InstructionSpecs["format"]>;
            specs.format = {
              ...oldFormat,
              ...newFormat,
              ...(oldFormat.conditional || newFormat.conditional
                ? {
                    conditional: [
                      ...(oldFormat.conditional ?? []),
                      ...(newFormat.conditional ?? []),
                    ],
                  }
                : {}),
              ...(oldFormat.validation || newFormat.validation
                ? {
                    validation: [
                      ...(oldFormat.validation ?? []),
                      ...(newFormat.validation ?? []),
                    ],
                  }
                : {}),
            };
          } else if (key === "clean") {
            const oldClean = previous as NonNullable<InstructionSpecs["clean"]>;
            const newClean = value as NonNullable<InstructionSpecs["clean"]>;
            specs.clean = {
              ...oldClean,
              ...newClean,
              operations: [...oldClean.operations, ...newClean.operations],
            };
          } else {
            problems.push(
              `Multiple ${String(key)} steps are not supported in one plan.`,
            );
          }
        }
      }
      if (problems.length || parts.some((part) => part.actions.length === 0)) {
        return {
          actions: [],
          specs: {},
          problems: problems.length
            ? problems
            : ["Every step must describe an explicit supported Excel action."],
        };
      }
      return { actions, specs, problems: [] };
    }
  }
  if (
    /\b(?:export|download)\b.*\bcsv\b|\bcsv\b.*\b(?:export|download|file)\b/i.test(
      text,
    )
  )
    return { actions: ["export-csv"], specs: {}, problems: [] };
  if (
    /\b(?:export|download)\b.*\bpdf\b|\bpdf\b.*\b(?:export|download|file)\b/i.test(
      text,
    )
  )
    if (/\bdashboard\b/i.test(text)) {
      if (interpretDashboard(text, headers, rows, result)) {
        if (result.problems.length === 0) result.actions.push("export-pdf");
        return result;
      }
    } else return { actions: ["export-pdf"], specs: {}, problems: [] };
  if (
    /\b(?:format|create|turn|make)\b.*\b(?:as\s+(?:an?\s+)?|into\s+(?:an?\s+)?)?(?:excel\s+)?table\b/i.test(
      text,
    )
  )
    result.actions.push("table");

  const dependentDropdownMatch =
    /\b(?:create|add|make)\s+(?:a\s+)?dependent\s+drop-?down\s+for\s+["']?([^"'\n]+?)["']?\s+based\s+on\s+["']?([^"'\n.]+?)["']?\s*\.?$/i.exec(
      text,
    );
  if (dependentDropdownMatch) {
    const child = findHeader(headers, dependentDropdownMatch[1].trim());
    const parent = findHeader(headers, dependentDropdownMatch[2].trim());
    if (child < 0)
      result.problems.push(
        `"${dependentDropdownMatch[1].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    if (parent < 0)
      result.problems.push(
        `"${dependentDropdownMatch[2].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    if (child >= 0 && parent >= 0) {
      if (child === parent)
        result.problems.push(
          "The dependent drop-down needs two different columns.",
        );
      else
        return {
          actions: ["format"],
          specs: {
            format: {
              freezeHeader: true,
              dependentDropdown: { child, parent },
            },
          },
          problems: [],
        };
    }
  }

  const namedColumn =
    /\b(?:name|call|rename)\s+(?:the\s+)?(.+?)\s+column\s+(?:as\s+|to\s+)?["']?([A-Za-z_][A-Za-z0-9_.]*)["']?\s*\.?$/i.exec(
      text,
    );
  if (namedColumn) {
    const source = findHeader(headers, namedColumn[1].trim());
    if (source < 0)
      result.problems.push(
        `"${namedColumn[1].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    else
      return {
        actions: ["named-range"],
        specs: { namedRange: { source, name: namedColumn[2] } },
        problems: [],
      };
  }
  const namedRangeMatch =
    /\b(?:create|define|add)\s+(?:a\s+)?named\s+range\s+for\s+["']?([^"'.,]+?)["']?\s*\.?$/i.exec(
      text,
    );
  if (namedRangeMatch) {
    const source = findHeader(headers, namedRangeMatch[1].trim());
    if (source < 0)
      result.problems.push(
        `"${namedRangeMatch[1].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    else
      return {
        actions: ["named-range"],
        specs: { namedRange: { source } },
        problems: [],
      };
  }

  const slicerMatch =
    /\b(?:add|create|make)\s+(?:a\s+)?slicer\s+for\s+["']?([^"'.,]+?)["']?\s*\.?$/i.exec(
      text,
    );
  if (slicerMatch) {
    const source = findHeader(headers, slicerMatch[1].trim());
    if (source < 0)
      result.problems.push(
        `"${slicerMatch[1].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    else
      return {
        actions: ["slicer"],
        specs: { slicer: { source } },
        problems: [],
      };
  }

  const combineMatch =
    /\b(?:combine|concatenate|join)\s+["']?([^"'\n,]+?)["']?\s+and\s+["']?([^"'\n,]+?)["']?\s+into\s+(?:one\s+)?column(?:\s+(?:called|named)\s+["']?([^"'\n,.]+?)["']?)?(?:\s*\.|$)/i.exec(
      text,
    );
  if (combineMatch) {
    const first = findHeader(headers, combineMatch[1].trim());
    const second = findHeader(headers, combineMatch[2].trim());
    const name =
      combineMatch[3]?.trim() ||
      `${headers[first >= 0 ? first : 0]} - ${headers[second >= 0 ? second : 1]}`;
    if (first < 0 || second < 0 || first === second) {
      result.problems.push(
        `Choose two different existing columns. Available: ${headers.join(", ")}.`,
      );
    } else if (!isSafeColumnName(name)) {
      result.problems.push("That column name is not allowed.");
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name,
            derived: "combine",
            source: first,
            source2: second,
          },
        },
        problems: [],
      };
    }
  }

  const unpivotMatch =
    /\bunpivot\s+(.+?)\s+into\s+["']?([^"'\n,]+?)["']?\s+and\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    );
  if (unpivotMatch) {
    const valueHeaders = unpivotMatch[1]
      .split(/,|\band\b/i)
      .map((value) => value.trim())
      .filter(Boolean);
    const values = valueHeaders.map((header) => findHeader(headers, header));
    if (
      values.length < 2 ||
      values.some((index) => index < 0) ||
      new Set(values).size !== values.length
    )
      result.problems.push(
        `Choose at least two different value columns. Available: ${headers.join(", ")}.`,
      );
    else {
      const name = unpivotMatch[2].trim();
      const value = unpivotMatch[3].trim();
      if (!isSafeColumnName(name) || !isSafeColumnName(value) || name === value)
        result.problems.push("The unpivot output names are not allowed.");
      else
        return {
          actions: ["unpivot"],
          specs: { unpivot: { values, name, value } },
          problems: [],
        };
    }
  }

  const splitMatch =
    /\b(?:split|separate)\s+["']?([^"'\n,.]+?)["']?\s+into\s+(?:first\s+and\s+last|two)\s+(?:name\s+)?columns?(?:\s*\.|$)/i.exec(
      text,
    );
  if (splitMatch) {
    const source = findHeader(headers, splitMatch[1].trim());
    if (source < 0)
      result.problems.push(
        `"${splitMatch[1].trim()}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    else
      return {
        actions: ["split-column"],
        specs: {
          split: {
            source,
            firstName: `${headers[source]} First`,
            lastName: `${headers[source]} Last`,
          },
        },
        problems: [],
      };
  }

  const dateGroupMatch =
    /\b(?:group|bucket)\s+["']?([^"'\n,.]+?)["']?\s+(?:by|into)\s+(month|quarter|year)(?:\s*\.|$)/i.exec(
      text,
    );
  if (dateGroupMatch) {
    const requestedSource = dateGroupMatch[1].trim();
    const group = dateGroupMatch[2].toLowerCase() as
      | "month"
      | "quarter"
      | "year";
    const source = findHeader(headers, requestedSource);
    if (source < 0) {
      result.problems.push(
        `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      const label = group[0].toUpperCase() + group.slice(1);
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name: `${label} of ${headers[source]}`,
            derived: "date-group",
            source,
            group,
          },
        },
        problems: [],
      };
    }
  }

  const yoyMatch =
    /\b(?:yoy|year[-\s]?over[-\s]?year)\s+(?:change(?:\s+column)?)?\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    );
  if (yoyMatch) {
    const requestedSource = yoyMatch[1].trim();
    const source = findHeader(headers, requestedSource);
    if (source < 0) {
      result.problems.push(
        `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name: `YoY Change of ${headers[source]}`,
            derived: "yoy",
            source,
            lag: 12,
          },
        },
        problems: [],
      };
    }
  }

  const movingAverageMatch =
    /\b(?:(\d+)[-\s]?(?:period|month|week|day)?\s+)?(?:moving|rolling)\s+average(?:\s+column)?\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    );
  if (movingAverageMatch) {
    const window = Number(movingAverageMatch[1] ?? 3);
    const requestedSource = movingAverageMatch[2].trim();
    const source = findHeader(headers, requestedSource);
    if (!Number.isInteger(window) || window < 2 || window > 12) {
      result.problems.push("Choose a moving-average window from 2 to 12.");
    } else if (source < 0) {
      result.problems.push(
        `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            // The full name when it fits in 40 characters, a shorter one otherwise.
            name:
              `${window}-Period Moving Average of ${headers[source]}`.length <=
              40
                ? `${window}-Period Moving Average of ${headers[source]}`
                : `${window}-Period Avg of ${headers[source]}`.slice(0, 40),
            derived: "moving-average",
            source,
            window,
          },
        },
        problems: [],
      };
    }
  }

  const percentChangeMatch =
    /(?:\b(?:percent(?:age)?|pct)|%)\s*change(?:\s+column)?\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    );
  if (percentChangeMatch) {
    const requestedSource = percentChangeMatch[1].trim();
    const source = findHeader(headers, requestedSource);
    if (source < 0) {
      result.problems.push(
        `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name: `% Change of ${headers[source]}`,
            derived: "percent-change",
            source,
          },
        },
        problems: [],
      };
    }
  }

  const rankMatch =
    /\b(?:rank|ranking)\s+column\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    ) ||
    /\b(?:rank|ranking)\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?(?:\s*\.|$)/i.exec(
      text,
    );
  if (rankMatch) {
    const requestedSource = rankMatch[1].trim();
    const source = findHeader(headers, requestedSource);
    if (source < 0) {
      result.problems.push(
        `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name: `Rank of ${headers[source]}`,
            derived: "rank",
            source,
          },
        },
        problems: [],
      };
    }
  }

  const runningTotal =
    /\b(?:running|cumulative)\s+total\b(?:\s+column)?(?:\s+(?:for|of|on|using)\s+["']?([^"'\n,.]+?)["']?)?(?:\s*\.|$)/i.exec(
      text,
    );
  if (runningTotal) {
    const requestedSource = runningTotal[1]?.trim();
    const source = requestedSource ? findHeader(headers, requestedSource) : -1;
    if (source < 0) {
      result.problems.push(
        requestedSource
          ? `"${requestedSource}" is not a column of your data. Available: ${headers.join(", ")}.`
          : "Name one numeric source column for the running total.",
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          addColumn: {
            name: `Running Total of ${headers[source]}`,
            derived: "running-total",
            source,
          },
        },
        problems: [],
      };
    }
  }

  const operations = new Set<CleanOperation>();
  const formulaRepairIntent =
    /\b(?:repair|fix|correct|replace)\b[^.\n]{0,80}(?:formulas?|#REF!|#DIV\/0!)/i.test(
      text,
    );
  if (
    /\b(clean|tidy)\b|\btrim\b|\bwhitespace\b/i.test(text) ||
    (/\bfix\b/i.test(text) && !formulaRepairIntent)
  )
    operations.add("trim");
  if (/\bclean\b|\btidy\b/i.test(text)) operations.add("text-to-number");
  if (
    /text\s+to\s+numbers?|numbers?\s+stored\s+as\s+text|fix\s+numbers?/i.test(
      text,
    )
  )
    operations.add("text-to-number");
  if (
    /text\s+to\s+dates?|dates?\s+stored\s+as\s+text|convert\s+(?:text\s+)?dates?/i.test(
      text,
    )
  )
    operations.add("text-to-date");
  const targetedFillMatch =
    /\bfill\s+(?:in\s+)?(?:the\s+)?(?:blank|empty)(?:s|\s+cells?)?\s+(.+?)\s+(?:values?|cells?)\s+(?:with|using)\s+["']?([^"'\n,.]+?)["']?(?:\s|$)/i.exec(
      text,
    ) ??
    // "fill blank cells in Qty with 0", "fill the empty cells of the Qty column with 0"
    /\bfill\s+(?:in\s+)?(?:the\s+)?(?:blank|empty)(?:s|\s+(?:cells?|values?))?\s+(?:in|of|for)\s+(?:the\s+)?(.+?)(?:\s+column)?\s+(?:with|using)\s+["']?([^"'\n,.]+?)["']?(?:\s|$)/i.exec(
      text,
    );
  const fillMatch =
    /\bfill\s+(?:in\s+)?(?:the\s+)?(?:blank|empty)(?:s|\s+cells?)?\s+(?:with|using)\s+["']?([^"'\n,.]+?)["']?(?:\s|$)/i.exec(
      text,
    );
  if (targetedFillMatch || fillMatch) {
    const requestedColumn = targetedFillMatch?.[1].trim();
    const raw = (targetedFillMatch?.[2] ?? fillMatch?.[1] ?? "").trim();
    if (raw.length === 0 || raw.length > 100 || /[\u0000-\u001f]/.test(raw))
      result.problems.push("The blank-cell fill value is not allowed.");
    else {
      const fillBlanksColumn = requestedColumn
        ? findHeader(headers, requestedColumn)
        : -1;
      if (requestedColumn && fillBlanksColumn < 0) {
        result.problems.push(
          `"${requestedColumn}" is not a column of your data. Available: ${headers.join(", ")}.`,
        );
      } else {
        const numeric = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)
          ? Number(raw.replace(/,/g, ""))
          : undefined;
        operations.add("fill-blanks");
        result.specs.clean = {
          operations: [],
          fillBlanks: numeric !== undefined ? numeric : raw,
          ...(fillBlanksColumn >= 0 ? { fillBlanksColumn } : {}),
        };
      }
    }
  } else if (/\bfill\s+(?:in\s+)?(?:the\s+)?blanks?\b/i.test(text)) {
    result.problems.push("Say what value should replace blank cells.");
  }
  if (
    /\bdedup(?:e|licate)s?\b|remove\s+duplicates?|duplicate\s+rows?/i.test(text)
  )
    operations.add("dedupe");
  if (
    /fuzzy\s+(?:dedup(?:e|licate)s?|duplicates?)|near[-\s]?duplicate/i.test(
      text,
    )
  )
    operations.add("fuzzy-dedupe");
  if (/\bclean\b|\btidy\b/i.test(text)) operations.add("dedupe");
  if (operations.size > 0) {
    result.actions.push("clean");
    result.specs.clean = {
      ...(result.specs.clean?.fillBlanks !== undefined
        ? { fillBlanks: result.specs.clean.fillBlanks }
        : {}),
      ...(result.specs.clean?.fillBlanksColumn !== undefined
        ? { fillBlanksColumn: result.specs.clean.fillBlanksColumn }
        : {}),
      operations: CLEAN_OPERATIONS.filter((operation) =>
        operations.has(operation),
      ),
    };
  }

  const approximateLookup = /\b(?:approximate|closest|nearest)\b/i.test(
    rawInstruction,
  );
  const lookupMethod =
    /^\s*xlookup\b/i.test(rawInstruction) ||
    /\b(?:using|with|use)\s+xlookup\b/i.test(rawInstruction)
      ? ("xlookup" as const)
      : /\b(?:using|with|use)\s+(?:index\s*[-/]\s*match|index\s+and\s+match)\b/i.test(
            rawInstruction,
          )
        ? ("index-match" as const)
        : undefined;
  const lookupText = rawInstruction
    .replace(/\b(?:approximate|closest|nearest)\b/gi, "")
    .replace(
      /\s+(?:using|with)\s+(?:xlookup|index\s*[-/]\s*match|index\s+and\s+match)\b/gi,
      "",
    )
    .replace(
      /\buse\s+(?:xlookup|index\s*[-/]\s*match|index\s+and\s+match)\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  const lookupColumnsMatch = LOOKUP_COLUMNS_PHRASE.exec(lookupText);
  if (lookupColumnsMatch) {
    const returnHeaders = lookupColumnsMatch[1]
      .split(/\band\b|,/i)
      .map((header) => header.trim())
      .filter(Boolean);
    const keyHeaders = lookupColumnsMatch[3]
      .split(/\band\b|,/i)
      .map((header) => header.trim())
      .filter(Boolean);
    const sourceKeyAt = keyHeaders.map((wanted) =>
      headers.findIndex(
        (header) =>
          header.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase(),
      ),
    );
    if (returnHeaders.length === 1) {
      // Let the single-column lookup parser handle the ordinary "Add column ..." form.
    } else if (returnHeaders.length > 5) {
      result.problems.push(
        "Choose two to five columns to bring from the lookup sheet.",
      );
    } else if (sourceKeyAt.some((index) => index < 0)) {
      result.problems.push(
        `"${keyHeaders[0] ?? ""}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["lookup-columns"],
        specs: {
          lookupColumns: {
            sheet: lookupColumnsMatch[2].trim(),
            returnHeaders,
            keyHeader: headers[sourceKeyAt[0]],
            ...(keyHeaders.length > 1
              ? { keyHeaders: sourceKeyAt.map((index) => headers[index]) }
              : {}),
            ...(approximateLookup ? { matchMode: "approximate" as const } : {}),
            ...(lookupMethod ? { method: lookupMethod } : {}),
          },
        },
        problems: [],
      } as InterpretedInstruction;
    }
  }
  const lookupMatch = LOOKUP_PHRASE.exec(lookupText);
  if (lookupMatch) {
    const keyHeaders = lookupMatch[3]
      .split(/\band\b|,/i)
      .map((header) => header.trim())
      .filter(Boolean);
    const keyHeader = keyHeaders[0] ?? "";
    const sourceKeyAt = keyHeaders.map((wanted) =>
      headers.findIndex(
        (header) =>
          header.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase(),
      ),
    );
    if (sourceKeyAt.some((index) => index < 0)) {
      result.problems.push(
        `"${keyHeader}" is not a column of your data. Available: ${headers.join(", ")}.`,
      );
    } else {
      return {
        actions: ["add-column"],
        specs: {
          lookup: {
            sheet: lookupMatch[2].trim(),
            returnHeader: lookupMatch[1].trim(),
            keyHeader: headers[sourceKeyAt[0]],
            ...(keyHeaders.length > 1
              ? {
                  keyHeaders: sourceKeyAt.map((index) => headers[index]),
                }
              : {}),
            ...(approximateLookup ? { matchMode: "approximate" as const } : {}),
            ...(lookupMethod ? { method: lookupMethod } : {}),
          },
        },
        problems: [],
      } as InterpretedInstruction;
    }
  }

  // "add a column Year from PAT Complete Date" is "year of PAT Complete Date".
  const datePartColumn =
    /\b(?:add|create|insert)\s+(?:a\s+|an\s+|new\s+)*column\s+(?:called\s+|named\s+)?["']?(year|month|day)["']?\s+(?:from|of|using)\s+(.+?)\s*\.?$/i.exec(
      text,
    );
  const columnText = datePartColumn
    ? `add a column ${datePartColumn[1]} that is ${datePartColumn[1].toLowerCase()} of ${datePartColumn[2]}`
    : text;
  const column =
    /\b(?:add|create|insert)\s+(?:a\s+|an\s+|new\s+)*(?:computed\s+|calculated\s+)?column\s+(?:called\s+|named\s+)?["']?([^"'=:]+?)["']?\s*(?:=|:|\bas\b|\bthat\s+(?:is|equals)\b|\bwhich\s+is\b|\bequal\s+to\b|\bequals\b)\s*(.+?)\s*\.?$/i.exec(
      columnText,
    ) || /^\s*["']?([A-Za-z][\w ]{0,39}?)["']?\s*=\s*(.+?)\s*\.?$/i.exec(text);
  if (column) {
    const name = column[1].trim();
    const expression = plainExpression(column[2].trim(), headers);
    // Anything beyond `ColumnA op ColumnB` (parentheses, numbers, functions, three columns)
    // becomes a validated expression column; the plain two-column form keeps its own spec.
    let handled = false;
    try {
      const parsed = parseExpression(expression, headers);
      const simple =
        parsed.ast.t === "bin" &&
        parsed.ast.a.t === "col" &&
        parsed.ast.b.t === "col" &&
        parsed.ast.a.i !== parsed.ast.b.i;
      if (!simple) {
        handled = true;
        if (!isSafeColumnName(name))
          result.problems.push("That column name is not allowed.");
        else {
          // An expression column is the whole request: words inside it (TRIM, SORT...) must not
          // trigger other actions.
          return {
            actions: ["add-column"],
            specs: { addColumn: { name, expression } },
            problems: [],
          } as InterpretedInstruction;
        }
      }
    } catch {
      // Not a valid expression: the two-column reader below reports what is wrong.
    }
    let operator: ComputeOperator | undefined;
    let parts: string[] = [];
    const symbol = /^(.+?)\s*([-+*/×÷−])\s*(.+)$/.exec(expression);
    if (symbol) {
      const map: Record<string, ComputeOperator> = {
        "-": "-",
        "−": "-",
        "+": "+",
        "*": "*",
        "×": "*",
        "/": "/",
        "÷": "/",
      };
      operator = map[symbol[2]];
      parts = [symbol[1], symbol[3]];
    } else {
      for (const [pattern, mapped] of WORD_OPERATORS) {
        const split = expression.split(pattern);
        if (split.length === 2) {
          operator = mapped;
          parts = split;
          break;
        }
      }
    }
    if (!handled && operator && parts.length === 2) {
      // "[Sales] - [Cost]" names the columns in brackets; the header lookup wants the bare name.
      const bare = (value: string) => value.trim().replace(/^\[(.*)\]$/, "$1");
      const left = findHeader(headers, bare(parts[0]));
      const right = findHeader(headers, bare(parts[1]));
      if (!isSafeColumnName(name))
        result.problems.push("That column name is not allowed.");
      else if (left < 0 || right < 0)
        result.problems.push(
          `Use two existing column names. Available: ${headers.join(", ")}.`,
        );
      else {
        result.actions.push("add-column");
        result.specs.addColumn = { name, left, operator, right };
      }
    }
  }
  if (interpretDashboard(text, headers, rows, result)) return result;
  interpretChartAndPivot(text, headers, rows, result);
  interpretSummary(text, headers, rows, result);
  interpretStatistics(text, headers, rows, result);
  interpretFormatAndQuality(text, headers, rows, result);
  interpretView(text, headers, rows, result);
  return result;
}

/**
 * Maps common Sinhala and Singlish words to the English keywords the deterministic readers use,
 * so the same instructions work in all three without sending anything to a model.
 */
/**
 * Everyday wording for a computed column ("yes if A < B otherwise no", "the first 3 letters of X",
 * "year of Date") as the closed expression grammar; anything else is returned unchanged.
 */
export function plainExpression(text: string, headers: string[]): string {
  return bracketHeaders(plainExpressionRaw(text, headers), headers);
}

function plainExpressionRaw(text: string, headers: string[]): string {
  const known = new Set(
    headers.map((header) => header.trim().toLocaleLowerCase()),
  );
  const literal = (value: string) => {
    const clean = value.trim().replace(/^["']|["']$/g, "");
    return known.has(clean.toLocaleLowerCase()) ||
      /^-?\d+(?:\.\d+)?$/.test(clean)
      ? clean
      : `"${clean.replace(/"/g, '""')}"`;
  };
  // "is more than 1" -> "> 1" inside a condition.
  const comparison = (condition: string) =>
    condition
      .replace(/\b(?:is\s+)?(?:at\s+least|not\s+less\s+than)\b/gi, ">=")
      .replace(/\b(?:is\s+)?(?:at\s+most|not\s+more\s+than)\b/gi, "<=")
      .replace(/\b(?:is\s+)?(?:more|greater|bigger|higher)\s+than\b/gi, ">")
      .replace(/\b(?:is\s+)?(?:less|fewer|smaller|lower)\s+than\b/gi, "<")
      .replace(/\b(?:is\s+)?equals?(?:\s+to)?\b/gi, "=")
      .trim();
  const ifThen =
    /^if\s+(.+?)\s+then\s+(.+?)\s+(?:otherwise|else|or\s+else)\s+(.+)$/i.exec(
      text,
    );
  if (ifThen)
    return `IF(${comparison(ifThen[1])},${literal(ifThen[2])},${literal(ifThen[3])})`;
  const choice =
    /^(.+?)\s+if\s+(.+?)\s+(?:otherwise|else|or\s+else)\s+(.+)$/i.exec(text);
  if (choice)
    return `IF(${comparison(choice[2])},${literal(choice[1])},${literal(choice[3])})`;
  const yesNo = /^(yes|true)\s+if\s+(.+)$/i.exec(text);
  if (yesNo) return `IF(${yesNo[2].trim()},"Yes","No")`;
  const part =
    /^(?:the\s+)?(first|last)\s+(\d{1,3})\s+(?:letters?|characters?|chars?)\s+of\s+(.+)$/i.exec(
      text,
    );
  if (part)
    return `${part[1].toLowerCase() === "first" ? "LEFT" : "RIGHT"}(${part[3].trim()},${part[2]})`;
  const datePart = /^(?:the\s+)?(year|month|day)\s+(?:of|from)\s+(.+)$/i.exec(
    text,
  );
  if (datePart) return `${datePart[1].toUpperCase()}(${datePart[2].trim()})`;
  return text;
}

/** A column whose name has spaces is written [like this] in the expression grammar. */
function bracketHeaders(text: string, headers: string[]): string {
  let out = text;
  const spaced = headers
    .map((header) => header.trim())
    .filter((header) => /[^A-Za-z0-9_]/.test(header))
    .sort((a, b) => b.length - a.length);
  for (const header of spaced) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![\\[\\w])${escaped}(?![\\]\\w])`, "gi"),
      `[${header}]`,
    );
  }
  return out;
}

export function normalizeInstruction(text: string): string {
  const table: Array<[RegExp, string]> = [
    // "Sales walata Region anuwa total" means "total of Sales by Region".
    [
      /\b(\w+)\s+(?:walata|walin)\s+(\w+)\s+(?:anuwa|walin|walata)\s+(total|sum|average|count)(?:\s+ekak)?\b/gi,
      "summary $3 of $1 by $2",
    ],
    // "RTOM අනුව Requested Quantity එකතුව" means "total Requested Quantity by RTOM".
    [/(\S+(?:\s\S+)?)\s+අනුව\s+(.+?)\s+(?:මුළු\s+)?එකතුව/gu, "total $2 by $1"],
    [/(\S+)\s+අනුව/gu, "by $1"],
    [/එකතුව|එකතු/gu, "total"],
    [/එකක්/gu, ""],
    // Kept as one action so the result, approval and undo are one marked worksheet.
    [/\b(?:kpi\s+)?dashboard\b/gi, "dashboard"],
    [/pivot\s*tables?\b/gi, "pivot"],
    [/\b(\w+)\s+(?:walata|walin|anuwa)\b/gi, "by $1"],
    [/\beka\b/gi, ""],
    [
      /ප්‍රස්තාරය?|ප්‍රස්ථාරය?|prasthara(ya)?|grap[h]? ekak?\b|chart ekak?\b/gi,
      "chart",
    ],
    [/පිවට්|pivot ekak?\b/gi, "pivot"],
    [/වගුව|wagu(wa)?|table ekak?\b/gi, "table"],
    [/පිරිසිදු|pirisidu|clean karanna|saaf/gi, "clean"],
    [/අනුපිටපත්|anupitapath|duplicate ekak?\b/gi, "duplicates"],
    [/අලුත් (පත්‍රය|sheet)|alut sheet|new sheet ekak?\b/gi, "new sheet"],
    [/වර්ග කරන්න|warga karanna|sort karanna/gi, "sort"],
    [/ඉහළම|ihalama|uda/gi, "top"],
    [/පහළම|pahalama/gi, "bottom"],
    [/මුළු|mulu|total ekak?\b/gi, "total"],
    [/සාමාන්‍යය|saamanya/gi, "average"],
    [/හදන්න|හදලා දෙන්න|hadanna|hadala denna|karanna/gi, ""],
    [/විකුණුම්|wikunum/gi, "Sales"],
  ];
  let out = text;
  for (const [pattern, replacement] of table)
    out = out.replace(pattern, replacement);
  out = out.replace(/\s{2,}/g, " ").trim();
  // Politeness is not part of the request: "could you add X, thanks." means "add X".
  const politeStart =
    /^(?:(?:hi|hello|hey)[,!]?\s+)?(?:(?:could|can|would|will)\s+you\s+(?:please\s+)?|please\s+|kindly\s+|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+)/i;
  const asked = politeStart.test(out);
  out = out.replace(politeStart, "");
  out = out.replace(
    /[\s,;]*\b(?:please|pls|plz|thanks|thank\s+you|thx|ty)\b[\s.!]*$/i,
    "",
  );
  out = out.replace(asked ? /[.!?\s]+$/ : /[.!\s]+$/, "");
  // Everyday wordings of requests the reader already supports.
  out = out
    .replace(
      /\b(?:delete|remove|drop|get\s+rid\s+of)\s+(?:all\s+)?(?:the\s+)?duplicates?\b(?!\s+(?:in|from|of|where|by)\b)/gi,
      "remove duplicate rows",
    )
    .replace(
      /^(?:(?:are|is)\s+there\s+(?:any\s+)?|check\s+(?:for\s+)?|find\s+|look\s+for\s+|scan\s+for\s+|any\s+)(?:\w+\s+){0,3}?(?:problems?|issues?|errors?|mistakes?)\b.*$/i,
      "data quality report",
    )
    .replace(/^.*\bawul\b.*$/i, "data quality report")
    .replace(
      /\bsplit\s+(.+?)\s+into\s+first\s+name\s+and\s+last\s+name\b/gi,
      "split $1 into first and last name columns",
    )
    .replace(
      /\bsplit\s+(.+?)\s+into\s+first\s+and\s+last\s+name(?!\s+columns)/gi,
      "split $1 into first and last name columns",
    );
  return out.trim();
}

const CHART_TYPE_WORDS: Array<
  [RegExp, NonNullable<InstructionSpecs["chart"]>["chartType"]]
> = [
  [/\bcombo\b/i, "combo"],
  [/\bhistogram\b/i, "histogram"],
  [/\bwaterfall\b/i, "waterfall"],
  [/stacked\s+(column|columns)/i, "stacked-column"],
  [/stacked\s+bar/i, "stacked-bar"],
  [/\barea\b/i, "area"],
  [/\bpie\b/i, "pie"],
  [/\bline\b/i, "line"],
  [/\bbar\b/i, "bar"],
  [/\bcolumn\b/i, "column"],
];

function headerPositions(headers: string[], text: string) {
  const lower = text.toLocaleLowerCase();
  const found: Array<{ index: number; at: number }> = [];
  headers.forEach((header, index) => {
    const name = header.toLocaleLowerCase().trim();
    if (!name) return;
    const at = lower.search(
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`,
        "u",
      ),
    );
    if (at >= 0) found.push({ index, at });
  });
  return found.sort((a, b) => a.at - b.at);
}

/**
 * A row test for a view: several conditions ("where Status is S and RTOM is R-HK"), a test between two
 * columns ("where Issued is less than Requested") or an expression written directly
 * ("where AND([Status] = "S", [Issued] < [Requested])"). The result is in the closed expression grammar;
 * a single plain condition is left to the ordinary filter.
 */
function whereFromText(text: string, headers: string[]): string | undefined {
  const direct =
    /\b(?:rows?\s+)?where\s+((?:AND|OR|NOT|IF)\s*\(.+\)|[^.]*\[[^\]]+\][^.]*)\s*\.?$/i.exec(
      text,
    );
  if (direct) {
    try {
      parseExpression(direct[1], headers);
      return direct[1].trim();
    } catch {
      // Words around brackets ("[Issued] is less than [Requested]"): read it as a sentence below.
    }
  }
  const body =
    /\b(?:filter|only|where|show\s+only)\s+(?:rows?\s+)?(?:where\s+)?(.+)$/i
      .exec(text)?.[1]
      ?.replace(/[[\]]/g, "");
  if (!body) return undefined;
  const pieces = body.split(/\s+(and|or)\s+/i);
  const parts: string[] = [];
  const joiners: string[] = [];
  pieces.forEach((piece, index) =>
    index % 2 === 0
      ? parts.push(piece.replace(/[.,]+$/, "").trim())
      : joiners.push(piece.toLowerCase()),
  );
  if (parts.length > 6 || new Set(joiners).size > 1) return undefined;
  const tests: string[] = [];
  let crossColumn = false;
  for (const part of parts) {
    const match =
      /^(.+?)\s*(>=|<=|<>|!=|=|>|<|\bis\s+not\b|\bis\s+(?:greater|more|bigger|higher)\s+than\b|\bis\s+(?:less|fewer|smaller|lower)\s+than\b|\bequals?\b|\bis\b|\bcontains\b)\s*(.+)$/i.exec(
        part,
      );
    if (!match) return undefined;
    const left = headerPositions(headers, match[1])[0]?.index;
    if (left === undefined) return undefined;
    const word = match[2].toLowerCase().replace(/\s+/g, " ");
    const operator = /contains/.test(word)
      ? "contains"
      : />=|<=/.test(word)
        ? word
        : /greater|more|bigger|higher|^>$/.test(word)
          ? ">"
          : /less|fewer|smaller|lower|^<$/.test(word)
            ? "<"
            : /not|!=|<>/.test(word)
              ? "<>"
              : "=";
    const rawRight = match[3].trim().replace(/^["']|["']$/g, "");
    const rightHeader = headers.findIndex(
      (header) =>
        header.trim().toLocaleLowerCase() === rawRight.toLocaleLowerCase(),
    );
    const column = `[${headers[left]}]`;
    if (rightHeader >= 0) crossColumn = true;
    const right =
      rightHeader >= 0
        ? `[${headers[rightHeader]}]`
        : Number.isFinite(Number(rawRight.replace(/,/g, ""))) &&
            !/^0\d/.test(rawRight) &&
            rawRight !== ""
          ? String(Number(rawRight.replace(/,/g, "")))
          : `"${rawRight.replace(/"/g, '""')}"`;
    tests.push(
      operator === "contains"
        ? `ISNUMBER(SEARCH(${right},${column}))`
        : `${column}${operator}${right}`,
    );
  }
  // One plain condition against a value is the ordinary filter's job.
  if (tests.length === 1 && !crossColumn) return undefined;
  const expression =
    tests.length === 1
      ? tests[0]
      : `${joiners[0] === "or" ? "OR" : "AND"}(${tests.join(",")})`;
  try {
    parseExpression(expression, headers);
  } catch {
    return undefined;
  }
  return expression;
}

function isNumericColumn(rows: Cell[][], index: number): boolean {
  const cells = rows
    .map((row) => row[index])
    .filter((cell) => cell !== null && cell !== undefined && cell !== "");
  return cells.length > 0 && cells.every((cell) => typeof cell === "number");
}

/** A dashboard is deliberately one action: it creates one reviewable, removable result sheet. */
function interpretDashboard(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
): boolean {
  if (!/\bdashboard\b/i.test(text)) return false;
  const positions = headerPositions(headers, text);
  const numeric = positions.filter((entry) =>
    isNumericColumn(rows, entry.index),
  );
  const labels = positions.filter(
    (entry) => !isNumericColumn(rows, entry.index),
  );
  const allNumeric = headers
    .map((_, index) => index)
    .filter((index) => isNumericColumn(rows, index));
  const allLabels = headers
    .map((_, index) => index)
    .filter((index) => !isNumericColumn(rows, index));
  const byMatch = /\b(?:by|per|for each|each)\s+/i.exec(text);
  const category =
    (byMatch
      ? labels.find((entry) => entry.at >= (byMatch.index ?? 0))?.index
      : undefined) ??
    labels[0]?.index ??
    allLabels[0];
  const values = (
    numeric.length ? numeric.map((entry) => entry.index) : allNumeric
  )
    .filter((index) => index !== category)
    .slice(0, 3);
  if (category === undefined || values.length === 0) {
    result.problems.push(
      "A dashboard needs a category column and at least one numeric column.",
    );
    return true;
  }
  const aggregation = /\b(count|how many)\b/i.test(text)
    ? "count"
    : /\b(average|avg|mean)\b/i.test(text)
      ? "average"
      : /\b(minimum|min|lowest)\b/i.test(text)
        ? "min"
        : /\b(maximum|max|highest)\b/i.test(text)
          ? "max"
          : "sum";
  result.actions.push("dashboard");
  result.specs.dashboard = { category, values, aggregation };
  return true;
}

const numericColumn = isNumericColumn;
const TEMPORAL_HEADER = /\b(date|day|week|month|quarter|year|period|time)\b/i;

function interpretChartAndPivot(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
  // Dates are serial numbers in Office.js, but a column named like a date is a category to group by.
  const isNumericColumn = (data: Cell[][], index: number) =>
    numericColumn(data, index) && !TEMPORAL_HEADER.test(headers[index] ?? "");
  const positions = headerPositions(headers, text);
  const numeric = positions.filter((entry) =>
    isNumericColumn(rows, entry.index),
  );
  const labels = positions.filter(
    (entry) => !isNumericColumn(rows, entry.index),
  );
  const byMatch = /\b(?:by|per|across|for each|each)\s+/i.exec(text);
  const afterBy = byMatch
    ? labels.filter((entry) => entry.at >= (byMatch.index ?? 0))
    : [];
  // A bare "create a chart" names no columns: fall back to the first label column and the numeric
  // columns of the selection so the chart is still column-aware instead of plotting the raw range.
  const bare = !byMatch && numeric.length === 0 && labels.length === 0;
  const fallbackIndexes = headers.map((_, index) => index);
  const fallbackLabel = bare
    ? fallbackIndexes.find((index) => !isNumericColumn(rows, index))
    : undefined;
  const fallbackNumeric = bare
    ? fallbackIndexes.filter(
        (index) => index !== fallbackLabel && isNumericColumn(rows, index),
      )
    : [];
  const categoryEntry =
    afterBy[0] ??
    (fallbackLabel !== undefined ? { index: fallbackLabel, at: 0 } : undefined);
  const numericEntries = numeric.length
    ? numeric
    : fallbackNumeric.map((index) => ({ index, at: 0 }));
  const requestedChartType =
    CHART_TYPE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "column";
  const waterfallCategory =
    fallbackIndexes.find((index) => !isNumericColumn(rows, index)) ??
    numeric[0]?.index;
  const chartCategoryEntry =
    requestedChartType === "histogram"
      ? (numeric[0] ?? categoryEntry)
      : requestedChartType === "waterfall"
        ? (categoryEntry ??
          (waterfallCategory === undefined
            ? undefined
            : { index: waterfallCategory, at: 0 }))
        : categoryEntry;
  if (
    /\b(chart|graph|plot|histogram|waterfall)\b/i.test(text) &&
    chartCategoryEntry &&
    numericEntries.length
  ) {
    const temporal = /\b(date|day|week|month|quarter|year|period|time)\b/i.test(
      headers[chartCategoryEntry.index] ?? "",
    );
    const chartType =
      requestedChartType === "column"
        ? bare && temporal
          ? "line"
          : "column"
        : requestedChartType;
    const [first, ...rest] = numericEntries.map((entry) => entry.index);
    const isHistogram = chartType === "histogram";
    const histogramValue = numeric[0]?.index ?? first;
    result.actions.push("chart");
    result.specs.chart = {
      category: isHistogram ? histogramValue : chartCategoryEntry.index,
      value: isHistogram ? histogramValue : first,
      chartType,
      ...(/\b(?:data\s*labels?|show\s+(?:the\s+)?values?)\b/i.test(text)
        ? { showDataLabels: true }
        : {}),
      ...(/\bpivot(?:\s*table)?\s+result\b|\bchart\s+(?:the\s+)?pivot\b/i.test(
        text,
      )
        ? { pivotResult: true }
        : {}),
      ...(isHistogram
        ? {}
        : rest.length
          ? { extraValues: rest.slice(0, 4) }
          : {}),
    };
  }
  // "count of Service ID by Status" counts a text column: there is no numeric column to add up.
  const countLabel =
    /\b(count|counting|how many)\b/i.test(text) && !numericEntries.length
      ? (labels.find((entry) => entry.index !== categoryEntry?.index) ??
        // "how many rows for each Status": nothing else is named, so count the first other text column.
        headers
          .map((_, index) => ({ index, at: 0 }))
          .find(
            (entry) =>
              entry.index !== categoryEntry?.index &&
              !isNumericColumn(rows, entry.index),
          ))
      : undefined;
  if (
    /\bpivot\b/i.test(text) &&
    categoryEntry &&
    (numericEntries.length || countLabel)
  ) {
    const aggregation = /\b(count|counting|how many)\b/i.test(text)
      ? "count"
      : /\b(average|avg|mean)\b/i.test(text)
        ? "average"
        : /\b(minimum|min|lowest)\b/i.test(text)
          ? "min"
          : /\b(maximum|max|highest)\b/i.test(text)
            ? "max"
            : "sum";
    const columns = afterBy[1];
    // "by Circuit ID and Item Code as rows" lists the second field under each first one.
    const nestedRows =
      /\b(?:as|in)\s+(?:nested\s+)?rows\b|\bnested\b|\bunder\s+each\b|\bwithin\s+each\b/i.test(
        text,
      );
    result.actions.push("pivot-table");
    const wantsShare =
      /\b(?:percent(?:age)?|%|share)\s+of\s+(?:the\s+)?(?:grand\s+)?total\b|\bshare\b/i.test(
        text,
      );
    const wantsColumnShare =
      /\bpercent(?:age)?\s+of\s+(?:the\s+)?column\b/i.test(text);
    const moreValues = bare
      ? []
      : numericEntries.slice(1, 4).map((entry) => entry.index);
    const topMatch =
      /\b(?:top|highest|best|largest|biggest)\s+(\d{1,3})\b/i.exec(text);
    const bottomMatch =
      /\b(?:bottom|lowest|least|smallest|worst)\s+(\d{1,3})\b/i.exec(text);
    result.specs.pivot = {
      rows: categoryEntry.index,
      values: numericEntries[0]?.index ?? countLabel!.index,
      aggregation,
      ...(columns
        ? nestedRows
          ? { subRows: columns.index }
          : { columns: columns.index }
        : {}),
      ...(moreValues.length ? { extraValues: moreValues } : {}),
      ...(wantsColumnShare
        ? { showAs: "percent-of-column" as const }
        : wantsShare
          ? { showAs: "percent-of-total" as const }
          : {}),
      ...(topMatch && Number(topMatch[1]) >= 1
        ? { topN: Number(topMatch[1]) }
        : bottomMatch && Number(bottomMatch[1]) >= 1
          ? { topN: Number(bottomMatch[1]), lowest: true }
          : {}),
    };
    const filterMatch = /\bfilter(?:ed)?\s+(?:by|on|using)\s+/i.exec(text);
    if (filterMatch && result.specs.pivot) {
      const filterEntry = labels.find(
        (entry) =>
          entry.at >= filterMatch.index &&
          entry.index !== categoryEntry.index &&
          entry.index !== (columns?.index ?? -1),
      );
      if (filterEntry) result.specs.pivot.filter = filterEntry.index;
    }
  }
}

function interpretView(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
  const view: NonNullable<InstructionSpecs["view"]> = {};
  const header = (name: string) => {
    const found = headerPositions(headers, name)[0];
    return found ? found.index : -1;
  };
  const top = /\b(top|bottom)\s+(\d{1,3})\b(?:\s+(?:by|of|in)\s+)?(.*)$/i.exec(
    text,
  );
  if (top) {
    const column = header(top[3]);
    if (
      column >= 0 &&
      isNumericColumn(rows, column) &&
      !/\bconditional\s+format(?:ting)?\b|\bformat(?:ting)?\b/i.test(text)
    ) {
      const rule = top[1].toLowerCase() === "top" ? "top-n" : "bottom-n";
      view.highlight = { column, rule, n: Number(top[2]) };
      view.sort = { column, direction: rule === "top-n" ? "desc" : "asc" };
      // "Show the top 3 rows" keeps only those rows; "highlight the top 3" keeps all of them.
      if (
        /\b(?:show|list|keep|only|just|give|display)\b/i.test(text) &&
        !/\bhighlight\b/i.test(text)
      )
        view.limit = Number(top[2]);
    }
  }
  const sort =
    /\bsort(?:ed)?\s+(?:(?:by|on)\s+)?(.+?)(?:\s+(descending|desc|ascending|asc|(?:highest|biggest|largest|greatest|most)(?:\s+first)?|(?:lowest|smallest|least)(?:\s+first)?|high(?:est)?\s+to\s+low(?:est)?|low(?:est)?\s+to\s+high(?:est)?))?(?:\s+(?:and|then)\b|[.,]|$)/i.exec(
      text,
    );
  if (sort && !view.sort) {
    const column = header(sort[1]);
    if (column >= 0)
      view.sort = {
        column,
        direction:
          /desc|highest|biggest|largest|greatest|\bmost\b|high(?:est)?\s+to\s+low/i.test(
            sort[2] ?? "",
          )
            ? "desc"
            : "asc",
      };
  }
  const above = /\bhighlight\s+(above|below)\s+average\s+(.+?)(?:[.,]|$)/i.exec(
    text,
  );
  if (above) {
    const column = header(above[2]);
    if (column >= 0 && isNumericColumn(rows, column))
      view.highlight = {
        column,
        rule:
          above[1].toLowerCase() === "above"
            ? "above-average"
            : "below-average",
      };
  }
  const dup = /\bhighlight\s+duplicates?(?:\s+in\s+(.+?))?(?:[.,]|$)/i.exec(
    text,
  );
  const shownDup =
    /\b(?:show|display)\s+duplicates?\s+(.+?)(?:\s+values?)?(?:[.,]|$)/i.exec(
      text,
    );
  if (dup || shownDup) {
    const column = header(dup?.[1] ?? shownDup?.[1] ?? "");
    if (column >= 0) view.highlight = { column, rule: "duplicates" };
  }
  // "delete / remove the rows where ...": the original is never changed, so the safe reading is a copy WITHOUT them.
  const removing =
    /\b(?:delete|remove|drop|erase|discard|exclude|get\s+rid\s+of)\b/i.test(
      text,
    ) && !/\b(?:duplicates?|blanks?|empty)\b/i.test(text);
  const where = whereFromText(text, headers);
  if (where) view.where = removing ? `NOT(${where})` : where;
  const filter = where
    ? null
    : /\b(?:filter|only|where|show only)\s+(?:rows?\s+where\s+)?(.+?)\s*(>=|<=|!=|=|>|<|\bequals?\b|\bis\b|\bcontains\b)\s*["']?([^"'.,]+?)["']?(?:\s+(?:and|then)\b|[.,]|$)/i.exec(
        text,
      );
  if (filter) {
    const column = header(filter[1]);
    const operator = (
      filter[2].toLowerCase() === "equals" ||
      filter[2].toLowerCase() === "equal" ||
      filter[2].toLowerCase() === "is"
        ? "="
        : filter[2].toLowerCase()
    ) as NonNullable<
      NonNullable<InstructionSpecs["view"]>["filter"]
    >["operator"];
    const raw = filter[3].trim();
    if (column >= 0 && raw) {
      const asNumber = Number(raw.replace(/,/g, ""));
      view.filter = {
        column,
        operator: removing && operator === "=" ? "!=" : operator,
        value:
          operator !== "contains" &&
          raw !== "" &&
          Number.isFinite(asNumber) &&
          // 0112005016 is an identifier, not the number 112005016.
          !/^0\d/.test(raw) &&
          raw.replace(/[,.\-]/g, "").length <= 15
            ? asNumber
            : raw,
      };
    }
  }
  // "copy this data to a new sheet": a live, bounded copy of the first 50,000 rows.
  if (
    !view.sort &&
    !view.filter &&
    !view.where &&
    !view.highlight &&
    /\b(?:copy|duplicate|clone)\b[^.\n]{0,40}\b(?:to|into|in)\s+(?:a\s+)?new\s+(?:sheet|worksheet|tab)\b/i.test(
      text,
    )
  )
    view.limit = 50000;
  if (view.sort || view.filter || view.highlight || view.limit || view.where) {
    result.actions.push("view");
    result.specs.view = view;
  }
}

export interface Answer {
  question: string;
  answer: string;
}

const QUESTION_START =
  /^\s*(what|which|who|how|when|where|top|highest|lowest|best|worst|total|sum|average|avg|mean|count|max|min|show)\b|\?\s*$/i;

/** True when the text reads as a question about the data rather than a workbook request. */
export function looksLikeQuestion(instruction: string): boolean {
  return QUESTION_START.test(instruction);
}

const fmt = (value: number) =>
  (Math.round(value * 100) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest header mentioned in the question (so "Sales Cost" beats "Sales"). */
function mentioned(
  headers: string[],
  text: string,
  skip = -1,
  allowed?: Set<number>,
): number {
  const lower = text.toLocaleLowerCase();
  let best = -1;
  let bestLength = 0;
  headers.forEach((header, index) => {
    const name = header.toLocaleLowerCase().trim();
    if (index === skip || !name || (allowed && !allowed.has(index))) return;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegex(name)}([^\\p{L}\\p{N}]|$)`,
      "u",
    );
    if (pattern.test(lower) && name.length > bestLength) {
      best = index;
      bestLength = name.length;
    }
  });
  return best;
}

/**
 * Answers simple aggregate questions with a deterministic query over the selected rows. Nothing is
 * sent anywhere; the answer is computed in the task pane.
 */
export function answerQuestion(
  question: string,
  headers: string[],
  rows: Cell[][],
): Answer | undefined {
  const lower = question.toLocaleLowerCase();
  const isNumeric = (index: number) =>
    rows.some((row) => typeof row[index] === "number") &&
    rows.every(
      (row) =>
        row[index] === null ||
        row[index] === "" ||
        typeof row[index] === "number",
    );
  const numericIndexes = headers
    .map((_, index) => index)
    .filter((index) => isNumeric(index));
  const textIndexes = new Set(
    headers.map((_, index) => index).filter((index) => !isNumeric(index)),
  );
  const valueIndex = mentioned(headers, lower, -1, new Set(numericIndexes));
  const groupIndex = mentioned(headers, lower, -1, textIndexes);

  if (
    /\b(how many rows|number of rows|row count|count)\b/.test(lower) &&
    valueIndex < 0 &&
    groupIndex < 0
  )
    return { question, answer: `There are ${rows.length} data rows.` };

  const target =
    valueIndex >= 0
      ? valueIndex
      : numericIndexes.length === 1
        ? numericIndexes[0]
        : -1;
  if (target < 0) return undefined;
  const values = rows
    .map((row) => row[target])
    .filter((cell): cell is number => typeof cell === "number");
  if (!values.length) return undefined;

  const wantsExtreme = /\b(top|highest|best|most|largest|biggest|max)\b/.test(
    lower,
  );
  const wantsLowest = /\b(lowest|worst|least|smallest|min)\b/.test(lower);
  if (groupIndex >= 0 && groupIndex !== target) {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = String(row[groupIndex] ?? "").trim();
      const value = row[target];
      if (!key || typeof value !== "number") continue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return undefined;
    if (wantsLowest) {
      const [name, value] = ranked[ranked.length - 1];
      return {
        question,
        answer: `${name} has the lowest ${headers[target]}: ${fmt(value)}.`,
      };
    }
    if (wantsExtreme || /\bwhich\b|\bwho\b/.test(lower)) {
      const [name, value] = ranked[0];
      return {
        question,
        answer: `${name} has the highest ${headers[target]}: ${fmt(value)}.`,
      };
    }
    return {
      question,
      answer: `${headers[target]} by ${headers[groupIndex]}: ${ranked
        .map(([name, value]) => `${name} ${fmt(value)}`)
        .join(", ")}.`,
    };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (/\b(average|avg|mean)\b/.test(lower))
    return {
      question,
      answer: `Average ${headers[target]}: ${fmt(sum / values.length)}.`,
    };
  if (wantsLowest)
    return {
      question,
      answer: `Lowest ${headers[target]}: ${fmt(Math.min(...values))}.`,
    };
  if (wantsExtreme)
    return {
      question,
      answer: `Highest ${headers[target]}: ${fmt(Math.max(...values))}.`,
    };
  if (/\b(total|sum)\b/.test(lower))
    return { question, answer: `Total ${headers[target]}: ${fmt(sum)}.` };
  return undefined;
}

/**
 * "Summary of Sales and Cost by Region" or "Totals table of Sales by Region": a live summary sheet
 * of SUMIFS/COUNTIFS/AVERAGEIFS formulas. Plain "total Sales by Region" questions stay local answers.
 */
function interpretSummary(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
  const summaryWords =
    /\bsummary\b|\bsummari[sz]e\b|\btotals?\s+(?:table|sheet)\b|\bsubtotals?\b/i.test(
      text,
    ) ||
    /\b(?:total|sum|average|avg|mean|count)\b[^.\n]{1,80}\b(?:by|per|for each|each)\b/i.test(
      text,
    );
  if (!summaryWords) return;
  if (/\bpivot\b|\bchart\b|\bgraph\b/i.test(text)) return;
  const positions = headerPositions(headers, text);
  const byMatch = /\b(?:by|per|for each|each)\s+/i.exec(text);
  if (!byMatch) return;
  const isNumeric = (index: number) => isNumericColumn(rows, index);
  const labelEntry = positions.find(
    (entry) => entry.at >= byMatch.index && !isNumeric(entry.index),
  );
  const wantsCount = /\b(count|how many)\b/i.test(text);
  const measures = positions.filter(
    (entry) =>
      entry.at < byMatch.index &&
      (wantsCount || isNumeric(entry.index)) &&
      entry.index !== labelEntry?.index,
  );
  if (!labelEntry || measures.length === 0) return;
  const aggregation = wantsCount
    ? "count"
    : /\b(average|avg|mean)\b/i.test(text)
      ? "average"
      : /\b(minimum|min|lowest)\b/i.test(text)
        ? "min"
        : /\b(maximum|max|highest)\b/i.test(text)
          ? "max"
          : "sum";
  result.actions.push("summary");
  result.specs.summary = {
    group: labelEntry.index,
    values: measures.slice(0, 4).map((entry) => ({
      column: entry.index,
      aggregation,
    })),
  };
}

/**
 * Presentation and checking requests. "Format as a table" stays the table action; this reads
 * "make it presentable", "freeze the header", "data bars on Sales", "highlight negative values",
 * "highlight duplicates in Region", "drop-down for Region", "add a total row" and data quality checks.
 */
/**
 * "Describe Sales and Cost", "correlation between Sales and Cost", "forecast Sales for the next 4
 * periods": deterministic statistics written as live formulas on a new sheet.
 */
function interpretStatistics(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
  if (
    /\b(?:formula|formulas)\b/i.test(text) &&
    /\b(?:explain|what\s+does|describe|inspect|audit|check|find)\b/i.test(text)
  )
    return;
  const numericAll = headers
    .map((_, index) => index)
    .filter((index) => isNumericColumn(rows, index));
  const mentioned = headerPositions(headers, text)
    .filter((entry) => isNumericColumn(rows, entry.index))
    .map((entry) => entry.index);
  const headerBy = (pattern: RegExp): number | undefined => {
    const index = headers.findIndex((header) => pattern.test(header));
    return index >= 0 && isNumericColumn(rows, index) ? index : undefined;
  };
  if (
    /\b(?:forecast|predict|project|extrapolate)\b/i.test(text) &&
    /\b(?:confidence|interval|seasonal|seasonality|ets)\b/i.test(text)
  ) {
    const value = mentioned[0] ?? numericAll[0];
    if (value === undefined) {
      result.problems.push("An advanced forecast needs a numeric column.");
      return;
    }
    const periods = /\b(?:next|for|another)\s+(\d{1,2})\b/i.exec(text);
    const date = headers.findIndex((header) =>
      /\b(date|month|quarter|year|week|period)\b/i.test(header),
    );
    result.actions.push("statistics");
    result.specs.statistics = {
      mode: "advanced-forecast",
      value,
      periods: periods ? Math.min(24, Math.max(1, Number(periods[1]))) : 6,
      ...(date >= 0 && date !== value ? { date } : {}),
    };
    return;
  }
  if (
    /\b(?:roi|ebitda|gross\s+margin|operating\s+margin|financial|budget|actual)\b/i.test(
      text,
    )
  ) {
    const candidates = [
      headerBy(/revenue|sales|income|turnover/i),
      headerBy(/cogs|cost\s+of\s+goods|cost/i),
      headerBy(/operating\s+expense|opex|expense/i),
      headerBy(/depreciation/i),
      headerBy(/interest/i),
      headerBy(/tax/i),
      headerBy(/invested\s+capital|capital|assets|equity/i),
      ...mentioned,
      ...numericAll,
    ].filter(
      (index, position, all): index is number =>
        index !== undefined && all.indexOf(index) === position,
    );
    if (candidates.length < 3) {
      result.problems.push(
        "A financial report needs revenue, cost and expense columns.",
      );
      return;
    }
    result.actions.push("statistics");
    result.specs.statistics = {
      mode: "financial",
      columns: candidates.slice(0, 7),
    };
    return;
  }
  if (
    /\b(?:anomal(?:y|ies)|outliers?|fraud(?:ulent)?|unusual|abnormal)\b/i.test(
      text,
    )
  ) {
    const value = mentioned[0] ?? numericAll[0];
    if (value === undefined) {
      result.problems.push("Anomaly analysis needs a numeric column.");
      return;
    }
    result.actions.push("statistics");
    result.specs.statistics = { mode: "anomaly", value };
    return;
  }
  // "the trend over time as a line" asks for a chart, not an insight report.
  const trendAsChart =
    /\btrends?\b/i.test(text) &&
    !/\b(?:insights?|anomal(?:y|ies)|outliers?)\b/i.test(text) &&
    /\b(?:chart|graph|line|plot|over\s+time|monthly|per\s+month|by\s+month)\b/i.test(
      text,
    );
  if (
    !trendAsChart &&
    /\b(?:insight|insights|anomal(?:y|ies)|outliers?|trends?|recommend(?:ed|ation)?\s+(?:next\s+)?actions?)\b/i.test(
      text,
    )
  ) {
    const value = mentioned[0] ?? numericAll[0];
    if (value === undefined) {
      result.problems.push("An insight report needs a numeric column.");
      return;
    }
    const date = headers.findIndex((header) =>
      /\b(date|month|quarter|year|week)\b/i.test(header),
    );
    const asked = headerPositions(headers, text).find(
      (entry) =>
        entry.index !== date &&
        entry.index !== value &&
        !isNumericColumn(rows, entry.index),
    );
    const category =
      asked?.index ??
      headers.findIndex(
        (header, index) =>
          index !== date &&
          index !== value &&
          !isNumericColumn(rows, index) &&
          /\b(region|category|status|customer|department|product|type)\b/i.test(
            header,
          ),
      );
    result.actions.push("statistics");
    result.specs.statistics = {
      mode: "insights",
      value,
      ...(category >= 0 ? { category } : {}),
      ...(date >= 0 ? { date } : {}),
    };
    return;
  }
  if (/\bcorrelat(?:e|ion|ions)\b|\brelationship\s+between\b/i.test(text)) {
    const pair = mentioned.length >= 2 ? mentioned : numericAll;
    if (pair.length >= 2) {
      result.actions.push("statistics");
      result.specs.statistics = {
        mode: "correlation",
        pair: [pair[0], pair[1]],
      };
    } else result.problems.push("Correlation needs two numeric columns.");
    return;
  }
  if (/\b(?:forecast|predict|project|extrapolate)\b/i.test(text)) {
    const column = mentioned[0] ?? numericAll[0];
    if (column === undefined) {
      result.problems.push("A forecast needs a numeric column.");
      return;
    }
    const periods = /\b(?:next|for|another)\s+(\d{1,2})\b/i.exec(text);
    result.actions.push("statistics");
    result.specs.statistics = {
      mode: "forecast",
      value: column,
      periods: periods ? Math.min(24, Math.max(1, Number(periods[1]))) : 3,
    };
    return;
  }
  if (
    /\b(?:descriptive\s+)?statistics\b|\bstats\b|\bdescribe\b|\bstandard\s+deviation\b|\bmedian\b|\bquartiles?\b/i.test(
      text,
    )
  ) {
    const columns = (mentioned.length ? mentioned : numericAll).slice(0, 8);
    if (!columns.length) {
      result.problems.push("Statistics need at least one numeric column.");
      return;
    }
    result.actions.push("statistics");
    result.specs.statistics = { mode: "describe", columns };
  }
}

function interpretFormatAndQuality(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
  // "highlight Sales above 10" reads like "greater than 10".
  if (/\b(?:highlight|mark|colou?r|flag)\b/i.test(text))
    text = text
      .replace(
        /\b(?:above|over|exceeding|more\s+than)\s+(?=-?\d)/gi,
        "greater than ",
      )
      .replace(/\b(?:below|under|fewer\s+than)\s+(?=-?\d)/gi, "less than ");
  const formulaRepair =
    /\b(?:repair|fix|correct|replace)\b[^.\n]{0,80}(?:formulas?|#REF!|#DIV\/0!)/i.test(
      text,
    );
  const formulaAudit =
    formulaRepair ||
    /\b(?:audit|inspect|check|find|identify|explain|describe)\b[^.\n]{0,80}\bformulas?\b|\bwhat\s+does\b[^.\n]{0,80}\bformulas?\b|\bformulas?\b[^.\n]{0,80}\b(?:errors?|circular|references?)\b/i.test(
      text,
    );
  if (
    formulaAudit ||
    /\b(?:data\s+)?quality\b|\bhealth\s*check\b|\bfind\s+(?:problems|issues|errors)\b|\b(?:repair|fix)\s+(?:the\s+)?data(?:\s+(?:problems|issues|errors))?\b|\bcheck\s+(?:the\s+)?data\b|\baudit\b/i.test(
      text,
    )
  ) {
    result.actions.push("quality");
    if (formulaAudit)
      result.specs.quality = { mode: formulaRepair ? "repair" : "formula" };
  }
  if (/format\s+as\s+(?:a\s+)?table/i.test(text)) return;
  const wants =
    /\bpresentable\b|\bprofessional(?:ly)?\b|\bpolish\b|\bbeautif(?:y|ul)\b|\bfreeze\b|\bdata\s*bars?\b|\bicon\s*sets?\b|\barrows?\b|\bbetween\s+-?\d|\b(?:allow|only|accept|valid)\b[^.\n]{0,40}\bfrom\s+-?\d[\d,]*(?:\.\d+)?\s+to\s+-?\d|\b(?:at\s+most|maximum|up\s+to)\s+\d+\s+characters\b|\blimit\b[^.\n]{0,80}\bcharacters\b|\b(?:non[- ]negative|zero\s+or\s+positive)\b|\bcolou?r\s*scale\b|\bconditional\s+formatting\b|\bcustom\s+formula\b|\bhighlight\s+(?:the\s+)?(?:negative|duplicates?)\b|\bhighlight\b[^.\n]{0,80}(?:>=|<=|<>|>|<|\bgreater\s+than\b|\bless\s+than\b|\bequal\s+to\b)|\b(?:top|bottom)\s+\d{1,3}\b[^.\n]{0,80}\bconditional\s+format(?:ting)?\b|\b(?:highlight|format)\b[^.\n]{0,80}\bcontain(?:s|ing)\b|\b(?:date|dates)\b[^.\n]{0,80}\b(?:between|from)\s+\d{4}-\d{2}-\d{2}\b|\bdrop-?\s?down\b|\bvalidation\b|\b(?:allow|accept|require|ensure)\b[^.\n]{0,20}\bdates?\s+(?:in|for|on)\b|\btotals?\s+row\b|\bformat\s+(?:the\s+)?(?:data|numbers|sheet)\b/i.test(
      text,
    );
  if (!wants) return;
  const positions = headerPositions(headers, text);
  const numericAll = headers
    .map((_, index) => index)
    .filter((index) => isNumericColumn(rows, index));
  const mentionedNumeric = positions
    .filter((entry) => isNumericColumn(rows, entry.index))
    .map((entry) => entry.index);
  const mentionedLabel = positions
    .filter((entry) => !isNumericColumn(rows, entry.index))
    .map((entry) => entry.index);
  const conditional: NonNullable<InstructionSpecs["format"]>["conditional"] =
    [];
  const pickNumeric = mentionedNumeric.length ? mentionedNumeric : numericAll;
  // "arrow icons on Sales and allow Cost between 1 and 9": each rule owns the columns named in its
  // own clause (the words after its keyword, up to the next "and allow/add/with ...").
  const clauseColumns = (keyword: RegExp): number[] => {
    const found = keyword.exec(text);
    if (!found) return pickNumeric;
    const clause = text
      .slice(found.index)
      .split(
        /\s+(?:and|then|,|;)\s+(?=(?:allow|add|with|make|highlight|format|freeze|use|show)\b)/i,
      )[0]
      .toLowerCase();
    const own = numericAll.filter((index) =>
      clause.includes(String(headers[index]).toLowerCase()),
    );
    return own.length ? own : pickNumeric;
  };
  const barKeyword = /\bdata\s*bars?\b/i;
  const scaleKeyword = /\bcolou?r\s*scale\b/i;
  const iconKeyword = /\bicon\s*sets?\b|\barrows?\b|\btraffic\s*lights?\b/i;
  const negativeKeyword = /\bhighlight\s+(?:the\s+)?negative/i;
  if (barKeyword.test(text))
    for (const column of clauseColumns(barKeyword).slice(0, 3))
      conditional.push({ column, rule: "data-bars" });
  if (scaleKeyword.test(text))
    for (const column of clauseColumns(scaleKeyword).slice(0, 3))
      conditional.push({ column, rule: "color-scale" });
  if (iconKeyword.test(text))
    for (const column of clauseColumns(iconKeyword).slice(0, 3))
      conditional.push({ column, rule: "icon-set" });
  if (negativeKeyword.test(text))
    for (const column of clauseColumns(negativeKeyword).slice(0, 3))
      conditional.push({ column, rule: "negative" });
  const rankFormat = /\b(top|bottom)\s+(\d{1,3})\b/i.exec(text);
  if (
    rankFormat &&
    /\bconditional\s+format(?:ting)?\b|\bformat(?:ting)?\b/i.test(text)
  ) {
    const rank = Number(rankFormat[2]);
    const target =
      positions
        .filter(
          (entry) =>
            entry.at > rankFormat.index && isNumericColumn(rows, entry.index),
        )
        .map((entry) => entry.index)[0] ?? pickNumeric[0];
    if (target !== undefined && rank >= 1 && rank <= 100)
      conditional.push({
        column: target,
        rule: rankFormat[1].toLowerCase() === "top" ? "top-n" : "bottom-n",
        n: rank,
      });
  }
  if (/\bhighlight\s+(?:the\s+)?duplicates?/i.test(text)) {
    const targets = mentionedLabel.length ? mentionedLabel : mentionedNumeric;
    for (const column of targets.slice(0, 2))
      conditional.push({ column, rule: "duplicates" });
  }
  const comparisonWords: Array<{
    pattern: string;
    operator: ">" | ">=" | "<" | "<=" | "=" | "<>";
  }> = [
    { pattern: "greater\\s+than\\s+or\\s+equal\\s+to", operator: ">=" },
    { pattern: "less\\s+than\\s+or\\s+equal\\s+to", operator: "<=" },
    { pattern: "not\\s+equal\\s+to", operator: "<>" },
    { pattern: "greater\\s+than", operator: ">" },
    { pattern: "less\\s+than", operator: "<" },
    { pattern: "equal\\s+to", operator: "=" },
    { pattern: ">=", operator: ">=" },
    { pattern: "<=", operator: "<=" },
    { pattern: "<>", operator: "<>" },
    { pattern: ">", operator: ">" },
    { pattern: "<", operator: "<" },
    { pattern: "=", operator: "=" },
  ];
  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [column, header] of headers.entries()) {
    const match = new RegExp(
      `${escapeRegExp(String(header))}\\s+(?:cells?\\s+)?contain(?:s|ing)\\s+(.+?)(?:\\s+(?:with|using)\\s+(?:a\\s+)?conditional\\s+format(?:ting)?\\b|[.,]|$)`,
      "i",
    ).exec(text);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value.length >= 1 && value.length <= 80)
      conditional.push({ column, rule: "text-contains", text: value });
  }
  for (const [column, header] of headers.entries()) {
    if (!isNumericColumn(rows, column)) continue;
    const escapedHeader = escapeRegExp(String(header));
    const match = new RegExp(
      `${escapedHeader}\\s+(?:dates?\\s+)?(?:between\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(?:and|to)\\s+(\\d{4}-\\d{2}-\\d{2})|from\\s+(\\d{4}-\\d{2}-\\d{2})\\s+to\\s+(\\d{4}-\\d{2}-\\d{2}))`,
      "i",
    ).exec(text);
    if (!match) continue;
    const startDate = match[1] ?? match[3];
    const endDate = match[2] ?? match[4];
    if (startDate && endDate)
      conditional.push({ column, rule: "date-range", startDate, endDate });
  }
  for (const [column, header] of headers.entries()) {
    if (!isNumericColumn(rows, column)) continue;
    for (const comparison of comparisonWords) {
      const match = new RegExp(
        `${escapeRegExp(String(header))}\\s*(?:is\\s+)?${comparison.pattern}\\s*(-?\\d+(?:,\\d{3})*(?:\\.\\d+)?)`,
        "i",
      ).exec(text);
      if (!match) continue;
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value))
        conditional.push({
          column,
          rule: "custom-formula",
          operator: comparison.operator,
          value,
        });
      break;
    }
  }
  const validation: NonNullable<InstructionSpecs["format"]>["validation"] = [];
  const inputMessageRequested = /\binput\s+message\b/i.test(text);
  const inputMessageColumn = mentionedLabel[0];
  const inputMessage =
    inputMessageRequested && inputMessageColumn !== undefined
      ? {
          column: inputMessageColumn,
          title: "VynorAI guidance",
          message: `Choose a valid ${headers[inputMessageColumn]} value.`,
        }
      : undefined;
  if (
    /\bdrop-?\s?down\b/i.test(text) ||
    (/\bvalidation\b/i.test(text) && inputMessageRequested)
  )
    for (const column of mentionedLabel.slice(0, 2))
      validation.push({ column, rule: "list" });
  const nonNegative =
    /\b(?:only\s+allow|allow\s+only|require|ensure)\s+(?:non[- ]negative|zero\s+or\s+positive)\s+(.+?)(?:\s+(?:values?|numbers?|data))?(?:[.,]|$)/i.exec(
      text,
    );
  if (nonNegative) {
    const column = headerPositions(headers, nonNegative[1])[0]?.index ?? -1;
    if (column >= 0) validation.push({ column, rule: "non-negative" });
  }
  const dateOnly =
    /\b(?:only\s+allow|allow\s+only|accept\s+only|require|ensure|allow)\s+(?:only\s+)?(?:valid\s+)?dates?\s+(?:in|for|on)\s+(.+?)(?:[.,]|$)/i.exec(
      text,
    );
  if (dateOnly) {
    const column = headerPositions(headers, dateOnly[1])[0]?.index ?? -1;
    if (column >= 0) validation.push({ column, rule: "date" });
  }
  const range =
    /\b(?:between|from)\s+(-?\d[\d,]*(?:\.\d+)?)\s+(?:and|to)\s+(-?\d[\d,]*(?:\.\d+)?)/i.exec(
      text,
    );
  if (range && pickNumeric.length) {
    const low = Number(range[1].replace(/,/g, ""));
    const high = Number(range[2].replace(/,/g, ""));
    if (Number.isFinite(low) && Number.isFinite(high) && low < high)
      validation.push({
        column: (() => {
          // The column named just before "between" (closest to it) owns the range.
          const before = text.slice(0, range.index).toLowerCase();
          const near = numericAll
            .map((index) => ({
              index,
              at: before.lastIndexOf(String(headers[index]).toLowerCase()),
            }))
            .filter((entry) => entry.at >= 0)
            .sort((x, y) => y.at - x.at)[0];
          return near ? near.index : pickNumeric[0];
        })(),
        rule: "between",
        min: low,
        max: high,
      });
  }
  const length =
    /\b(?:at\s+most|maximum|up\s+to)\s+(\d{1,3})\s+characters\b|\blimit\s+(.+?)\s+to\s+(\d{1,3})\s+characters\b/i.exec(
      text,
    );
  if (length) {
    const max = Number(length[1] ?? length[3]);
    const column = length[2]
      ? (headerPositions(headers, length[2])[0]?.index ?? -1)
      : (mentionedLabel[0] ?? -1);
    if (column >= 0 && max >= 1 && max <= 255)
      validation.push({ column, rule: "max-length", max });
  }
  // "validation: Region at most 12 characters" is a length rule, not also a drop-down.
  if (!/\bdrop-?\s?down\b/i.test(text)) {
    const ruled = new Set(
      validation
        .filter((rule) => rule.rule !== "list")
        .map((rule) => rule.column),
    );
    for (let at = validation.length - 1; at >= 0; at -= 1)
      if (validation[at].rule === "list" && ruled.has(validation[at].column))
        validation.splice(at, 1);
  }
  const format: NonNullable<InstructionSpecs["format"]> = {
    freezeHeader: true,
    ...(/\btotals?\s+row\b/i.test(text) ? { totalRow: true } : {}),
    ...(conditional.length ? { conditional } : {}),
    ...(validation.length ? { validation } : {}),
    ...(inputMessage ? { inputMessage } : {}),
  };
  result.actions.push("format");
  result.specs.format = format;
}
