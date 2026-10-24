/**
 * The Excel agent loop on the device. The model (DeepSeek through `/v1/m365/excel/agent`) asks for
 * tools; read tools run at once through an `AgentHost` on bounded data with personal data masked;
 * write tools are only staged as `StagedChange`s that the person approves before anything happens.
 * Nothing here touches Office.js: `officeAgentHost.ts` is the Excel host and the headless tests use a
 * fake one. See docs/ARCHITECTURE_DECISIONS.md, "Excel agent".
 */
import {
  mapRelationships,
  RELATION_MAX_ROWS,
  RELATION_MAX_TABLES,
  type KeyCell,
  type RelationTable,
} from "./relationships.js";
import { PERSONAL_PATTERNS } from "./analysis.js";
import {
  AI_TEXT_FEATURES,
  baseCapabilityContext,
  refuseNativeRequest,
  type AiTextFeature,
  type NativeFeatureRefusal,
} from "./capabilityRegistry.js";
import { guardCombine } from "./combineGuard.js";
import { ACTION_TOOLS, CHART_TYPE_NAMES } from "./agentActions.js";
import { findUnhandledJobs } from "./workflowCheck.js";
import { describeRequestMeaning } from "./businessContext.js";
import {
  RUN_CODE_MAX_AREAS,
  RUN_CODE_PER_REQUEST,
  checkCode,
} from "./codeSandbox.js";
import type { AnalystCell } from "./advancedAnalytics.js";
import {
  ANALYSIS_KINDS,
  ANALYZE_MAX_ROWS,
  type AnalysisKind,
  runColumnAnalysis,
} from "./analyzeColumns.js";

export const AGENT_MAX_TURNS = 12;
export const AGENT_MAX_CHANGES = 25;
export const READ_MAX_ROWS = 50;
export const READ_MAX_CELLS = 500;
export const CALC_MAX_ROWS = 50;
export const CALC_MAX_COLUMNS = 10;
/** calculate calls per request before the agent is told to act or answer. */
export const CALC_PER_REQUEST = 6;
const TOOL_RESULT_CHARS = 12_000;

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type StagedChange =
  | {
      kind: "write_formula";
      sheet: string;
      cell: string;
      formula: string;
      fillRange?: string;
      header?: string;
    }
  | {
      kind: "write_values";
      sheet: string;
      cell: string;
      values: (string | number | boolean | null)[][];
    }
  | { kind: "create_sheet"; name: string }
  | {
      kind: "sort_range";
      sheet: string;
      address: string;
      column: string;
      descending: boolean;
      /** Further sort keys, in order. */
      then?: { column: string; descending: boolean }[];
      /** A custom order for the first key, e.g. "High,Medium,Low". */
      customOrder?: string;
      /** Sort the columns left to right by the values of the first row. */
      byColumns?: boolean;
    }
  | {
      kind: "format_range";
      sheet: string;
      address: string;
      numberFormat?: string;
      bold?: boolean;
      fill?: string;
      fontColor?: string;
      autofit?: boolean;
      fontName?: string;
      fontSize?: number;
      italic?: boolean;
      underline?: boolean;
      borders?: "all" | "outside" | "bottom" | "none";
      horizontal?: "left" | "center" | "right";
      vertical?: "top" | "center" | "bottom";
      wrap?: boolean;
      indent?: number;
      rotation?: number;
      mergeCenter?: boolean;
      style?: string;
      clear?: boolean;
      /** Format painter: copy every format of this range first. */
      copyFrom?: string;
    }
  | {
      kind: "create_chart";
      sheet: string;
      /** Without an address the chart uses the used range of the sheet (e.g. a spilled table). */
      address?: string;
      chartType: ChartKind;
      title?: string;
      /** Cells the chart covers, e.g. E2:L20. */
      position?: string;
    }
  | { kind: "vynor_step"; instruction: string; understood: string }
  | { kind: "excel_action"; tool: string; args: Record<string, unknown> };

export const CHART_KINDS = CHART_TYPE_NAMES;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Several sheets with data: tell the model once to map how they join before it answers across them. */
export function withRelationshipHint(workbook: unknown): unknown {
  const sheets = (workbook as { sheets?: { rows?: number }[] } | null)?.sheets;
  if (
    !Array.isArray(sheets) ||
    sheets.filter((s) => (s.rows ?? 0) > 1).length < 2
  )
    return workbook;
  return {
    ...(workbook as object),
    hint: "This workbook has several sheets with data. If the request needs columns from more than one of them, call map_relationships on those ranges before you calculate or stage.",
  };
}

export interface AgentHost {
  getWorkbook(): Promise<unknown>;
  readRange(
    sheet: string,
    address: string,
    formulas: boolean,
  ): Promise<{ address: string; values: unknown[][]; formulas?: unknown[][] }>;
  /** Evaluates a formula over the real data without leaving anything in the workbook. */
  calculate(formula: string): Promise<unknown>;
  /** Consent-gated, masked and bounded AI text analysis; this is read-only until a write tool is staged. */
  analyzeTextBatch?(input: {
    feature: AiTextFeature;
    texts: string[];
    categories?: string[];
  }): Promise<unknown>;
  /**
   * Runs the agent's JavaScript over every cell of a range on the device, in a sandbox with no
   * network (codeSandbox.ts). Read-only: it returns one JSON value.
   */
  runCode?(input: {
    sheet: string;
    /** One or more blocks over the same rows, side by side (B:B and H:H). */
    areas: string[];
    code: string;
    hasHeaders: boolean;
  }): Promise<unknown>;
  /** Read-only details: names, tables, charts, pivots, hidden, merged, comments, rules, links. */
  getDetails?(what: string, sheet?: string, address?: string): Promise<unknown>;
  /** Checks a built-in step sentence now; it runs only after approval. */
  checkStep(
    instruction: string,
  ): Promise<{ ok: true; understood: string } | { ok: false; error: string }>;
}

