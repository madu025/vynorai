import {
  CLEAN_OPERATIONS,
  isSafeColumnName,
  type CleanOperation,
  type ComputeOperator,
} from "./transform.js";

type Cell = string | number | boolean | null;

export interface InstructionSpecs {
  clean?: { operations: CleanOperation[] };
  addColumn?: {
    name: string;
    left: number;
    operator: ComputeOperator;
    right: number;
  };
}

export interface InterpretedInstruction {
  actions: Array<"clean" | "add-column">;
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
  instruction: string,
  headers: string[],
): InterpretedInstruction {
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
  return result;
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
