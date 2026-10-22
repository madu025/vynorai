import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWhatIf, whatIfRuns, whatIfTable } from "./whatIf.js";

test("a one-input data table tries each value and lists every output", () => {
  const args = checkWhatIf({
    mode: "data_table",
    outputs: ["B5", "b6"],
    input_cell: "$B$1",
    values: [8, 10, "12"],
  });
  assert.deepEqual(args.outputs, ["B5", "B6"]);
  assert.deepEqual(whatIfRuns(args), [{ B1: 8 }, { B1: 10 }, { B1: 12 }]);
  assert.deepEqual(
    whatIfTable(
      args,
      [
        [100, 1],
        [200, 2],
        [300, 3],
      ],
      ["Profit", "Margin"],
    ),
    [
      ["B1", "Profit", "Margin"],
      [8, 100, 1],
      [10, 200, 2],
      [12, 300, 3],
    ],
  );
});

test("a two-input data table is a grid of one output", () => {
  const args = checkWhatIf({
    mode: "data_table",
    outputs: ["B5"],
    input_cell: "B1",
    values: [10, 20],
    second_input_cell: "B2",
    second_values: [1, 2, 3],
  });
  assert.equal(whatIfRuns(args).length, 6);
  assert.deepEqual(whatIfRuns(args)[1], { B1: 10, B2: 2 });
  assert.deepEqual(
    whatIfTable(args, [[1], [2], [3], [4], [5], [6]], ["Profit"]),
    [
      ["Profit (B1 down, B2 across)", 1, 2, 3],
      [10, 1, 2, 3],
      [20, 4, 5, 6],
    ],
  );
  assert.throws(
    () => checkWhatIf({ ...args, outputs: ["B5", "B6"] }),
    /one output cell/,
  );
});

test("scenarios name their inputs and compare the outputs side by side", () => {
  const args = checkWhatIf({
    mode: "scenarios",
    outputs: ["B5"],
    scenarios: [
      { name: "Base", inputs: { B1: 10, B2: 50 } },
      { name: "Price up 10%", inputs: { B1: 11 } },
    ],
  });
  assert.deepEqual(whatIfRuns(args), [{ B1: 10, B2: 50 }, { B1: 11 }]);
  assert.deepEqual(whatIfTable(args, [[200], [250]], ["Profit"]), [
    ["Scenario", "Profit"],
    ["Base", 200],
    ["Price up 10%", 250],
  ]);
});

test("bad what-if arguments come back as messages the model can act on", () => {
  assert.throws(
    () => checkWhatIf({ mode: "solver", outputs: ["B5"] }),
    /mode must be one of/,
  );
  assert.throws(
    () =>
      checkWhatIf({
        mode: "data_table",
        outputs: ["B5"],
        input_cell: "B1",
        values: [],
      }),
    /values needs 1 to 50 numbers/,
  );
  assert.throws(
    () =>
      checkWhatIf({
        mode: "scenarios",
        outputs: ["B5"],
        scenarios: [{ name: "Only one", inputs: { B1: 1 } }],
      }),
    /2 to 6 named scenarios/,
  );
  assert.throws(
    () =>
      checkWhatIf({
        mode: "scenarios",
        outputs: ["B5"],
        scenarios: [
          { name: "A", inputs: { B1: "high" } },
          { name: "B", inputs: { B1: 2 } },
        ],
      }),
    /B1 needs a number/,
  );
});