export type AgentModel = (
  messages: AgentMessage[],
) => Promise<{ content: string; tool_calls: ToolCall[] }>;

/** The local lifecycle of one agent request. Office.js stays on the device in every phase. */
export type AgentPhase = "planning" | "executing" | "verifying" | "final";

// --- personal data --------------------------------------------------------------------------

/**
 * Masks personal-data shapes with stable tokens ([p1], [p2]...) before anything is sent. The map
 * stays on the device: tool arguments and the agent's reply are restored with it.
 */
export class PersonalMask {
  private forward = new Map<string, string>();
  private back = new Map<string, string>();
  get size(): number {
    return this.forward.size;
  }
  mask(text: string): string {
    let out = String(text);
    for (const pattern of PERSONAL_PATTERNS)
      out = out.replace(new RegExp(pattern.source, "g"), (found) => {
        let token = this.forward.get(found);
        if (!token) {
          token = `[p${this.forward.size + 1}]`;
          this.forward.set(found, token);
          this.back.set(token, found);
        }
        return token;
      });
    return out;
  }
  unmask(text: string): string {
    return String(text).replace(
      /\[p\d+\]/g,
      (token) => this.back.get(token) ?? token,
    );
  }
}

// --- checks ---------------------------------------------------------------------------------

export class AgentToolError extends Error {}

const CELL = /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/i;
const RANGE =
  /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/i;
/** Whole columns such as A:B. */
const COLUMNS = /^\$?[A-Z]{1,3}:\$?[A-Z]{1,3}$/i;
const SHEET_ROWS = 1_048_576;

export function checkSheetName(name: unknown): string {
  const text = String(name ?? "").trim();
  if (
    !text ||
    text.length > 31 ||
    /[[\]:*?/\\]/.test(text) ||
    /^'|'$/.test(text)
  )
    throw new AgentToolError(`"${text}" is not a valid sheet name.`);
  return text;
}
export function checkCell(cell: unknown): string {
  const text = String(cell ?? "")
    .trim()
    .toUpperCase();
  if (!CELL.test(text))
    throw new AgentToolError(`"${text}" is not a cell like K2.`);
  return text.replace(/\$/g, "");
}
export function checkRange(address: unknown): string {
  const text = String(address ?? "")
    .trim()
    .toUpperCase();
  if (!RANGE.test(text) && !COLUMNS.test(text))
    throw new AgentToolError(`"${text}" is not a range like A1:J20.`);
  return text.replace(/\$/g, "");
}

const BLOCKED_FUNCTIONS =
  /\b(WEBSERVICE|RTD|CALL|REGISTER\.ID|EXEC|DDE|IMAGE|HYPERLINK|FOPEN|SQL\.REQUEST|PY)\s*\(/i;

/** A formula the agent may write: no network, no other files, no macros. */
export function checkFormula(formula: unknown): string {
  const text = String(formula ?? "").trim();
  if (!text.startsWith("="))
    throw new AgentToolError("A formula must start with =.");
  if (text.length > 8000)
    throw new AgentToolError("The formula is too long (8000 characters).");
  if (BLOCKED_FUNCTIONS.test(text))
    throw new AgentToolError(
      `${BLOCKED_FUNCTIONS.exec(text)![1].toUpperCase()} is not allowed: no web, links or external calls.`,
    );
  if (/https?:|\\\\|\[[^\]]*\.(?:xl\w*|csv|ods)\]/i.test(text))
    throw new AgentToolError(
      "Links to the web or to other workbooks are not allowed.",
    );
  return text;
}

const HEX = /^#[0-9A-F]{6}$/i;

/** Column letters to a 0-based index and back. */
export function columnIndex(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase())
    value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}
export function columnLetters(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}
export function parseA1(address: string): {
  column: number;
  row: number;
  lastColumn: number;
  lastRow: number;
} {
  const [first, second = first] = address.replace(/\$/g, "").split(":");
  const whole = COLUMNS.test(address.replace(/\$/g, ""));
  const part = (cell: string, last: boolean) => {
    if (whole && /^[A-Z]{1,3}$/i.test(cell))
      return { column: columnIndex(cell), row: last ? SHEET_ROWS : 1 };
    const match = /^([A-Z]{1,3})(\d+)$/i.exec(cell);
    if (!match) throw new AgentToolError(`"${address}" is not a range.`);
    return { column: columnIndex(match[1]), row: Number(match[2]) };
  };
  const a = part(first, false);
  const b = part(second, true);
  return {
    column: Math.min(a.column, b.column),
    row: Math.min(a.row, b.row),
    lastColumn: Math.max(a.column, b.column),
    lastRow: Math.max(a.row, b.row),
  };
}
/** The part of a range a read may return: at most READ_MAX_ROWS rows and READ_MAX_CELLS cells. */
export function clampReadAddress(address: string): {
  address: string;
  clipped: boolean;
} {
  const range = parseA1(address);
  const columns = Math.min(range.lastColumn - range.column + 1, 50);
  const rows = Math.min(
    range.lastRow - range.row + 1,
    READ_MAX_ROWS,
    Math.max(1, Math.floor(READ_MAX_CELLS / columns)),
  );
  const clipped =
    rows < range.lastRow - range.row + 1 ||
    columns < range.lastColumn - range.column + 1;
  return {
    address: `${columnLetters(range.column)}${range.row}:${columnLetters(range.column + columns - 1)}${range.row + rows - 1}`,
    clipped,
  };
}

