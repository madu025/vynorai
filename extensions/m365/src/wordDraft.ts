/**
 * Structured drafting and mail merge for Word.
 *
 * Everything in this file is deterministic and has no Office dependency except `insertOps` and
 * `removeInserted`, which are thin. A model never produces Word operations: it produces a strict
 * JSON draft that `validateDraft` re-checks here, and `draftToOps` turns that draft into a fixed
 * vocabulary of styles. Nothing is replaced in the document: content is only added at the end,
 * inside one tagged content control so it can be removed again as a unit.
 */

export const DRAFT_KINDS = [
  "report",
  "memo",
  "letter",
  "proposal",
  "minutes",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const MAX_BRIEF_CHARS = 4000;
export const MAX_MERGE_ROWS = 50;
export const MAX_MERGE_COLUMNS = 20;
export const MAX_MERGE_CELL = 500;
export const MAX_TEMPLATE_CHARS = 8000;
export const DRAFT_TAG_PREFIX = "vynorai-draft-";

export interface DraftRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export type DraftBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; runs: DraftRun[] }
  | { type: "bullets"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "table"; caption?: string; headers: string[]; rows: string[][] }
  | { type: "callout"; label: string; text: string };

export interface DocumentDraft {
  title: string;
  subtitle?: string;
  memo?: { to: string; from: string; date: string; subject: string };
  blocks: DraftBlock[];
}

export class DraftConsentError extends Error {
  readonly code = "AI_CONSENT_REQUIRED";
  constructor() {
    super("AI_CONSENT_REQUIRED");
  }
}

export interface DraftRequestInput {
  kind: DraftKind;
  title: string;
  brief: string;
  audience?: string;
  tone?: "formal" | "friendly" | "concise";
  length: "short" | "standard" | "detailed";
  language: "auto" | "en" | "si" | "ta";
  includeTable?: boolean;
  memo?: { to: string; from: string; subject: string };
  consent: boolean;
}

