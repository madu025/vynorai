/**
 * The Excel agent loop on the device. The model (DeepSeek through `/v1/m365/excel/agent`) asks for
 * tools; read tools run at once through an `AgentHost` on bounded data with personal data masked;
 * write tools are only staged as `StagedChange`s that the person approves before anything happens.
 * Nothing here touches Office.js: `officeAgentHost.ts` is the Excel host and the headless tests use a
 * fake one. See docs/ARCHITECTURE_DECISIONS.md, "Excel agent".
 */
import { PERSONAL_PATTERNS } from "./analysis.js";

export const AGENT_MAX_TURNS = 12;
export const AGENT_MAX_CHANGES = 8;
export const READ_MAX_ROWS = 50;
export const READ_MAX_CELLS = 500;
export const CALC_MAX_ROWS = 50;
export const CALC_MAX_COLUMNS = 10;
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
    }
  | { kind: "vynor_step"; instruction: string; understood: string };

export interface AgentHost {
  getWorkbook(): Promise<unknown>;
  readRange(
    sheet: string,
    address: string,
    formulas: boolean,
  ): Promise<{ address: string; values: unknown[][]; formulas?: unknown[][] }>;
  /** Evaluates a formula over the real data without leaving anything in the workbook. */
  calculate(formula: string): Promise<unknown>;
  /** Checks a built-in step sentence now; it runs only after approval. */
  checkStep(
    instruction: string,
  ): Promise<{ ok: true; understood: string } | { ok: false; error: string }>;
}

export type AgentModel = (
  messages: AgentMessage[],
) => Promise<{ content: string; tool_calls: ToolCall[] }>;

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
  if (!RANGE.test(text))
    throw new AgentToolError(`"${text}" is not a range like A1:J20.`);
  return text.replace(/\$/g, "");
}

const BLOCKED_FUNCTIONS =
  /\b(WEBSERVICE|RTD|CALL|REGISTER\.ID|EXEC|DDE|IMAGE|HYPERLINK|FOPEN|SQL\.REQUEST)\s*\(/i;

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
  const part = (cell: string) => {
    const match = /^([A-Z]{1,3})(\d+)$/i.exec(cell);
    if (!match) throw new AgentToolError(`"${address}" is not a range.`);
    return { column: columnIndex(match[1]), row: Number(match[2]) };
  };
  const a = part(first);
  const b = part(second);
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
        ...(args.header ? { header: text(args.header).slice(0, 255) } : {}),
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
          return /^[=+\-@]/.test(restored) && !/^-?\d/.test(restored)
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
    case "sort_range":
      if (!String(args.column ?? "").trim())
        throw new AgentToolError("Name the column to sort by.");
      return {
        kind: "sort_range",
        sheet: checkSheetName(text(args.sheet)),
        address: checkRange(args.address),
        column: text(args.column).trim(),
        descending: args.descending === true,
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
      };
    }
    default:
      throw new AgentToolError(`${name} is not a write tool.`);
  }
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
    case "sort_range":
      return `Sort ${at(change.sheet, change.address)} by ${change.column} ${change.descending ? "descending" : "ascending"} (edits the data; undo restores it)`;
    case "format_range":
      return `Format ${at(change.sheet, change.address)}: ${[
        change.numberFormat ? `number format ${change.numberFormat}` : "",
        change.bold !== undefined ? (change.bold ? "bold" : "not bold") : "",
        change.fill ? `fill ${change.fill}` : "",
        change.fontColor ? `font ${change.fontColor}` : "",
        change.autofit ? "autofit" : "",
      ]
        .filter(Boolean)
        .join(", ")}`;
    case "vynor_step":
      return `${change.instruction} (${change.understood})`;
  }
}

/** True when the change edits cells that already hold the person's data (it needs a backup). */
export function editsInPlace(change: StagedChange): boolean {
  return change.kind === "sort_range" || change.kind === "format_range";
}

// --- the loop -------------------------------------------------------------------------------

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
  /** Set when the loop stopped at the turn limit. */
  stoppedAtLimit?: boolean;
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
  maxTurns?: number;
}): Promise<AgentRun> {
  const { host, model, mask } = options;
  const messages: AgentMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: mask.mask(options.request).slice(0, 4000) },
  ];
  const changes: AgentRun["changes"] = [];
  const maxTurns = options.maxTurns ?? AGENT_MAX_TURNS;
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const answer = await model(messages);
    const calls = answer.tool_calls ?? [];
    messages.push({
      role: "assistant",
      content: answer.content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length)
      return {
        messages,
        reply: mask.unmask(answer.content || ""),
        changes,
        turns: turn,
      };
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
        content = JSON.stringify(
          await runTool(call, args, host, mask, changes),
        );
      } catch (error) {
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
  }
  return {
    messages,
    reply: "",
    changes,
    turns: maxTurns,
    stoppedAtLimit: true,
  };
}

async function runTool(
  call: ToolCall,
  args: Record<string, unknown>,
  host: AgentHost,
  mask: PersonalMask,
  changes: AgentRun["changes"],
): Promise<unknown> {
  const restore = (text: string) => mask.unmask(text);
  switch (call.function.name) {
    case "get_workbook":
      return host.getWorkbook();
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
    case "calculate": {
      const formula = checkFormula(restore(String(args.formula ?? "")));
      return { result: boundResult(await host.calculate(formula)) };
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
      changes.push({ callId: call.id, change });
      return {
        staged: changes.length,
        change: describeChange(change),
        note: "Staged. It runs after the person approves; you will then get what was written.",
      };
    }
  }
}

/** What the add-in tells the agent after applying (or the person declining) the changes. */
export function appliedReport(
  results: { change: string; status: "applied" | "failed"; detail?: unknown }[],
): string {
  return `[Report from the add-in, not from the person] The person approved the changes. Results: ${JSON.stringify(results)}. If something failed or shows an error value, stage a fix; otherwise reply with one short summary of what was done.`;
}
