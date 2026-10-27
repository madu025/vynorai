/**
 * What-if analysis behind the agent's `what_if` tool. Office.js has no API for Excel's Data Table
 * or Scenario Manager, so `officeAgentActions.ts` does what Goal Seek does: it sets the input
 * cells, lets Excel recalculate, reads the outputs, and always puts the inputs back. This module
 * checks the arguments and lays the results out as a labelled table of values (a snapshot that
 * does not update by itself; the note says so).
 */
import { AgentToolError, checkCell } from "./agent.js";

export const WHAT_IF_MODES = [
  "data_table",
  "scenarios",
  "optimisation",
] as const;
export type WhatIfMode = (typeof WHAT_IF_MODES)[number];

export const WHAT_IF_MAX_VALUES = 50;
export const WHAT_IF_MAX_SECOND = 20;
export const WHAT_IF_MAX_SCENARIOS = 6;
export const WHAT_IF_MAX_OUTPUTS = 5;
export const OPTIMISATION_MAX_VARIABLES = 2;
export const OPTIMISATION_MAX_RUNS = 400;
export const OPTIMISATION_MAX_CONSTRAINTS = 6;

export interface Scenario {
  name: string;
  inputs: Record<string, number>;
}

export interface OptimisationVariable {
  cell: string;
  min: number;
  max: number;
  step: number;
}

export interface OptimisationConstraint {
  cell: string;
  operator: ">=" | "<=" | "=" | ">" | "<";
  value: number;
}

export interface WhatIfArgs {
  mode: WhatIfMode;
  outputs: string[];
  input_cell?: string;
  values?: number[];
  second_input_cell?: string;
  second_values?: number[];
  scenarios?: Scenario[];
  direction?: "maximize" | "minimize";
  variables?: OptimisationVariable[];
  constraints?: OptimisationConstraint[];
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
  const mode = String(args.mode ?? "")
    .trim()
    .toLowerCase() as WhatIfMode;
  if (!WHAT_IF_MODES.includes(mode))
    throw new AgentToolError(
      `mode must be one of: ${WHAT_IF_MODES.join(", ")}.`,
    );
  if (
    !Array.isArray(args.outputs) ||
    !args.outputs.length ||
    args.outputs.length > WHAT_IF_MAX_OUTPUTS
  )
    throw new AgentToolError(
      `outputs needs 1 to ${WHAT_IF_MAX_OUTPUTS} formula cells.`,
    );
  const outputs = args.outputs.map((cell) => checkCell(cell));
  if (mode === "optimisation") {
    if (outputs.length !== 1)
      throw new AgentToolError(
        "optimisation needs exactly one objective formula cell.",
      );
    const direction = String(args.direction ?? "")
      .trim()
      .toLowerCase();
    if (direction !== "maximize" && direction !== "minimize")
      throw new AgentToolError(
        "optimisation direction must be maximize or minimize.",
      );
    if (
      !Array.isArray(args.variables) ||
      args.variables.length < 1 ||
      args.variables.length > OPTIMISATION_MAX_VARIABLES
    )
      throw new AgentToolError(
        `optimisation needs 1 to ${OPTIMISATION_MAX_VARIABLES} bounded variables.`,
      );
    const variables = args.variables.map((raw: any, index) => {
      const cell = checkCell(raw?.cell);
      const min = Number(raw?.min);
      const max = Number(raw?.max);
      const step = Number(raw?.step);
      if (![min, max, step].every(Number.isFinite) || min > max || step <= 0)
        throw new AgentToolError(
          `optimisation variable ${index + 1} needs finite min, max and positive step.`,
        );
      const count = Math.floor((max - min) / step) + 1;
      if (count < 1)
        throw new AgentToolError(
          `optimisation variable ${cell} has no candidates.`,
        );
      return { cell, min, max, step };
    });
    const duplicateCells = variables.filter(
      (variable, index) =>
        variables.findIndex((other) => other.cell === variable.cell) !== index,
    );
    if (duplicateCells.length)
      throw new AgentToolError(
        `optimisation variables must use distinct input cells; ${duplicateCells[0].cell} was provided more than once.`,
      );
    const runs = variables.reduce(
      (total, variable) =>
        total * (Math.floor((variable.max - variable.min) / variable.step) + 1),
      1,
    );
    if (runs > OPTIMISATION_MAX_RUNS)
      throw new AgentToolError(
        `optimisation would evaluate ${runs} candidates; reduce bounds or step to at most ${OPTIMISATION_MAX_RUNS}.`,
      );
    const rawConstraints = args.constraints ?? [];
    if (
      !Array.isArray(rawConstraints) ||
      rawConstraints.length > OPTIMISATION_MAX_CONSTRAINTS
    )
      throw new AgentToolError(
        `optimisation supports at most ${OPTIMISATION_MAX_CONSTRAINTS} constraints.`,
      );
    const constraints = rawConstraints.map((raw: any) => {
      const operator = String(
        raw?.operator ?? "",
      ) as OptimisationConstraint["operator"];
      if (![">=", "<=", "=", ">", "<"].includes(operator))
        throw new AgentToolError(
          "optimisation constraint operator must be >=, <=, =, > or <.",
        );
      const value = Number(raw?.value);
      if (!Number.isFinite(value))
        throw new AgentToolError(
          "optimisation constraint value must be finite.",
        );
      return { cell: checkCell(raw?.cell), operator, value };
    });
    return { mode, outputs, direction, variables, constraints };
  }
  if (mode === "data_table") {
    const input = checkCell(args.input_cell);
    const values = numbers(args.values, "values", WHAT_IF_MAX_VALUES);
    if (!args.second_input_cell)
      return { mode, outputs, input_cell: input, values };
    if (outputs.length !== 1)
      throw new AgentToolError("A two-input data table shows one output cell.");
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
            throw new AgentToolError(
              `Scenario "${name}": ${cell} needs a number.`,
            );
          return [checkCell(cell), number];
        }),
      ),
    };
  });
  const duplicateNames = scenarios.filter(
    (scenario, index) =>
      scenarios.findIndex(
        (other) =>
          other.name.trim().toLowerCase() ===
          scenario.name.trim().toLowerCase(),
      ) !== index,
  );
  if (duplicateNames.length)
    throw new AgentToolError(
      `scenario names must be unique; "${duplicateNames[0].name}" is repeated.`,
    );
  return { mode, outputs, scenarios };
}