/** The only way to build a draft request: consent and limits are checked before anything is sent. */
export function buildDraftRequest(input: DraftRequestInput) {
  if (input.consent !== true) throw new DraftConsentError();
  const title = input.title.trim();
  const brief = input.brief.replace(/\r\n/g, "\n").trim();
  if (!title) throw new Error("Give the document a title.");
  if (!brief) throw new Error("Write a short brief first.");
  if (brief.length > MAX_BRIEF_CHARS)
    throw new Error(`The brief is limited to ${MAX_BRIEF_CHARS} characters.`);
  if (!DRAFT_KINDS.includes(input.kind))
    throw new Error("Choose a document type.");
  const memo =
    input.kind === "memo"
      ? {
          to: (input.memo?.to ?? "").trim(),
          from: (input.memo?.from ?? "").trim(),
          subject: (input.memo?.subject ?? "").trim(),
        }
      : undefined;
  if (memo && (!memo.to || !memo.from || !memo.subject))
    throw new Error("A memo needs To, From and Subject.");
  return {
    kind: input.kind,
    title,
    brief,
    ...(input.audience?.trim() ? { audience: input.audience.trim() } : {}),
    ...(input.tone ? { tone: input.tone } : {}),
    length: input.length,
    language: input.language,
    ...(input.includeTable ? { includeTable: true } : {}),
    ...(memo ? { memo } : {}),
    consent: true as const,
  };
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const MARKUP = /https?:\/\/|<\/?[a-z][^>]*>/i;

function fail(): never {
  throw new Error("AI_DRAFT_INVALID");
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string") return fail();
  if ((!allowEmpty && value.length === 0) || value.length > max) return fail();
  if (CONTROL.test(value) || MARKUP.test(value)) return fail();
  return value;
}
function only(record: Record<string, unknown>, keys: string[]) {
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail();
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}
function list(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    return fail();
  return value;
}

/** Re-checks the server answer. Anything outside the vocabulary is rejected, never repaired. */
export function validateDraft(value: unknown): DocumentDraft {
  const root = object(value);
  only(root, ["title", "subtitle", "memo", "blocks"]);
  const draft: DocumentDraft = {
    title: text(root.title, 200),
    blocks: [],
  };
  if (root.subtitle !== undefined) draft.subtitle = text(root.subtitle, 200);
  if (root.memo !== undefined) {
    const memo = object(root.memo);
    only(memo, ["to", "from", "date", "subject"]);
    draft.memo = {
      to: text(memo.to, 200),
      from: text(memo.from, 200),
      date: text(memo.date, 60),
      subject: text(memo.subject, 200),
    };
  }
  let total = draft.title.length + (draft.subtitle?.length ?? 0);
  for (const raw of list(root.blocks, 1, 60)) {
    const block = object(raw);
    switch (block.type) {
      case "heading": {
        only(block, ["type", "level", "text"]);
        if (block.level !== 1 && block.level !== 2 && block.level !== 3) fail();
        const heading = {
          type: "heading" as const,
          level: block.level as 1 | 2 | 3,
          text: text(block.text, 200),
        };
        total += heading.text.length;
        draft.blocks.push(heading);
        break;
      }
      case "paragraph": {
        only(block, ["type", "runs"]);
        const runs = list(block.runs, 1, 12).map((entry): DraftRun => {
          const run = object(entry);
          only(run, ["text", "bold", "italic"]);
          for (const flag of ["bold", "italic"])
            if (run[flag] !== undefined && typeof run[flag] !== "boolean")
              fail();
          return {
            text: text(run.text, 1500),
            ...(run.bold === undefined ? {} : { bold: run.bold as boolean }),
            ...(run.italic === undefined
              ? {}
              : { italic: run.italic as boolean }),
          };
        });
        total += runs.reduce((sum, run) => sum + run.text.length, 0);
        draft.blocks.push({ type: "paragraph", runs });
        break;
      }
      case "bullets":
      case "numbered": {
        only(block, ["type", "items"]);
        const items = list(block.items, 1, 15).map((item) => text(item, 400));
        total += items.reduce((sum, item) => sum + item.length, 0);
        draft.blocks.push({ type: block.type, items });
        break;
      }
      case "table": {
        only(block, ["type", "caption", "headers", "rows"]);
        const headers = list(block.headers, 1, 8).map((item) => text(item, 60));
        const rows = list(block.rows, 1, 30).map((row) => {
          const cells = list(row, 1, 8).map((cell) => text(cell, 200, true));
          if (cells.length !== headers.length) fail();
          return cells;
        });
        const table: DraftBlock = { type: "table", headers, rows };
        if (block.caption !== undefined)
          table.caption = text(block.caption, 150);
        total +=
          headers.join("").length +
          rows.reduce((sum, row) => sum + row.join("").length, 0);
        draft.blocks.push(table);
        break;
      }
      case "callout": {
        only(block, ["type", "label", "text"]);
        const callout = {
          type: "callout" as const,
          label: text(block.label, 40),
          text: text(block.text, 600),
        };
        total += callout.label.length + callout.text.length;
        draft.blocks.push(callout);
        break;
      }
      default:
        return fail();
    }
  }
  if (total > 24_000) fail();
  return draft;
}

/** Fixed vocabulary of Word operations. The Word runtime maps each one to a built-in style. */
export type WordOp =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; runs: DraftRun[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; caption?: string; values: string[][] }
  | { kind: "callout"; label: string; text: string }
  | { kind: "memo-line"; label: string; value: string }
  | { kind: "rule" }
  | { kind: "page-break" };

export function formatDraftDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function draftToOps(draft: DocumentDraft, today: Date): WordOp[] {
  const ops: WordOp[] = [];
  if (draft.memo) {
    ops.push({ kind: "title", text: "MEMORANDUM" });
    ops.push({ kind: "memo-line", label: "TO", value: draft.memo.to });
    ops.push({ kind: "memo-line", label: "FROM", value: draft.memo.from });
    ops.push({
      kind: "memo-line",
      label: "DATE",
      value: formatDraftDate(today),
    });
    ops.push({
      kind: "memo-line",
      label: "SUBJECT",
      value: draft.memo.subject,
    });
    ops.push({ kind: "rule" });
  } else {
    ops.push({ kind: "title", text: draft.title });
    if (draft.subtitle) ops.push({ kind: "subtitle", text: draft.subtitle });
  }
  for (const block of draft.blocks) {
    if (block.type === "heading")
      ops.push({ kind: "heading", level: block.level, text: block.text });
    else if (block.type === "paragraph")
      ops.push({ kind: "paragraph", runs: block.runs });
    else if (block.type === "bullets" || block.type === "numbered")
      ops.push({
        kind: "list",
        ordered: block.type === "numbered",
        items: block.items,
      });
    else if (block.type === "table")
      ops.push({
        kind: "table",
        ...(block.caption ? { caption: block.caption } : {}),
        values: [block.headers, ...block.rows],
      });
    else ops.push({ kind: "callout", label: block.label, text: block.text });
  }
  return ops;
}

/** Plain-text outline shown in the pane before anything is inserted. */
export function describeOps(ops: WordOp[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.kind === "title") lines.push(op.text.toUpperCase());
    else if (op.kind === "subtitle") lines.push(op.text);
    else if (op.kind === "heading")
      lines.push(`${"#".repeat(op.level)} ${op.text}`);
    else if (op.kind === "paragraph")
      lines.push(
        op.runs
          .map((run) => (run.bold ? `**${run.text}**` : run.text))
          .join(""),
      );
    else if (op.kind === "list")
      op.items.forEach((item, index) =>
        lines.push(op.ordered ? `${index + 1}. ${item}` : `• ${item}`),
      );
    else if (op.kind === "table") {
      if (op.caption) lines.push(op.caption);
      op.values.forEach((row, index) => {
        lines.push(`| ${row.join(" | ")} |`);
        if (index === 0) lines.push(`| ${row.map(() => "---").join(" | ")} |`);
      });
    } else if (op.kind === "callout") lines.push(`> ${op.label}: ${op.text}`);
    else if (op.kind === "memo-line") lines.push(`${op.label}: ${op.value}`);
    else if (op.kind === "rule") lines.push("────────");
    else lines.push("[page break]");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Mail merge: local, deterministic, nothing is sent anywhere.

export interface MergeTable {
  headers: string[];
  rows: string[][];
}

/** Parses pasted spreadsheet cells (TSV), CSV or semicolon separated text, with quoted cells. */
export function parseDelimited(input: string): MergeTable {
  const source = input.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
  if (!source.trim()) throw new Error("Paste the data first.");
  const firstLine = source.split("\n", 1)[0];
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header))
    throw new Error("Every column needs a header in the first row.");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length)
    throw new Error("Column headers must be unique.");
  if (headers.length > MAX_MERGE_COLUMNS)
    throw new Error(`At most ${MAX_MERGE_COLUMNS} columns are supported.`);
  const body = rows
    .slice(1)
    .filter((cells) => cells.some((value) => value.trim() !== ""));
  if (body.length === 0) throw new Error("There are no data rows.");
  if (body.length > MAX_MERGE_ROWS)
    throw new Error(`At most ${MAX_MERGE_ROWS} letters at a time.`);
  const normalized = body.map((cells) => {
    if (cells.length > headers.length)
      throw new Error("A row has more cells than there are headers.");
    return headers.map((_, column) => {
      const value = (cells[column] ?? "").trim();
      if (value.length > MAX_MERGE_CELL)
        throw new Error(`A cell is longer than ${MAX_MERGE_CELL} characters.`);
      if (CONTROL.test(value))
        throw new Error("A cell has control characters.");
      return value;
    });
  });
  return { headers, rows: normalized };
}

