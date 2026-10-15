import {
  CLEAN_OPERATIONS,
  isSafeColumnName,
  type CleanOperation,
  type ComputeOperator,
} from "./transform.js";

type Cell = string | number | boolean | null;

export interface InstructionSpecs {
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
      | "area";
    extraValues?: number[];
  };
  pivot?: {
    rows: number;
    values: number;
    aggregation?: "sum" | "count" | "average" | "min" | "max";
    columns?: number;
  };
  view?: {
    sort?: { column: number; direction: "asc" | "desc" };
    filter?: {
      column: number;
      operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains";
      value: string | number;
    };
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
  };
  clean?: { operations: CleanOperation[] };
  addColumn?: {
    name: string;
    left: number;
    operator: ComputeOperator;
    right: number;
  };
}

export interface InterpretedInstruction {
  actions: Array<"clean" | "add-column" | "chart" | "pivot-table" | "view">;
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
export function interpretInstruction(
  rawInstruction: string,
  headers: string[],
  rows: Cell[][] = [],
): InterpretedInstruction {
  const instruction = normalizeInstruction(rawInstruction);
  const result: InterpretedInstruction = {
    actions: [],
    specs: {},
    problems: [],
  };
  const text = instruction.replace(/[_]+/g, " ");

  const operations = new Set<CleanOperation>();
  if (/\b(clean|tidy|fix)\b|\btrim\b|\bwhitespace\b/i.test(text))
    operations.add("trim");
  if (/\bclean\b|\btidy\b/i.test(text)) operations.add("text-to-number");
  if (
    /text\s+to\s+numbers?|numbers?\s+stored\s+as\s+text|fix\s+numbers?/i.test(
      text,
    )
  )
    operations.add("text-to-number");
  if (
    /\bdedup(?:e|licate)s?\b|remove\s+duplicates?|duplicate\s+rows?/i.test(text)
  )
    operations.add("dedupe");
  if (/\bclean\b|\btidy\b/i.test(text)) operations.add("dedupe");
  if (operations.size > 0) {
    result.actions.push("clean");
    result.specs.clean = {
      operations: CLEAN_OPERATIONS.filter((operation) =>
        operations.has(operation),
      ),
    };
  }

  const column =
    /\b(?:add|create|insert)\s+(?:a\s+|an\s+|new\s+)*(?:computed\s+|calculated\s+)?column\s+(?:called\s+|named\s+)?["']?([^"'=:]+?)["']?\s*(?:=|:|as)\s*(.+?)\s*\.?$/i.exec(
      text,
    ) || /^\s*["']?([A-Za-z][\w ]{0,39}?)["']?\s*=\s*(.+?)\s*\.?$/i.exec(text);
  if (column) {
    const name = column[1].trim();
    const expression = column[2].trim();
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
    if (operator && parts.length === 2) {
      const left = findHeader(headers, parts[0]);
      const right = findHeader(headers, parts[1]);
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
  interpretChartAndPivot(text, headers, rows, result);
  interpretView(text, headers, rows, result);
  return result;
}

/**
 * Maps common Sinhala and Singlish words to the English keywords the deterministic readers use,
 * so the same instructions work in all three without sending anything to a model.
 */
export function normalizeInstruction(text: string): string {
  const table: Array<[RegExp, string]> = [
    [
      /ප්‍රස්තාරය?|ප්‍රස්ථාරය?|prasthara(ya)?|grap[h]? ekak?\b|chart ekak?\b/gi,
      "chart",
    ],
    [/පිවට්|pivot ekak?\b/gi, "pivot"],
    [/වගුව|wagu(wa)?|table ekak?\b/gi, "table"],
    [/පිරිසිදු|pirisidu|clean karanna|saaf/gi, "clean"],
    [/අනුපිටපත්|anupitapath|duplicate ekak?\b/gi, "duplicates"],
    [/අලුත් (පත්‍රය|sheet)|alut sheet|new sheet ekak?\b/gi, "new sheet"],
    [/වර්ග කරන්න|warga karanna|sort karanna/gi, "sort"],
    [/ඉහළම|ihalama|uda/gi, "top"],
    [/පහළම|pahalama/gi, "bottom"],
    [/මුළු|mulu|total ekak?\b/gi, "total"],
    [/සාමාන්‍යය|saamanya/gi, "average"],
    [/හදන්න|හදලා දෙන්න|hadanna|hadala denna|karanna/gi, ""],
    [/විකුණුම්|wikunum/gi, "Sales"],
  ];
  let out = text;
  for (const [pattern, replacement] of table)
    out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}

const CHART_TYPE_WORDS: Array<
  [RegExp, NonNullable<InstructionSpecs["chart"]>["chartType"]]
> = [
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

function isNumericColumn(rows: Cell[][], index: number): boolean {
  const cells = rows
    .map((row) => row[index])
    .filter((cell) => cell !== null && cell !== undefined && cell !== "");
  return cells.length > 0 && cells.every((cell) => typeof cell === "number");
}

function interpretChartAndPivot(
  text: string,
  headers: string[],
  rows: Cell[][],
  result: InterpretedInstruction,
) {
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
  if (
    /\b(chart|graph|plot)\b/i.test(text) &&
    categoryEntry &&
    numericEntries.length
  ) {
    const temporal = /\b(date|day|week|month|quarter|year|period|time)\b/i.test(
      headers[categoryEntry.index] ?? "",
    );
    const chartType =
      CHART_TYPE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ??
      (bare && temporal ? "line" : "column");
    const [first, ...rest] = numericEntries.map((entry) => entry.index);
    result.actions.push("chart");
    result.specs.chart = {
      category: categoryEntry.index,
      value: first,
      chartType,
      ...(rest.length ? { extraValues: rest.slice(0, 4) } : {}),
    };
  }
  if (/\bpivot\b/i.test(text) && categoryEntry && numericEntries.length) {
    const aggregation = /\b(count|how many)\b/i.test(text)
      ? "count"
      : /\b(average|avg|mean)\b/i.test(text)
        ? "average"
        : /\b(minimum|min|lowest)\b/i.test(text)
          ? "min"
          : /\b(maximum|max|highest)\b/i.test(text)
            ? "max"
            : "sum";
    const columns = afterBy[1];
    result.actions.push("pivot-table");
    result.specs.pivot = {
      rows: categoryEntry.index,
      values: numericEntries[0].index,
      aggregation,
      ...(columns ? { columns: columns.index } : {}),
    };
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
    if (column >= 0 && isNumericColumn(rows, column)) {
      const rule = top[1].toLowerCase() === "top" ? "top-n" : "bottom-n";
      view.highlight = { column, rule, n: Number(top[2]) };
      view.sort = { column, direction: rule === "top-n" ? "desc" : "asc" };
    }
  }
  const sort =
    /\bsort(?:ed)?\s+(?:by|on)\s+(.+?)(?:\s+(descending|desc|ascending|asc|highest first|lowest first))?(?:\s+(?:and|then)\b|[.,]|$)/i.exec(
      text,
    );
  if (sort && !view.sort) {
    const column = header(sort[1]);
    if (column >= 0)
      view.sort = {
        column,
        direction: /desc|highest/i.test(sort[2] ?? "") ? "desc" : "asc",
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
  if (dup) {
    const column = dup[1] ? header(dup[1]) : 0;
    if (column >= 0) view.highlight = { column, rule: "duplicates" };
  }
  const filter =
    /\b(?:filter|only|where|show only)\s+(?:rows?\s+where\s+)?(.+?)\s*(>=|<=|!=|=|>|<|\bcontains\b)\s*["']?([^"'.,]+?)["']?(?:\s+(?:and|then)\b|[.,]|$)/i.exec(
      text,
    );
  if (filter) {
    const column = header(filter[1]);
    const operator = filter[2].toLowerCase() as NonNullable<
      NonNullable<InstructionSpecs["view"]>["filter"]
    >["operator"];
    const raw = filter[3].trim();
    if (column >= 0 && raw) {
      const asNumber = Number(raw.replace(/,/g, ""));
      view.filter = {
        column,
        operator,
        value:
          operator !== "contains" && raw !== "" && Number.isFinite(asNumber)
            ? asNumber
            : raw,
      };
    }
  }
  if (view.sort || view.filter || view.highlight) {
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
