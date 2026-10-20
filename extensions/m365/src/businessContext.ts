/**
 * Business meaning the reader can work out locally, without sending cell values anywhere:
 * the currency of money columns, a target named in the request, whether the request is for
 * management or for day-to-day operations, and which column is the business key (transaction,
 * invoice or order number) for duplicate checks. Everything here is pure and deterministic.
 */

type Cell = string | number | boolean | null | undefined;

export interface CurrencyGuess {
  /** ISO code, for example "LKR" or "USD". */
  code: string;
  symbol: string;
  /** Excel number format for totals and averages in this currency. */
  numberFormat: string;
  /** Where the currency was found; the strongest evidence wins. */
  source: "number-format" | "header" | "values" | "request";
  /** Two or more different currencies were found in the money columns; nothing is formatted. */
  mixed?: string[];
  /** The rows themselves are in different currencies, named by this column (for example "Currency"). */
  mixedBy?: string;
}

interface CurrencyInfo {
  code: string;
  symbol: string;
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  LKR: { code: "LKR", symbol: "Rs" },
  INR: { code: "INR", symbol: "₹" },
  USD: { code: "USD", symbol: "$" },
  EUR: { code: "EUR", symbol: "€" },
  GBP: { code: "GBP", symbol: "£" },
  JPY: { code: "JPY", symbol: "¥" },
  AUD: { code: "AUD", symbol: "A$" },
  SGD: { code: "SGD", symbol: "S$" },
  AED: { code: "AED", symbol: "AED" },
};

/** A currency word, code or symbol as written in a header, a format or a cell. */
function currencyOfToken(token: string): CurrencyInfo | undefined {
  const text = token.trim().replace(/\.$/, "").toLowerCase();
  if (!text) return undefined;
  if (/^(lkr|rs|rs\.|රු|rupees?|රුපියල්)$/.test(text)) return CURRENCIES.LKR;
  if (/^(inr|₹)$/.test(text)) return CURRENCIES.INR;
  if (/^(usd|us\$|\$|dollars?)$/.test(text)) return CURRENCIES.USD;
  if (/^(eur|€|euros?)$/.test(text)) return CURRENCIES.EUR;
  if (/^(gbp|£|pounds?)$/.test(text)) return CURRENCIES.GBP;
  if (/^(jpy|¥|yen)$/.test(text)) return CURRENCIES.JPY;
  if (/^(aud|a\$)$/.test(text)) return CURRENCIES.AUD;
  if (/^(sgd|s\$)$/.test(text)) return CURRENCIES.SGD;
  if (/^(aed|dirhams?)$/.test(text)) return CURRENCIES.AED;
  return undefined;
}

/** The currency an Excel number format shows, such as [$LKR] #,##0.00, "Rs "#,##0 or $#,##0. */
export function currencyFromNumberFormat(
  format: unknown,
): CurrencyInfo | undefined {
  const text = String(format ?? "");
  if (!text || /^general$/i.test(text)) return undefined;
  const bracket = /\[\$([^\]-]+)(?:-[^\]]*)?\]/.exec(text);
  if (bracket) {
    const found = currencyOfToken(bracket[1]);
    if (found) return found;
  }
  for (const quoted of text.matchAll(/"([^"]+)"/g)) {
    const found = currencyOfToken(quoted[1]);
    if (found) return found;
  }
  // A bare symbol outside quotes: $#,##0.00 or €#,##0.
  const unquoted = text.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  const symbol = /[$€£₹¥]/.exec(unquoted);
  return symbol ? currencyOfToken(symbol[0]) : undefined;
}

/** The currency a header names: "Amount (LKR)", "Sales Rs", "Price $", "USD Revenue". */
export function currencyFromHeader(header: unknown): CurrencyInfo | undefined {
  const text = String(header ?? "");
  const symbol = /[€£₹¥]|(?:^|[^a-z])\$/i.exec(text);
  if (symbol) return currencyOfToken(symbol[0].replace(/^[^$€£₹¥]/, ""));
  for (const word of text.split(/[^A-Za-z.඀-෿$]+/)) {
    if (!word) continue;
    // Only codes and "Rs" count in a header; a plain word such as "pounds" may be a weight.
    if (/^(lkr|rs\.?|inr|usd|eur|gbp|jpy|aud|sgd|aed|රු)$/i.test(word))
      return currencyOfToken(word);
  }
  return undefined;
}