/** One staged change from a write tool call, checked and with personal data restored. */
export function stageChange(
  name: string,
  args: Record<string, unknown>,
  restore: (text: string) => string,
): StagedChange {
  const text = (value: unknown) => restore(String(value ?? ""));
  switch (name) {
    case "write_formula": {
      const fillRange = args.fill_range
        ? checkRange(args.fill_range)
        : undefined;
      const cell = checkCell(args.cell);
      if (fillRange && parseA1(fillRange).row !== parseA1(cell).row)
        throw new AgentToolError("fill_range must start at `cell`.");
      if (fillRange) {
        const range = parseA1(fillRange);
        const cells =
          (range.lastRow - range.row + 1) *
          (range.lastColumn - range.column + 1);
        if (cells > 1_100_000)
          throw new AgentToolError(
            "fill_range is too large; write one spilled formula instead.",
          );
      }
      return {
        kind: "write_formula",
        sheet: checkSheetName(text(args.sheet)),
        cell,
        formula: checkFormula(text(args.formula)),
        ...(fillRange ? { fillRange } : {}),
        ...(args.header
          ? {
              header: ((value) =>
                /^[=+\-@]/.test(value) ? `'${value}` : value)(
                text(args.header).slice(0, 255),
              ),
            }
          : {}),
      };
    }
    case "write_values": {
      if (!Array.isArray(args.values) || !args.values.every(Array.isArray))
        throw new AgentToolError("values must be rows of cells.");
      const rows = args.values as unknown[][];
      const width = Math.max(...rows.map((row) => row.length));
      if (!rows.length || width < 1)
        throw new AgentToolError("values is empty.");
      if (rows.length * width > 200)
        throw new AgentToolError("At most 200 cells per write.");
      const values = rows.map((row) =>
        Array.from({ length: width }, (_, index) => {
          const value = row[index];
          if (value === undefined || value === null) return null;
          if (typeof value === "number" || typeof value === "boolean")
            return value;
          const restored = text(value);
          // A literal must never become a formula.
          return /^[=+\-@]/.test(restored) && !/^-?\d+(\.\d+)?$/.test(restored)
            ? `'${restored}`
            : restored.slice(0, 32_000);
        }),
      );
      return {
        kind: "write_values",
        sheet: checkSheetName(text(args.sheet)),
        cell: checkCell(args.cell),
        values,
      };
    }
    case "create_sheet":
      return { kind: "create_sheet", name: checkSheetName(text(args.name)) };
    case "create_chart": {
      const chartType = String(
        args.chart_type ?? "column",
      ).toLowerCase() as ChartKind;
      if (!CHART_KINDS.includes(chartType))
        throw new AgentToolError(
          `chart_type must be one of ${CHART_KINDS.join(", ")}.`,
        );
      return {
        kind: "create_chart",
        sheet: checkSheetName(text(args.sheet)),
        ...(args.address ? { address: checkRange(args.address) } : {}),
        chartType,
        ...(args.title ? { title: text(args.title).slice(0, 120) } : {}),
        ...(args.position ? { position: checkRange(args.position) } : {}),
      };
    }
    case "sort_range":
      if (!String(args.column ?? "").trim())
        throw new AgentToolError("Name the column to sort by.");
      return {
        kind: "sort_range",
        sheet: checkSheetName(text(args.sheet)),
        address: checkRange(args.address),
        column: text(args.column).trim(),
        descending: args.descending === true,
        ...(Array.isArray(args.then) && args.then.length
          ? {
              then: args.then.slice(0, 5).map((key: any) => {
                if (!String(key?.column ?? "").trim())
                  throw new AgentToolError("Each `then` key needs column.");
                return {
                  column: text(key.column).trim(),
                  descending: key.descending === true,
                };
              }),
            }
          : {}),
        ...(args.custom_order
          ? { customOrder: text(args.custom_order).slice(0, 255) }
          : {}),
        ...(args.by_columns === true ? { byColumns: true } : {}),
      };
    case "format_range": {
      for (const key of ["fill", "font_color"] as const)
        if (args[key] !== undefined && !HEX.test(String(args[key])))
          throw new AgentToolError(`${key} must be a colour like #FFF2CC.`);
      const numberFormat =
        args.number_format === undefined
          ? undefined
          : String(args.number_format).slice(0, 60);
      if (numberFormat !== undefined && /[\u0000-\u001f]/.test(numberFormat))
        throw new AgentToolError("number_format contains a control character.");
      return {
        kind: "format_range",
        sheet: checkSheetName(text(args.sheet)),
        address: checkRange(args.address),
        ...(numberFormat !== undefined ? { numberFormat } : {}),
        ...(typeof args.bold === "boolean" ? { bold: args.bold } : {}),
        ...(args.fill ? { fill: String(args.fill) } : {}),
        ...(args.font_color ? { fontColor: String(args.font_color) } : {}),
        ...(args.autofit === true ? { autofit: true } : {}),
        ...formatExtras(args, text),
      };
    }
    default: {
      const tool = ACTION_TOOLS[name];
      if (!tool) throw new AgentToolError(`${name} is not a write tool.`);
      return {
        kind: "excel_action",
        tool: name,
        args: tool.check(args, restore),
      };
    }
  }
}