/** Every set of input values to try, in table order. */
export function whatIfRuns(args: WhatIfArgs): Record<string, number>[] {
  if (args.mode === "optimisation") {
    const variables = args.variables!;
    const values = variables.map((variable) => {
      const result: number[] = [];
      for (
        let value = variable.min;
        value <= variable.max + variable.step / 1000;
        value += variable.step
      )
        result.push(Number(value.toFixed(12)));
      return result;
    });
    return values[0].flatMap((first) =>
      values.length === 1
        ? [{ [variables[0].cell]: first }]
        : values[1].map((second) => ({
            [variables[0].cell]: first,
            [variables[1].cell]: second,
          })),
    );
  }
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
  const formulaErrors = results
    .flatMap((row) => row)
    .map((value) => String(value ?? ""))
    .filter((value) =>
      /^#(?:DIV\/0!|VALUE!|SPILL!|CALC!|REF!|NAME\?|NUM!|N\/A|NULL!)$/i.test(
        value,
      ),
    );
  if (formulaErrors.length)
    throw new AgentToolError(
      `What-if calculation returned Excel error value(s): ${[...new Set(formulaErrors)].join(", ")}. Inputs were restored and no result was reported as successful.`,
    );
  if (args.mode === "optimisation") {
    const variables = args.variables!;
    const constraints = args.constraints ?? [];
    const rows = whatIfRuns(args).map((run, index) => {
      const result = results[index] ?? [];
      const feasible = constraints.every((constraint, constraintIndex) => {
        const value = Number(result[constraintIndex + 1]);
        if (!Number.isFinite(value)) return false;
        switch (constraint.operator) {
          case ">=":
            return value >= constraint.value;
          case "<=":
            return value <= constraint.value;
          case "=":
            return Math.abs(value - constraint.value) <= 1e-9;
          case ">":
            return value > constraint.value;
          case "<":
            return value < constraint.value;
        }
      });
      return [
        feasible ? "feasible" : "rejected",
        ...variables.map((variable) => run[variable.cell]),
        ...result,
      ];
    });
    const objectiveIndex = variables.length;
    const candidates = rows.filter((row) => row[0] === "feasible");
    if (!candidates.length)
      throw new AgentToolError(
        "No optimisation candidate satisfies the constraints.",
      );
    const best = candidates.reduce((winner, row) => {
      const current = Number(row[objectiveIndex + 1]);
      const previous = Number(winner[objectiveIndex + 1]);
      return args.direction === "maximize"
        ? current > previous
          ? row
          : winner
        : current < previous
          ? row
          : winner;
    });
    return [
      ["Status", ...variables.map((variable) => variable.cell), ...labels],
      ["BEST", ...best.slice(1)],
      ...rows,
    ];
  }
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
    [
      `${labels[0]} (${args.input_cell} down, ${args.second_input_cell} across)`,
      ...args.second_values!,
    ],
    ...args.values!.map((value, i) => [
      value,
      ...results.slice(i * width, (i + 1) * width).map((row) => row[0]),
    ]),
  ];
}