/** The currency written in text cells such as "Rs. 1,250.00", "LKR 500" or "$12.50". */
export function currencyFromValues(values: Cell[]): CurrencyInfo | undefined {
  const counts = new Map<string, number>();
  let texts = 0;
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    texts += 1;
    const match =
      /^\s*([A-Za-z]{2,3}\.?|[$€£₹¥]|රු\.?)\s*-?[\d,]+(?:\.\d+)?\s*$/.exec(
        value,
      ) ?? /^\s*-?[\d,]+(?:\.\d+)?\s*([A-Za-z]{3}|[$€£₹¥])\s*$/.exec(value);
    const found = match ? currencyOfToken(match[1]) : undefined;
    if (found) counts.set(found.code, (counts.get(found.code) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  // Most of the written amounts must agree, or it is not a currency column.
  return best && best[1] >= Math.max(1, texts * 0.6)
    ? CURRENCIES[best[0]]
    : undefined;
}

/** The currency the request names: "in rupees", "LKR", "රුපියල් වලින්", "in dollars". */
export function currencyFromRequest(text: unknown): CurrencyInfo | undefined {
  const value = String(text ?? "");
  const match =
    /(?:^|[^a-z])(lkr|rs\.?|rupees?|inr|usd|dollars?|eur|euros?|gbp|aud|sgd|aed)(?![a-z])/i.exec(
      value,
    ) ?? /(රුපියල්|රු\.)/.exec(value);
  if (!match) return undefined;
  // "rupees" alone is read as Sri Lankan rupees: the product's market.
  return currencyOfToken(match[1]);
}

const MONEY_HEADER =
  /(amount|amt|sales|revenue|turnover|income|cost|costs|price|profit|expense|expenses|spend|spent|salary|salaries|wage|wages|payment|paid|fee|fees|budget|balance|gross|net|tax|vat|discount|charge|charges|bill|billing|value|earning|earnings|commission|rent|tariff|bonus|allowance|debit|credit|payable|receivable|invoice\s*amount)/i;
const NOT_MONEY_HEADER =
  /\b(qty|quantity|count|pcs|pieces|percent|rate|ratio|score|age|id|no|number|code|year|month)\b|%/i;

/** True when a header reads as money: sales, cost, amount, price, profit, salary... */
export function isMoneyHeader(header: unknown): boolean {
  const text = String(header ?? "");
  if (currencyFromHeader(text)) return true;
  return MONEY_HEADER.test(text) && !NOT_MONEY_HEADER.test(text);
}

const formatFor = (info: CurrencyInfo): string => `"${info.symbol} "#,##0.00`;

/**
 * The currency of the money columns, from the strongest evidence available: the cells' own
 * number format, then the header, then text amounts, then the request. Two different currencies
 * in the money columns give `mixed` and no format, because adding them together would be wrong.
 */
export function inferCurrency(input: {
  headers: string[];
  /** Indexes of the columns that hold amounts (for a dashboard, its value columns). */
  columns: number[];
  /** Number format of the first data row, one per column, when the host gave it. */
  numberFormats?: unknown[];
  /** A few cells of each column, by column index. */
  samples?: Record<number, Cell[]>;
  request?: string;
}): CurrencyGuess | undefined {
  // A "Currency" column with more than one code means the amounts on different rows are in
  // different currencies: a total over all rows mixes them.
  const currencyColumn = input.headers.findIndex((header) =>
    /^\s*(currency|curr|ccy|currency\s*code)\s*$/i.test(String(header ?? "")),
  );
  if (currencyColumn >= 0) {
    const codes = [
      ...new Set(
        (input.samples?.[currencyColumn] ?? [])
          .map((cell) => currencyOfToken(String(cell ?? ""))?.code)
          .filter((code): code is string => Boolean(code)),
      ),
    ].sort();
    if (codes.length > 1)
      return {
        code: codes[0],
        symbol: CURRENCIES[codes[0]].symbol,
        numberFormat: "#,##0.00",
        source: "values",
        mixed: codes,
        mixedBy: String(input.headers[currencyColumn]).trim(),
      };
    if (
      codes.length === 1 &&
      input.columns.some((column) => isMoneyHeader(input.headers[column]))
    ) {
      const info = CURRENCIES[codes[0]];
      return {
        code: info.code,
        symbol: info.symbol,
        numberFormat: formatFor(info),
        source: "values",
      };
    }
  }
  const found: Array<{
    info: CurrencyInfo;
    source: CurrencyGuess["source"];
    format?: string;
  }> = [];
  for (const column of input.columns) {
    const format = input.numberFormats?.[column];
    const fromFormat = currencyFromNumberFormat(format);
    if (fromFormat) {
      found.push({
        info: fromFormat,
        source: "number-format",
        format: String(format),
      });
      continue;
    }
    const fromHeader = currencyFromHeader(input.headers[column]);
    if (fromHeader) {
      found.push({ info: fromHeader, source: "header" });
      continue;
    }
    const fromValues = currencyFromValues(input.samples?.[column] ?? []);
    if (fromValues) found.push({ info: fromValues, source: "values" });
  }
  const codes = [...new Set(found.map((entry) => entry.info.code))];
  if (codes.length > 1) {
    const first = found[0];
    return {
      code: first.info.code,
      symbol: first.info.symbol,
      numberFormat: "#,##0.00",
      source: first.source,
      mixed: codes,
    };
  }
  if (found.length) {
    const first = found[0];
    return {
      code: first.info.code,
      symbol: first.info.symbol,
      // The workbook's own format is kept, so the dashboard looks like the source.
      numberFormat: first.format ?? formatFor(first.info),
      source: first.source,
    };
  }
  const fromRequest = currencyFromRequest(input.request);
  if (
    fromRequest &&
    input.columns.some((column) => isMoneyHeader(input.headers[column]))
  )
    return {
      code: fromRequest.code,
      symbol: fromRequest.symbol,
      numberFormat: formatFor(fromRequest),
      source: "request",
    };
  return undefined;
}

export type Audience = "management" | "operational" | "general";

const MANAGEMENT_WORDS =
  /\b(management|manager|managers|executive|executives|exec|board|ceo|cfo|coo|gm|director|directors|leadership|head\s+office|summary|summari[sz]e|overview|high[- ]level|at\s+a\s+glance|kpis?|monthly\s+review|business\s+review|review\s+meeting|presentation|present|one[- ]page|snapshot|scorecard)\b|කළමනාකරණ|සාරාංශ|ප්‍රධානීන්|ඉදිරිපත්/gi;
const OPERATIONAL_WORDS =
  /\b(operational|operations|ops|daily|day[- ]to[- ]day|team|staff|officers?|follow[- ]?up|track|tracking|monitor|monitoring|detail|detailed|details|drill[- ]?down|line[- ]by[- ]line|each|every|per\s+(?:item|customer|branch|site|job|order)|pending|backlog|action\s+list|work\s*list|to[- ]do)\b|දෛනික|විස්තර|සෑම|කණ්ඩායම/gi;

/**
 * Who the result is for. A management request gets a short one-page view (the biggest
 * categories first, the headline numbers in cards); an operational one keeps every category
 * and the filters people use to work through the list.
 */
export function inferAudience(request: unknown): Audience {
  const text = String(request ?? "");
  const management = text.match(MANAGEMENT_WORDS)?.length ?? 0;
  const operational = text.match(OPERATIONAL_WORDS)?.length ?? 0;
  if (management > operational) return "management";
  if (operational > management) return "operational";
  return "general";
}

export interface BusinessTarget {
  value: number;
  /** The value column the target is for, when the request names one. */
  column?: number;
  /** "target", "budget", "goal" or "quota", as the request said it. */
  label: string;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  m: 1_000_000,
  mn: 1_000_000,
  mil: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

/**
 * A target, budget, goal or quota named in the request: "target 5M", "sales target of
 * Rs 2,500,000", "budget is 1.2 million", "ඉලක්කය 500000". The number is read only when it
 * follows the word closely, so "top 10" or a year is never taken for a target.
 */
export function parseBusinessTarget(
  request: unknown,
  headers: string[] = [],
  valueColumns: number[] = [],
): BusinessTarget | undefined {
  const text = String(request ?? "");
  const match =
    /(target|budget|goal|quota|ඉලක්කය|ඉලක්ක)(?![a-z])([^\d\n.;]{0,30}?)(-?\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|mn|mil|millions?|m|crores?|bn|billion)?(?![a-z\d])/i.exec(
      text,
    );
  if (!match) return undefined;
  const raw = Number(match[3].replace(/,/g, ""));
  const multiplier = match[4] ? (MULTIPLIERS[match[4].toLowerCase()] ?? 1) : 1;
  const value = raw * multiplier;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // A bare four-digit year after "target" ("target for 2026") is not a target value.
  if (
    !match[4] &&
    /^(19|20)\d{2}$/.test(match[3]) &&
    /\bfor\b|\bin\b/i.test(match[2])
  )
    return undefined;
  const label = /budget/i.test(match[1])
    ? "budget"
    : /goal/i.test(match[1])
      ? "goal"
      : /quota/i.test(match[1])
        ? "quota"
        : "target";
  // The value column the sentence names around the target word, if any.
  const around = text
    .slice(Math.max(0, match.index - 40), match.index + match[0].length)
    .toLowerCase();
  const column = valueColumns.find((index) => {
    const name = String(headers[index] ?? "")
      .trim()
      .toLowerCase();
    return name.length > 1 && around.includes(name);
  });
  return { value, label, ...(column !== undefined ? { column } : {}) };
}

export interface BusinessKey {
  /** One column, or a key column plus a line-number column when only both together are unique. */
  columns: number[];
  names: string[];
  confidence: "high" | "medium" | "low";
  /** Why this column was taken as the key, in plain words. */
  reason: string;
  /** Share of filled rows whose key is distinct. */
  distinctShare: number;
  /** Key values that appear on more than one row. */
  duplicateKeys: number;
  /** Rows beyond the first one of each duplicated key. */
  duplicateRows: number;
  blankKeys: number;
}

const KEY_WORD =
  "(?:transaction|txn|trans|invoice|inv|order|receipt|bill|voucher|reference|ref|document|doc|serial|ticket|booking|payment|cheque|journal|entry|grn|po|so|sale|case|claim|request|req|job|work\\s*order|wo|tracking|awb|consignment|shipment|contract|policy|application|registration|reg)";
/** "Invoice No", "Txn ID", "Order #", "Receipt Number", or the record word alone ("Invoice"). */
const STRONG_KEY_HEADER = new RegExp(
  `(?:^|[^a-z])${KEY_WORD}[\\s_#.-]*(?:id|no\\.?|num|number|#|code|ref|key)(?![a-z])|^\\s*${KEY_WORD}s?\\s*$`,
  "i",
);
const GENERIC_KEY_HEADER =
  /(^|[^a-z])(id|uuid|guid|key|no\.?|num|number|code|ref|reference|#)([^a-z]|$)/i;
/** Columns that name who or what a row is about: they repeat on purpose and are not keys. */
const ENTITY_HEADER =
  /(name|phone|mobile|tel|email|e-mail|nic|passport|address|customer|client|cust|account|acct|product|item|sku|material|part|employee|emp|staff|officer|agent|branch|region|area|zone|province|district|store|shop|outlet|vendor|supplier|category|department|dept|division|circuit|site|location|city|country|project|team|route|vehicle|service\s*type|status)/i;
const PERSONAL_KEY_HEADER =
  /(name|phone|mobile|tel\b|email|e-mail|nic|passport|address)/i;
const LINE_HEADER =
  /(^|[^a-z])(line|ln|item|seq|sequence|row|position|pos)[\s_#.-]*(no\.?|num|number|#|id)?([^a-z]|$)/i;

const keyText = (cell: Cell) =>
  cell === null || cell === undefined ? "" : String(cell).trim().toLowerCase();

function duplicatesOf(rows: Cell[][], columns: number[]) {
  const counts = new Map<string, number>();
  let blank = 0;
  for (const row of rows) {
    const parts = columns.map((column) => keyText(row[column]));
    if (parts.some((part) => part === "")) {
      blank += 1;
      continue;
    }
    const key = JSON.stringify(parts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let duplicateKeys = 0;
  let duplicateRows = 0;
  let filled = 0;
  for (const count of counts.values()) {
    filled += count;
    if (count > 1) {
      duplicateKeys += 1;
      duplicateRows += count - 1;
    }
  }
  return {
    distinct: counts.size,
    filled,
    blank,
    duplicateKeys,
    duplicateRows,
    distinctShare: filled ? counts.size / filled : 0,
  };
}

/** Counts of repeated keys for the given key columns (rows beyond the first of each key). */
export function countDuplicateKeys(rows: Cell[][], columns: number[]) {
  const { duplicateKeys, duplicateRows, blank } = duplicatesOf(rows, columns);
  return { duplicateKeys, duplicateRows, blankKeys: blank };
}

/**
 * The column that identifies one business record (a transaction, invoice, order or receipt
 * number), so duplicate checks look at the key instead of whole rows. It is chosen from the
 * header wording and from the values: a key is nearly always filled and nearly always unique.
 * Columns that name a customer, product or branch repeat on purpose and are never taken.
 * Returns undefined when no column is convincing; the caller then keeps whole-row checks.
 */
export function detectBusinessKey(
  headers: string[],
  rows: Cell[][],
): BusinessKey | undefined {
  if (rows.length < 2) return undefined;
  type Candidate = {
    index: number;
    score: number;
    reason: string;
    share: number;
  };
  const candidates: Candidate[] = [];
  headers.forEach((rawHeader, index) => {
    const header = String(rawHeader ?? "").trim();
    const cells = rows.map((row) => row[index]);
    const present = cells.filter((cell) => keyText(cell) !== "");
    if (present.length < 2) return;
    // Amounts, dates and flags are never keys.
    if (present.some((cell) => typeof cell === "boolean")) return;
    if (
      present.some(
        (cell) => typeof cell === "number" && !Number.isInteger(cell),
      )
    )
      return;
    if (/(date|time|day|month|year|period)/i.test(header)) return;
    const strong = STRONG_KEY_HEADER.test(header);
    const generic = GENERIC_KEY_HEADER.test(header);
    const entity = ENTITY_HEADER.test(header);
    // Personal columns are never keys; a customer, product or employee ID is the key of a master
    // list (nearly every value different), but repeats on purpose in a transaction table.
    if (PERSONAL_KEY_HEADER.test(header) && !strong) return;
    const allNumbers = present.every((cell) => typeof cell === "number");
    if (allNumbers && !strong && !generic) return; // plain integer measure such as Qty
    const { distinctShare } = duplicatesOf(rows, [index]);
    if (distinctShare < 0.5) return;
    if (entity && !strong && distinctShare < 0.95) return;
    let score = 0;
    const reasons: string[] = [];
    if (strong) {
      score += 3;
      reasons.push("its name reads as a record number");
    } else if (generic) {
      score += 1;
      reasons.push("its name reads as an ID");
    }
    if (distinctShare >= 0.98) {
      score += 3;
      reasons.push("almost every value is different");
    } else if (distinctShare >= 0.9) {
      score += 2;
      reasons.push("most values are different");
    } else if (distinctShare < 0.7) score -= 1;
    const fill = present.length / cells.length;
    if (fill >= 0.95) score += 1;
    if (index === 0) score += 0.5;
    // Free text (descriptions, names) is unique too but has spaces; codes rarely do.
    const spaced =
      present.filter((cell) => /\s/.test(String(cell).trim())).length /
      present.length;
    if (spaced > 0.5 && !strong) score -= 3;
    candidates.push({
      index,
      score,
      reason: reasons.join(" and "),
      share: distinctShare,
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];
  if (!best || best.score < 3) return undefined;

  let columns = [best.index];
  let reason = best.reason;
  // Invoice No repeats once per invoice line: Invoice No + Line No is the key when that pair is unique.
  if (best.share < 0.9) {
    const line = headers.findIndex(
      (header, index) =>
        index !== best.index && LINE_HEADER.test(String(header)),
    );
    const pairShare =
      line >= 0 ? duplicatesOf(rows, [best.index, line]).distinctShare : 0;
    if (pairShare >= Math.max(0.8, best.share + 0.2)) {
      columns = [best.index, line];
      reason = `${reason}; with ${String(headers[line]).trim()} nearly every line is different`;
    }
  }
  const stats = duplicatesOf(rows, columns);
  const confidence =
    best.score >= 6 ? "high" : best.score >= 4 ? "medium" : "low";
  return {
    columns,
    names: columns.map((index) => String(headers[index] ?? "").trim()),
    confidence,
    reason,
    distinctShare: Math.round(stats.distinctShare * 1000) / 1000,
    duplicateKeys: stats.duplicateKeys,
    duplicateRows: stats.duplicateRows,
    blankKeys: stats.blank,
  };
}

/** One line for a report: which key was used and what repeats. */
export function describeBusinessKey(key: BusinessKey): string {
  const name = key.names.join(" + ");
  if (!key.duplicateKeys)
    return `Business key: ${name} (${key.confidence} confidence, ${key.reason}). No ${name} value is repeated.`;
  return `Business key: ${name} (${key.confidence} confidence, ${key.reason}). ${key.duplicateKeys} ${name} value(s) appear on more than one row (${key.duplicateRows} extra row(s)); check them for double entries.`;
}

const DATE_LIKE_HEADER =
  /(date|time|day|month|year|period|when|opened|closed|joined|posted|counted|created|updated|due|dob|birth)/i;
const SHARE_HEADER = /(%|percent|pct|rate|ratio|score|csat|nps|rating)/i;
const GROUP_HEADER =
  /(region|area|zone|province|district|branch|store|shop|outlet|department|dept|division|category|segment|channel|product|type|status|priority|warehouse|location|city|country|team|cost\s*centre|cost\s*center|account\s*name|supplier|designation|payment|method|rtom|lea)/i;
const PERSONAL_HEADER =
  /(name|phone|mobile|tel|email|e-mail|nic|passport|address|manager|agent|approved\s*by|customer)/i;

const isNumberCell = (cell: Cell) =>
  typeof cell === "number" && Number.isFinite(cell);

/**
 * The columns a dashboard should use when the request names none, the way an analyst would pick
 * them: group by a short business category (Region, Department, Category; never an ID, a date or a
 * person), and add up the money columns first, then other measures (never dates stored as numbers,
 * IDs, or percentages, which do not add up).
 */
export function suggestDashboardColumns(
  headers: string[],
  rows: Cell[][],
): { category?: number; values: number[] } {
  const key = detectBusinessKey(headers, rows);
  const keyColumns = new Set(key?.columns ?? []);
  const categories: Array<{ index: number; score: number }> = [];
  const values: Array<{ index: number; score: number }> = [];
  headers.forEach((rawHeader, index) => {
    const header = String(rawHeader ?? "");
    const present = rows
      .map((row) => row[index])
      .filter((cell) => keyText(cell) !== "");
    if (!present.length || keyColumns.has(index)) return;
    const numeric = present.filter(isNumberCell).length / present.length >= 0.9;
    if (DATE_LIKE_HEADER.test(header)) return;
    if (numeric) {
      if (SHARE_HEADER.test(header) && !isMoneyHeader(header)) return;
      if (/(^|[^a-z])(id|code|no|number|ref)([^a-z]|$)/i.test(header)) return;
      // A unit price or rate does not add up across rows; it is kept only when nothing else is left.
      const perUnit =
        /(unit|per|each|avg|average|rate|price)(?![a-z])/i.test(header) &&
        !/(total|amount|net|gross|sales|revenue)/i.test(header);
      values.push({
        index,
        score: perUnit ? 0.5 : isMoneyHeader(header) ? 3 : 2,
      });
      return;
    }
    if (
      PERSONAL_HEADER.test(header) &&
      !GROUP_HEADER.test(header.replace(PERSONAL_HEADER, ""))
    )
      return;
    const distinct = new Set(present.map(keyText)).size;
    if (distinct < 2 || distinct > 50) return;
    if (distinct / present.length > 0.5) return; // nearly unique: an ID or free text
    let score = GROUP_HEADER.test(header) ? 3 : 0;
    if (distinct >= 3 && distinct <= 15) score += 2;
    else if (distinct <= 30) score += 1;
    categories.push({ index, score });
  });
  categories.sort((a, b) => b.score - a.score || a.index - b.index);
  values.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ...(categories[0] ? { category: categories[0].index } : {}),
    values: (values.some((entry) => entry.score >= 1)
      ? values.filter((entry) => entry.score >= 1)
      : values
    )
      .slice(0, 3)
      .map((entry) => entry.index),
  };
}