const FIELD = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g;

export function templateFields(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(FIELD))
    if (!names.some((name) => name.toLowerCase() === match[1].toLowerCase()))
      names.push(match[1]);
  return names;
}

export interface MergePlan {
  letters: string[];
  fields: string[];
  missingFields: string[];
  unusedColumns: string[];
  emptyValues: number;
}

/** One letter per row. Placeholders without a column are reported and block the insert. */
export function planMerge(template: string, table: MergeTable): MergePlan {
  const cleaned = template.replace(/\r\n/g, "\n").trim();
  if (!cleaned) throw new Error("Write or read the letter template first.");
  if (cleaned.length > MAX_TEMPLATE_CHARS)
    throw new Error(
      `The template is limited to ${MAX_TEMPLATE_CHARS} characters.`,
    );
  const fields = templateFields(cleaned);
  if (fields.length === 0)
    throw new Error("The template has no {{Field}} placeholders.");
  const index = new Map(
    table.headers.map((header, column) => [header.toLowerCase(), column]),
  );
  const missingFields = fields.filter(
    (field) => !index.has(field.toLowerCase()),
  );
  const used = new Set(fields.map((field) => field.toLowerCase()));
  const unusedColumns = table.headers.filter(
    (header) => !used.has(header.toLowerCase()),
  );
  let emptyValues = 0;
  const letters = table.rows.map((row) =>
    cleaned.replace(FIELD, (_whole, name: string) => {
      const column = index.get(String(name).toLowerCase());
      if (column === undefined) return `{{${name}}}`;
      const value = row[column] ?? "";
      if (value === "") emptyValues += 1;
      return value;
    }),
  );
  return { letters, fields, missingFields, unusedColumns, emptyValues };
}