/** The extra format options of format_range. */
function formatExtras(
  args: Record<string, unknown>,
  text: (value: unknown) => string,
) {
  const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    what: string,
  ): T | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const choice = String(value).toLowerCase() as T;
    if (!allowed.includes(choice))
      throw new AgentToolError(`${what} must be one of ${allowed.join(", ")}.`);
    return choice;
  };
  const number = (value: unknown, what: string, min: number, max: number) => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max)
      throw new AgentToolError(`${what} must be from ${min} to ${max}.`);
    return n;
  };
  const fontName = args.font_name
    ? text(args.font_name).slice(0, 60)
    : undefined;
  if (fontName && !/^[A-Za-z0-9 \-]+$/.test(fontName))
    throw new AgentToolError("font_name looks like Calibri.");
  const style = args.style ? text(args.style).slice(0, 60) : undefined;
  const out = {
    fontName,
    fontSize: number(args.font_size, "font_size", 1, 409),
    italic: typeof args.italic === "boolean" ? args.italic : undefined,
    underline: typeof args.underline === "boolean" ? args.underline : undefined,
    borders: pick(
      args.borders,
      ["all", "outside", "bottom", "none"] as const,
      "borders",
    ),
    horizontal: pick(
      args.horizontal,
      ["left", "center", "right"] as const,
      "horizontal",
    ),
    vertical: pick(
      args.vertical,
      ["top", "center", "bottom"] as const,
      "vertical",
    ),
    wrap: typeof args.wrap === "boolean" ? args.wrap : undefined,
    indent: number(args.indent, "indent", 0, 15),
    rotation: number(args.rotation, "rotation", -90, 90),
    mergeCenter: args.merge_center === true ? true : undefined,
    style,
    clear: args.clear === true ? true : undefined,
    copyFrom: args.copy_from ? checkRange(args.copy_from) : undefined,
  };
  return Object.fromEntries(
    Object.entries(out).filter(([, value]) => value !== undefined),
  );
}

/** A plain sentence for the approval list. */
export function describeChange(change: StagedChange): string {
  const at = (sheet: string, address: string) => `'${sheet}'!${address}`;
  switch (change.kind) {
    case "write_formula":
      return `${change.fillRange ? `Fill ${at(change.sheet, change.fillRange)} with` : `Write in ${at(change.sheet, change.cell)}`}: ${change.formula}${change.header ? ` (header "${change.header}")` : ""}`;
    case "write_values":
      return `Write ${change.values.length} x ${change.values[0]?.length ?? 0} values from ${at(change.sheet, change.cell)}`;
    case "create_sheet":
      return `Add a new sheet "${change.name}"`;
    case "create_chart":
      return `Add a ${change.chartType} chart of ${change.address ? `'${change.sheet}'!${change.address}` : `the table on '${change.sheet}'`}${change.title ? ` titled "${change.title}"` : ""}`;
    case "sort_range":
      return `Sort ${at(change.sheet, change.address)} by ${change.column} ${change.descending ? "descending" : "ascending"} (edits the data; undo restores it)`;
    case "format_range":
      return `Format ${at(change.sheet, change.address)}: ${[
        change.numberFormat ? `number format ${change.numberFormat}` : "",
        change.bold !== undefined ? (change.bold ? "bold" : "not bold") : "",
        change.fill ? `fill ${change.fill}` : "",
        change.fontColor ? `font ${change.fontColor}` : "",
        change.autofit ? "autofit" : "",
        change.fontName ? `font ${change.fontName}` : "",
        change.fontSize ? `size ${change.fontSize}` : "",
        change.italic ? "italic" : "",
        change.underline ? "underline" : "",
        change.borders ? `borders ${change.borders}` : "",
        change.horizontal ? `align ${change.horizontal}` : "",
        change.vertical ? `vertical ${change.vertical}` : "",
        change.wrap !== undefined
          ? change.wrap
            ? "wrap text"
            : "no wrap"
          : "",
        change.indent !== undefined ? `indent ${change.indent}` : "",
        change.rotation !== undefined ? `rotate ${change.rotation}°` : "",
        change.mergeCenter ? "merge and centre" : "",
        change.style ? `style ${change.style}` : "",
        change.clear ? "clear formats first" : "",
        change.copyFrom ? `formats copied from ${change.copyFrom}` : "",
      ]
        .filter(Boolean)
        .join(", ")}`;
    case "vynor_step":
      return `${change.instruction} (${change.understood})`;
    case "excel_action":
      return ACTION_TOOLS[change.tool]?.describe(change.args) ?? change.tool;
  }
}

/** True when the change edits cells that already hold the person's data (it needs a backup). */
export function editsInPlace(change: StagedChange): boolean {
  return change.kind === "sort_range" || change.kind === "format_range";
}

// --- the loop -------------------------------------------------------------------------------

export const DETAILS = [
  "names",
  "tables",
  "charts",
  "pivots",
  "hidden",
  "merged",
  "comments",
  "conditional_formats",
  "validation",
  "freeze",
  "autofilter",
  "precedents",
  "dependents",
  "protection",
  "page_setup",
  "formula_check",
  "formula_audit",
];

const clip = (text: string) =>
  text.length > TOOL_RESULT_CHARS
    ? `${text.slice(0, TOOL_RESULT_CHARS)}...(cut)`
    : text;

/** Trims a calculate result to CALC_MAX_ROWS x CALC_MAX_COLUMNS and says how big it really was. */
export function boundResult(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const rows = value.length;
  const columns = Array.isArray(value[0]) ? value[0].length : 1;
  if (rows === 1 && columns === 1)
    return Array.isArray(value[0]) ? value[0][0] : value[0];
  const cut = value
    .slice(0, CALC_MAX_ROWS)
    .map((row) => (Array.isArray(row) ? row.slice(0, CALC_MAX_COLUMNS) : row));
  return rows > CALC_MAX_ROWS || columns > CALC_MAX_COLUMNS
    ? { rows, columns, first: cut }
    : cut;
}

