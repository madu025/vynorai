/**
 * What-if analysis behind the agent's `what_if` tool. Office.js has no API for Excel's Data Table
 * or Scenario Manager, so `officeAgentActions.ts` does what Goal Seek does: it sets the input
 * cells, lets Excel recalculate, reads the outputs, and always puts the inputs back. This module
 * checks the arguments and lays the results out as a labelled table of values (a snapshot that
 * does not update by itself; the note says so).
 */
import { AgentToolError, checkCell } from "./agent.js";

export const WHAT_IF_MODES = ["data_table", "scenarios"] as const;
export type WhatIfMode = (typeof WHAT_IF_MODES)[number];

export const WHAT_IF_MAX_VALUES = 50;
export const WHAT_IF_MAX_SECOND = 20;
export const WHAT_IF_MAX_SCENARIOS = 6;
export const WHAT_IF_MAX_OUTPUTS = 5;

export interface Scenario {
  name: string;
  inputs: Record<string, number>;
}

export interface WhatIfArgs {
  mode: WhatIfMode;
  outputs: string[];
  input_cell?: string;
  values?: number[];
  second_input_cell?: string;
  second_values?: number[];
  scenarios?: Scenario[];
}

const numbers = (value: unknown, what: string, max: number): number[] => {
  if (!Array.isArray(value) || !value.length || value.length > max)
    throw new AgentToolError(`${what} needs 1 to ${max} numbers.`);
  return value.map((item) => {
    const number = Number(item);
    if (!Number.isFinite(number))
      throw new AgentToolError(`${what} must hold numbers only.`);
    return number;
  });
};

/** Checks and normalises the what-if part of the arguments. */
export function checkWhatIf(args: Record<string, unknown>): WhatIfArgs {
  const mode = String(args.mode ?? "").trim().toLowerCase() as WhatIfMode;
  if (!WHAT_IF_MODES.includes(mode))
    throw new AgentToolError(`mode must be one of: ${WHAT_IF_MODES.join(", ")}.`);
  if (
    !Array.isArray(args.outputs) ||
    !args.outputs.length ||
    args.outputs.length > WHAT_IF_MAX_OUTPUTS
  )
    throw new AgentToolError(
      `outputs needs 1 to ${WHAT_IF_MAX_OUTPUTS} formula cells.`,
    );
  const outputs = args.outputs.map((cell) => checkCell(cell));
  if (mode === "data_table") {
    const input = checkCell(args.input_cell);
    const values = numbers(args.values, "values", WHAT_IF_MAX_VALUES);
    if (!args.second_input_cell)
      return { mode, outputs, input_cell: input, values };
    if (outputs.length !== 1)
      throw new AgentToolError(
        "A two-input data table shows one output cell.",
      );
    const second = checkCell(args.second_input_cell);
    if (second === input)
      throw new AgentToolError("The two input cells must differ.");
    return {
      mode,
      outputs,
      input_cell: input,
      values: numbers(args.values, "values", WHAT_IF_MAX_SECOND),
      second_input_cell: second,
      second_values: numbers(
        args.second_values,
        "second_values",
        WHAT_IF_MAX_SECOND,
      ),
    };
  }
  if (
    !Array.isArray(args.scenarios) ||
    args.scenarios.length < 2 ||
    args.scenarios.length > WHAT_IF_MAX_SCENARIOS
  )
    throw new AgentToolError(
      `scenarios needs 2 to ${WHAT_IF_MAX_SCENARIOS} named scenarios.`,
    );
  const scenarios = args.scenarios.map((raw: any, index) => {
    const name = String(raw?.name ?? `Scenario ${index + 1}`).slice(0, 60);
    const entries = Object.entries(raw?.inputs ?? {});
    if (!entries.length || entries.length > 10)
      throw new AgentToolError(
        `Scenario "${name}" needs 1 to 10 inputs like {"B1": 120}.`,
      );
    return {
      name,
      inputs: Object.fromEntries(
        entries.map(([cell, value]) => {
          const number = Number(value);
          if (!Number.isFinite(number))
            throw new AgentToolError(`Scenario "${name}": ${cell} needs a number.`);
          return [checkCell(cell), number];
        }),
      ),
    };
  });
  return { mode, outputs, scenarios };
}

/** Every set of input values to try, in table order. */
export function whatIfRuns(args: WhatIfArgs): Record<string, number>[] {
  if (args.mode === "scenarios")
    return args.scenarios!.map((scenario) => scenario.inputs);
  if (!args.second_input_cell)
    return args.values!.map((value) => ({ [args.input_cell!]: value }));
  return args.values!.flatMap((row) =>
    args.second_values!.map((column) => ({
      [args.input_cell!]: row,
      [args.second_input_cell!]: column,
    })),
  );
}

/**
 * The result table as rows of values. `results[i][j]` is output j for run i (whatIfRuns order);
 * `labels` names the outputs (their header text or cell).
 */
export function whatIfTable(
  args: WhatIfArgs,
  results: (number | string)[][],
  labels: string[],
): (string | number)[][] {
  if (args.mode === "scenarios")
    return [
      ["Scenario", ...labels],
      ...args.scenarios!.map((scenario, i) => [scenario.name, ...results[i]]),
    ];
  if (!args.second_input_cell)
    return [
      [args.input_cell!, ...labels],
      ...args.values!.map((value, i) => [value, ...results[i]]),
    ];
  const width = args.second_values!.length;
  return [
    [`${labels[0]} (${args.input_cell} down, ${args.second_input_cell} across)`, ...args.second_values!],
    ...args.values!.map((value, i) => [
      value,
      ...results.slice(i * width, (i + 1) * width).map((row) => row[0]),
    ]),
  ];
}