/** Letters become paragraphs separated by one page break each. */
export function lettersToOps(letters: string[]): WordOp[] {
  const ops: WordOp[] = [];
  letters.forEach((letter, index) => {
    if (index > 0) ops.push({ kind: "page-break" });
    for (const paragraph of letter.split(/\n{1,}/))
      if (paragraph.trim())
        ops.push({ kind: "paragraph", runs: [{ text: paragraph }] });
  });
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Word runtime (thin; exercised in the real host).

export interface WordRuntimeLike {
  run<T>(callback: (context: any) => Promise<T>): Promise<T>;
}

export interface InsertReport {
  tag: string;
  title: string;
  operations: number;
}

export async function insertOps(
  runtime: WordRuntimeLike,
  ops: WordOp[],
  options: { tag: string; title: string; confirmed: boolean },
): Promise<InsertReport> {
  if (!options.confirmed)
    throw new Error("Explicit confirmation is required before inserting");
  if (!/^vynorai-draft-[a-z0-9-]{4,40}$/.test(options.tag))
    throw new Error("Invalid draft tag");
  if (ops.length === 0) throw new Error("Nothing to insert");
  return runtime.run(async (context: any) => {
    const body = context.document.body;
    let first: any;
    let last: any;
    const remember = (item: any) => {
      if (!first) first = item;
      last = item;
    };
    const paragraph = (styleName: string, value = "") => {
      const item = body.insertParagraph(value, "End");
      item.styleBuiltIn = styleName;
      return item;
    };
    for (const op of ops) {
      if (op.kind === "title") remember(paragraph("Title", op.text));
      else if (op.kind === "subtitle") remember(paragraph("Subtitle", op.text));
      else if (op.kind === "heading")
        remember(paragraph(`Heading${op.level}`, op.text));
      else if (op.kind === "paragraph") {
        const item = paragraph("Normal");
        for (const run of op.runs) {
          const piece = item.insertText(run.text, "End");
          piece.font.bold = run.bold === true;
          piece.font.italic = run.italic === true;
        }
        remember(item);
      } else if (op.kind === "list") {
        for (const entry of op.items)
          remember(paragraph(op.ordered ? "ListNumber" : "ListBullet", entry));
      } else if (op.kind === "callout") {
        const item = paragraph("IntenseQuote");
        const label = item.insertText(`${op.label}: `, "End");
        label.font.bold = true;
        item.insertText(op.text, "End").font.bold = false;
        remember(item);
      } else if (op.kind === "memo-line") {
        const item = paragraph("Normal");
        const label = item.insertText(`${op.label}:\t`, "End");
        label.font.bold = true;
        item.insertText(op.value, "End").font.bold = false;
        remember(item);
      } else if (op.kind === "rule") {
        remember(paragraph("Normal", "_".repeat(48)));
      } else if (op.kind === "page-break") {
        const item = paragraph("Normal");
        item.insertBreak("Page", "After");
        remember(item);
      } else if (op.kind === "table") {
        if (op.caption) {
          const caption = paragraph("Normal", op.caption);
          caption.font.italic = true;
          remember(caption);
        }
        const table = body.insertTable(
          op.values.length,
          op.values[0].length,
          "End",
          op.values,
        );
        table.headerRowCount = 1;
        table.styleBuiltIn = "GridTable4_Accent1";
        table.styleFirstColumn = false;
        table.styleBandedRows = true;
        remember(table);
      }
    }
    await context.sync();
    const range = first.getRange("Whole").expandTo(last.getRange("Whole"));
    const control = range.insertContentControl("RichText");
    control.tag = options.tag;
    control.title = options.title.slice(0, 60);
    control.appearance = "BoundingBox";
    await context.sync();
    return { tag: options.tag, title: options.title, operations: ops.length };
  });
}

export interface RemoveReport {
  removed: number;
  tags: string[];
}

/** Removes the newest block this add-in inserted. Controls are found again by tag, so it works after a reload. */
export async function removeLastInserted(
  runtime: WordRuntimeLike,
  confirmed: boolean,
): Promise<RemoveReport> {
  if (!confirmed)
    throw new Error("Explicit confirmation is required before removing");
  return runtime.run(async (context: any) => {
    const controls = context.document.contentControls;
    controls.load("items/tag,items/title");
    await context.sync();
    const mine = controls.items.filter((item: any) =>
      String(item.tag ?? "").startsWith(DRAFT_TAG_PREFIX),
    );
    if (mine.length === 0) return { removed: 0, tags: [] };
    mine.sort((a: any, b: any) => String(a.tag).localeCompare(String(b.tag)));
    const newest = mine[mine.length - 1];
    const tag = String(newest.tag);
    newest.delete(false);
    await context.sync();
    return { removed: 1, tags: [tag] };
  });
}

export function newDraftTag(now = Date.now()): string {
  // Sortable by time so "newest" is the lexicographic maximum.
  return `${DRAFT_TAG_PREFIX}${now.toString(36).padStart(9, "0")}`;
}