export interface AgentRun {
  messages: AgentMessage[];
  reply: string;
  changes: { callId: string; change: StagedChange }[];
  turns: number;
  phase: AgentPhase;
  /** Set when the loop stopped at the turn limit. */
  stoppedAtLimit?: boolean;
  /** Set when the request needs a native or Python feature: nothing was sent and nothing is staged. */
  unsupported?: NativeFeatureRefusal;
}

/**
 * A plain question ("are there outliers?", "which rows ...?") is answered in the reply: nothing may
 * be staged for it. Any word that asks for a change or a new sheet lifts this.
 */
export function isReadOnlyQuestion(request: string): boolean {
  const text = String(request ?? "").trim();
  if (!text) return false;
  const question =
    /\?\s*$/.test(text) ||
    /^(what|which|who|why|when|where|how (much|many|big|large)|is|are|does|do|did|any|can you tell|tell me)\b/i.test(
      text,
    );
  return (
    question &&
    !/\b(fix|correct|repair|add|create|make|build|put|write|insert|delete|remove|replace|rename|clean|sort|format|highlight|merge|copy|move|change|update|set|apply|sheet|report|pivot|chart|dashboard|sparkline|freeze|protect|hide|unhide|join|combine|bring|reconcile|split|fill|save|export|share|email)\b/i.test(
      text,
    )
  );
}

/**
 * Runs the model until it answers without tool calls. Returns the conversation (to continue later),
 * the reply with personal data restored, and the staged changes (nothing is applied here).
 */
export async function runAgent(options: {
  request: string;
  history?: AgentMessage[];
  host: AgentHost;
  model: AgentModel;
  mask: PersonalMask;
  onTool?: (name: string, args: Record<string, unknown>) => void;
  onPhase?: (phase: AgentPhase) => void;
  maxTurns?: number;
  /** Saved workbook preferences as one line (preferences.ts); added after the request. */
  facts?: string;
}): Promise<AgentRun> {
  const { host, model, mask } = options;
  const readOnlyQuestion = isReadOnlyQuestion(options.request);
  // Power Pivot, Solver, VBA/COM, sparklines and Python are never faked: the person's own request is
  // answered with the closest supported alternative, before any model call.
  if (!options.request.startsWith("[Report from the add-in")) {
    const refusal = refuseNativeRequest(
      options.request,
      baseCapabilityContext(),
    );
    if (refusal)
      return {
        messages: [
          ...(options.history ?? []),
          { role: "user", content: mask.mask(options.request) },
          { role: "assistant", content: refusal.message },
        ],
        reply: refusal.message,
        changes: [],
        turns: 0,
        phase: "final",
        unsupported: refusal,
      };
  }
  // After an apply the add-in's own report comes back as the request; it is not the person's words.
  const fromPerson = !options.request.startsWith("[Report from the add-in");
  // A target or audience read locally from the request goes after it (the prefix stays fixed).
  const meaning = fromPerson
    ? [describeRequestMeaning(options.request), options.facts ?? ""]
        .filter(Boolean)
        .join("\n")
    : "";
  const messages: AgentMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: userContent(mask.mask(options.request), meaning) },
  ];
  const changes: AgentRun["changes"] = [];
  const counts = {
    calculate: 0,
    runCode: 0,
    calculationResults: new Map<string, unknown>(),
  };
  const maxTurns = options.maxTurns ?? AGENT_MAX_TURNS;
  let nudged = false;
  let askedForAnswer = false;
  let repeatedCalculationNudges = 0;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    options.onPhase?.("planning");
    const answer = await model(messages);
    const calls = answer.tool_calls ?? [];
    messages.push({
      role: "assistant",
      content: answer.content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length) {
      // A multi-step request ("clean it, pivot by region and chart it") must not lose a step
      // silently: once per request, name the steps nothing staged covers and let the model go on.
      const missing =
        fromPerson && changes.length
          ? findUnhandledJobs(options.request, coveredKinds(changes))
          : [];
      if (missing.length && !nudged && turn < maxTurns) {
        nudged = true;
        messages.push({
          role: "user",
          content: `[Report from the add-in, not from the person] The request also asks for: ${missing.map((job) => job.label).join(", ")}. Nothing staged covers ${missing.length === 1 ? "it" : "them"}. Stage ${missing.length === 1 ? "it" : "them"} now, or say in the reply why not.`,
        });
        continue;
      }
      // An empty answer would leave the person with nothing: ask once, then say so plainly.
      if (!answer.content?.trim() && !askedForAnswer && turn < maxTurns) {
        askedForAnswer = true;
        messages.push({
          role: "user",
          content:
            "[Report from the add-in, not from the person] Your last answer was empty. Reply to the person now: a short bullet list of what you found or staged, or why you could not.",
        });
        continue;
      }
      options.onPhase?.("final");
      return {
        messages,
        reply:
          plainText(mask.unmask(answer.content || "")).trim() ||
          "I did not answer this time and nothing was changed. Please try again or ask in other words.",
        changes,
        turns: turn,
        phase: "final",
      };
    }
    options.onPhase?.("executing");
    let onlyRepeatedCalculations = calls.length > 0;
    for (const call of calls) {
      let content: string;
      try {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}");
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error();
        } catch {
          throw new AgentToolError("The arguments are not a JSON object.");
        }
        options.onTool?.(call.function.name, args);
        const calculationKey =
          call.function.name === "calculate"
            ? checkFormula(mask.unmask(String(args.formula ?? "")))
            : undefined;
        if (!calculationKey || !counts.calculationResults.has(calculationKey))
          onlyRepeatedCalculations = false;
        content = JSON.stringify(
          await (async () => {
            const before = changes.length;
            const result = await runTool(
              call,
              args,
              host,
              mask,
              changes,
              counts,
            );
            if (readOnlyQuestion && changes.length > before) {
              changes.length = before;
              throw new AgentToolError(
                "This is a question: answer it in your reply from what you read or calculated. Stage nothing unless the person asks for a change, a report or a sheet.",
              );
            }
            return result;
          })(),
        );
      } catch (error) {
        onlyRepeatedCalculations = false;
        content = JSON.stringify({
          error:
            error instanceof AgentToolError
              ? error.message
              : `The tool failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`,
        });
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: clip(mask.mask(content)),
      });
    }
    if (onlyRepeatedCalculations) {
      if (repeatedCalculationNudges < 2 && turn < maxTurns) {
        repeatedCalculationNudges += 1;
        messages.push({
          role: "user",
          content:
            "[Report from the add-in, not from the person] Those exact calculations already ran and their earlier results were returned again. Do not calculate them again. Answer the person's question now from those results.",
        });
      } else {
        options.onPhase?.("final");
        return {
          messages,
          reply:
            plainText(mask.unmask(answer.content || "")).trim() ||
            "I could not finish because the same calculations were requested repeatedly. Nothing was changed.",
          changes,
          turns: turn,
          phase: "final",
        };
      }
    }
    options.onPhase?.("verifying");
  }
  options.onPhase?.("final");
  return {
    messages,
    reply: "",
    changes,
    turns: maxTurns,
    phase: "final",
    stoppedAtLimit: true,
  };
}

/** The backend accepts at most this many characters in one user message. */
const USER_MESSAGE_MAX = 4000;

/** The request, then the add-in's note about it, within the backend's message limit. */
export function userContent(request: string, note: string): string {
  if (!note) return request.slice(0, USER_MESSAGE_MAX);
  return `${request.slice(0, USER_MESSAGE_MAX - note.length - 2)}\n\n${note}`;
}

/** The plan action kinds (workflowCheck.ts vocabulary) that the staged changes cover. */
export function coveredKinds(
  changes: readonly { change: StagedChange }[],
): string[] {
  const kinds = new Set<string>();
  for (const { change } of changes) {
    if (change.kind === "vynor_step")
      for (const kind of change.understood.split(",")) kinds.add(kind.trim());
    else if (change.kind === "write_formula") {
      kinds.add("add-column");
      if (
        /\b(GROUPBY|PIVOTBY|SUMIFS|COUNTIFS|AVERAGEIFS)\(/i.test(change.formula)
      )
        kinds.add("summary");
      if (
        /\b(CORREL|FORECAST\w*|TREND|STDEV\w*|LINEST)\(/i.test(change.formula)
      )
        kinds.add("statistics");
    } else if (change.kind === "create_chart") kinds.add("chart");
    else if (change.kind === "format_range") kinds.add("format");
    else if (change.kind === "sort_range") kinds.add("view");
    else if (change.kind === "excel_action") {
      const covers: Record<string, string[]> = {
        chart_action: ["chart"],
        pivot_action: ["pivot-table", "summary"],
        conditional_format: ["format"],
        clean_in_place: ["clean"],
        filter_range: ["view"],
      };
      for (const kind of covers[change.tool] ?? []) kinds.add(kind);
    }
  }
  return [...kinds];
}

async function runTool(
  call: ToolCall,
  args: Record<string, unknown>,
  host: AgentHost,
  mask: PersonalMask,
  changes: AgentRun["changes"],
  counts: {
    calculate: number;
    runCode: number;
    calculationResults: Map<string, unknown>;
  },
): Promise<unknown> {
  const restore = (text: string) => mask.unmask(text);
  switch (call.function.name) {
    case "get_workbook":
      return withRelationshipHint(await host.getWorkbook());
    case "read_range": {
      const sheet = checkSheetName(restore(String(args.sheet ?? "")));
      const { address, clipped } = clampReadAddress(checkRange(args.address));
      const read = await host.readRange(sheet, address, args.formulas === true);
      return {
        ...read,
        ...(clipped
          ? {
              note: `Only ${address} was read (limit ${READ_MAX_ROWS} rows, ${READ_MAX_CELLS} cells).`,
            }
          : {}),
      };
    }
    case "get_details": {
      if (!host.getDetails)
        throw new AgentToolError("get_details is not available here.");
      const what = String(args.what ?? "")
        .trim()
        .toLowerCase();
      if (!DETAILS.includes(what))
        throw new AgentToolError(`what must be one of ${DETAILS.join(", ")}.`);
      const sheet = args.sheet
        ? checkSheetName(restore(String(args.sheet)))
        : undefined;
      const address = args.address ? checkRange(args.address) : undefined;
      return { [what]: await host.getDetails(what, sheet, address) };
    }
    case "calculate": {
      // Each calculation is a model turn and a full pass over the data: enough is enough.
      const formula = checkFormula(restore(String(args.formula ?? "")));
      const earlier = counts.calculationResults.get(formula);
      if (earlier !== undefined)
        return {
          ...(earlier as Record<string, unknown>),
          note: "This exact calculation already ran. The earlier result was reused; answer from it instead of calculating again.",
        };
      counts.calculate += 1;
      if (counts.calculate > CALC_PER_REQUEST)
        throw new AgentToolError(
          `You already ran ${CALC_PER_REQUEST} calculations for this request. Stage the changes now, or answer with what you have.`,
        );
      const result = boundResult(await host.calculate(formula));
      // The model once read 1090404.455 as 1,090,404,455: give it the grouped text to copy.
      const response =
        typeof result === "number"
          ? {
              result,
              as_text: result.toLocaleString("en-US", {
                maximumFractionDigits: 6,
              }),
            }
          : { result };
      counts.calculationResults.set(formula, response);
      return response;
    }
    case "analyze_columns": {
      // A full pass over up to ANALYZE_MAX_ROWS rows on the device: counted like a calculation.
      counts.calculate += 1;
      if (counts.calculate > CALC_PER_REQUEST)
        throw new AgentToolError(
          `You already ran ${CALC_PER_REQUEST} calculations for this request. Stage the changes now, or answer with what you have.`,
        );
      const kind = String(args.kind ?? "").trim() as AnalysisKind;
      if (!ANALYSIS_KINDS.includes(kind))
        throw new AgentToolError(
          `kind must be one of ${ANALYSIS_KINDS.join(", ")}.`,
        );
      const sheet = checkSheetName(restore(String(args.sheet ?? "")));
      const box = parseA1(checkRange(args.address));
      if (box.lastColumn - box.column >= 30)
        throw new AgentToolError("Analyse at most 30 columns at once.");
      const lastRow = Math.min(box.lastRow, box.row + ANALYZE_MAX_ROWS);
      const address = `${columnLetters(box.column)}${box.row}:${columnLetters(box.lastColumn)}${lastRow}`;
      const read = await host.readRange(sheet, address, false);
      const [headerRow = [], ...rows] = read.values as AnalystCell[][];
      const result = runColumnAnalysis(
        kind,
        headerRow.map((value) => String(value ?? "")),
        rows,
        {
          columns: Array.isArray(args.columns)
            ? args.columns.map((value) => restore(String(value ?? "")))
            : [],
          firstRow: box.row + 1,
          k: typeof args.k === "number" ? args.k : undefined,
        },
      );
      if (lastRow >= box.lastRow) return result;
      const firstColumn = Array.isArray(args.columns)
        ? args.columns[0]
        : undefined;
      // Outliers over every row: one formula calculate can run to get the exact sheet rows.
      const outlierColumn =
        kind === "anomalies"
          ? headerRow.findIndex(
              (header) =>
                String(header ?? "")
                  .trim()
                  .toLowerCase() ===
                restore(String(firstColumn ?? ""))
                  .trim()
                  .toLowerCase(),
            )
          : -1;
      const letter = columnLetters(box.column + outlierColumn);
      return {
        ...result,
        note: `Only the first ${ANALYZE_MAX_ROWS.toLocaleString("en-US")} data rows (${address}) were analysed; use calculate for exact results over every row.`,
        ...(outlierColumn >= 0
          ? {
              exact_formula: `=LET(v,'${sheet.replace(/'/g, "''")}'!${letter}${box.row + 1}:${letter}${box.lastRow},q1,QUARTILE.INC(v,1),q3,QUARTILE.INC(v,3),i,q3-q1,FILTER(HSTACK(ROW(v),v),(v<q1-1.5*i)+(v>q3+1.5*i),"None"))`,
            }
          : {}),
      };
    }
    case "map_relationships": {
      // Reads up to RELATION_MAX_TABLES ranges on the device: counted like a calculation.
      counts.calculate += 1;
      if (counts.calculate > CALC_PER_REQUEST)
        throw new AgentToolError(
          `You already ran ${CALC_PER_REQUEST} calculations for this request. Stage the changes now, or answer with what you have.`,
        );
      if (!Array.isArray(args.ranges))
        throw new AgentToolError(
          'ranges must be a list like ["Orders!A1:F900", "Customers!A1:C40"].',
        );
      if (args.ranges.length < 2 || args.ranges.length > RELATION_MAX_TABLES)
        throw new AgentToolError(
          `Give between 2 and ${RELATION_MAX_TABLES} ranges, each with its header row.`,
        );
      const tables: RelationTable[] = [];
      for (const entry of args.ranges.slice(0, RELATION_MAX_TABLES + 1)) {
        const text = restore(String(entry ?? "")).trim();
        const cut = text.lastIndexOf("!");
        if (cut < 1)
          throw new AgentToolError(`"${text}" must look like Sheet!A1:F900.`);
        const sheet = checkSheetName(
          text
            .slice(0, cut)
            .replace(/^'(.*)'$/, "$1")
            .replace(/''/g, "'"),
        );
        const box = parseA1(checkRange(text.slice(cut + 1)));
        const lastRow = Math.min(box.lastRow, box.row + RELATION_MAX_ROWS);
        const address = `${columnLetters(box.column)}${box.row}:${columnLetters(box.lastColumn)}${lastRow}`;
        const read = await host.readRange(sheet, address, false);
        const [headerRow = [], ...rows] = read.values as KeyCell[][];
        tables.push({
          label: `${sheet}!${address}`,
          headers: headerRow.map((value) => String(value ?? "")),
          rows,
        });
      }
      return mapRelationships(tables);
    }
    case "run_code": {
      if (!host.runCode)
        throw new AgentToolError("run_code is not available here.");
      counts.runCode += 1;
      if (counts.runCode > RUN_CODE_PER_REQUEST)
        throw new AgentToolError(
          `You already ran code ${RUN_CODE_PER_REQUEST} times for this request. Stage the changes now, or answer with what you have.`,
        );
      const sheet = checkSheetName(restore(String(args.sheet ?? "")));
      const areas = String(args.address ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(checkRange);
      if (!areas.length) throw new AgentToolError("Give the range to read.");
      if (areas.length > RUN_CODE_MAX_AREAS)
        throw new AgentToolError(
          `Give at most ${RUN_CODE_MAX_AREAS} ranges, separated by commas.`,
        );
      let code: string;
      try {
        // Masked tokens ([p1]) in the code are the real values on the device.
        code = checkCode(restore(String(args.code ?? "")));
      } catch (error) {
        throw new AgentToolError((error as Error).message);
      }
      return host.runCode({
        sheet,
        areas,
        code,
        hasHeaders: args.has_headers !== false,
      });
    }
    case "analyze_text_batch": {
      if (!host.analyzeTextBatch)
        throw new AgentToolError(
          "Text analysis is not available in this host.",
        );
      const feature = String(args.feature ?? "") as AiTextFeature;
      if (!(AI_TEXT_FEATURES as readonly string[]).includes(feature))
        throw new AgentToolError(
          "feature must be sentiment, keywords or classification.",
        );
      if (
        !Array.isArray(args.texts) ||
        args.texts.length < 1 ||
        args.texts.length > 100
      )
        throw new AgentToolError("texts must contain 1 to 100 items.");
      const texts = args.texts.map((value) =>
        mask.mask(restore(String(value ?? "")).slice(0, 1000)),
      );
      const categories = Array.isArray(args.categories)
        ? args.categories
            .map((value) => restore(String(value ?? "")).slice(0, 60))
            .filter(Boolean)
            .slice(0, 20)
        : undefined;
      return host.analyzeTextBatch({
        feature,
        texts,
        ...(categories?.length ? { categories } : {}),
      });
    }
    case "vynor_step": {
      if (changes.length >= AGENT_MAX_CHANGES)
        throw new AgentToolError(
          `At most ${AGENT_MAX_CHANGES} changes per request.`,
        );
      const instruction = restore(String(args.instruction ?? ""))
        .trim()
        .slice(0, 400);
      if (!instruction)
        throw new AgentToolError("Give the step as one sentence.");
      const checked = await host.checkStep(instruction);
      if (!checked.ok)
        throw new AgentToolError(
          `Not understood: ${checked.error} Rephrase it in one of the sentence forms, or use the other tools.`,
        );
      changes.push({
        callId: call.id,
        change: {
          kind: "vynor_step",
          instruction,
          understood: checked.understood,
        },
      });
      return { staged: changes.length, understood: checked.understood };
    }
    default: {
      if (changes.length >= AGENT_MAX_CHANGES)
        throw new AgentToolError(
          `At most ${AGENT_MAX_CHANGES} changes per request.`,
        );
      const change = stageChange(call.function.name, args, restore);
      if (change.kind === "excel_action" && change.tool === "combine_tables")
        await guardCombine(change.args, host, clampReadAddress);
      changes.push({ callId: call.id, change });
      return {
        staged: changes.length,
        change: describeChange(change),
        note: "Staged. It runs after the person approves; you will then get what was written.",
      };
    }
  }
}

export type AnswerSource =
  | { kind: "range"; sheet: string; address: string; note?: string }
  | { kind: "formula"; text: string }
  | { kind: "check"; text: string };

/**
 * Where an answer came from, taken from the tool calls themselves (not from the model's words):
 * ranges read or analysed, formulas Excel computed and workbook checks, first use first, no
 * repeats, at most 10. `restore` puts personal data back for the person's own view.
 */
export function answerSources(
  messages: AgentMessage[],
  restore: (text: string) => string,
): AnswerSource[] {
  const sources: AnswerSource[] = [];
  const seen = new Set<string>();
  const add = (source: AnswerSource) => {
    const key = JSON.stringify(source);
    if (!seen.has(key) && sources.length < 10) {
      seen.add(key);
      sources.push(source);
    }
  };
  for (const message of messages)
    for (const call of (message.role === "assistant" && message.tool_calls) ||
      []) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        continue;
      }
      const sheet = restore(String(args.sheet ?? ""));
      switch (call.function.name) {
        case "read_range":
          add({ kind: "range", sheet, address: String(args.address ?? "") });
          break;
        case "analyze_columns":
          add({
            kind: "range",
            sheet,
            address: String(args.address ?? ""),
            note: String(args.kind ?? ""),
          });
          break;
        case "map_relationships":
          for (const range of Array.isArray(args.ranges) ? args.ranges : []) {
            const text = restore(String(range ?? ""));
            const cut = text.lastIndexOf("!");
            if (cut > 0)
              add({
                kind: "range",
                sheet: text.slice(0, cut).replace(/^'(.*)'$/, "$1"),
                address: text.slice(cut + 1),
                note: "relationships",
              });
          }
          break;
        case "calculate":
          add({ kind: "formula", text: restore(String(args.formula ?? "")) });
          break;
        case "get_details":
          if (/^formula_(check|audit)$/.test(String(args.what)))
            add({ kind: "check", text: String(args.what) });
          break;
      }
    }
  return sources;
}

/** The pane shows plain text: markdown marks (bold, code, headings) are removed. */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ");
}

/** What the add-in tells the agent after applying (or the person declining) the changes. */
export function appliedReport(
  results: { change: string; status: "applied" | "failed"; detail?: unknown }[],
): string {
  return `[Report from the add-in, not from the person] The person approved the changes. Results: ${JSON.stringify(results)}. If something failed or shows an error value, stage a fix; otherwise reply with one short summary of what was done.`;
}
