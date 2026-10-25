import assert from "node:assert/strict";
import { test } from "node:test";
import { runExcelAction, type ActionRun } from "./officeAgentActions.js";

class FakeRange {
  readonly address: string;
  private formulaValue: string | number = "";
  private valueValue: string | number = "";

  constructor(
    private readonly book: FakeBook,
    private readonly sheet: string,
    address: string,
  ) {
    this.address = `'${sheet}'!${address}`;
  }

  load(_what: unknown): void {}

  get formulas(): (string | number)[][] {
    if (this.sheet === "Model" && this.address.endsWith("'!B2"))
      return [["=B1*(10-B1)"]];
    if (this.sheet === "Model" && this.address.endsWith("'!B3"))
      return [["=B1"]];
    return [[this.formulaValue]];
  }

  set formulas(value: (string | number)[][]) {
    this.formulaValue = value[0][0];
    if (this.sheet === "Model" && this.address.endsWith("'!B1"))
      this.book.input = Number(value[0][0]);
    this.valueValue = value[0][0];
  }

  get values(): (string | number)[][] {
    if (this.sheet === "Model" && this.address.endsWith("'!B1"))
      return [[this.book.input]];
    if (this.sheet === "Model" && this.address.endsWith("'!B2"))
      return [[this.book.input * (10 - this.book.input)]];
    if (this.sheet === "Model" && this.address.endsWith("'!B3"))
      return [[this.book.input]];
    return [[this.valueValue]];
  }

  set values(value: (string | number)[][]) {
    this.valueValue = value[0][0];
    if (this.sheet === "Model" && this.address.endsWith("'!B1"))
      this.book.input = Number(value[0][0]);
  }

  getCell(row: number, column: number): FakeRange {
    const letter = String.fromCharCode(65 + column);
    return new FakeRange(this.book, this.sheet, `${letter}${row + 1}`);
  }
}

class FakeSheet {
  constructor(
    private readonly book: FakeBook,
    readonly name: string,
  ) {}
  getRange(address: string): FakeRange {
    return new FakeRange(this.book, this.name, address);
  }
  getCell(row: number, column: number): FakeRange {
    return new FakeRange(
      this.book,
      this.name,
      `${String.fromCharCode(65 + column)}${row + 1}`,
    );
  }
}

class FakeBook {
  input = 0;
  readonly context = {
    workbook: { worksheets: {} },
    sync: async () => undefined,
  };
  readonly model = new FakeSheet(this, "Model");
  readonly result = new FakeSheet(this, "Result");
}

test("approved optimisation evaluates Excel formulas, filters constraints, writes evidence and restores inputs", async () => {
  const book = new FakeBook();
  const result = await runExcelAction(
    {
      context: book.context,
      sheet: (name) => (name === "Model" ? book.model : book.result),
      ours: () => true,
      journal: [],
      backup: async () => {
        throw new Error("result sheet should already be approved/created");
      },
      rename: () => undefined,
    } satisfies ActionRun,
    "what_if",
    {
      mode: "optimisation",
      model_sheet: "Model",
      outputs: ["B2"],
      direction: "maximize",
      variables: [{ cell: "B1", min: 0, max: 10, step: 1 }],
      constraints: [{ cell: "B3", operator: ">=", value: 5 }],
      sheet: "Result",
      cell: "A1",
    },
  );
  assert.equal(
    book.input,
    0,
    "the model input must be restored after evaluation",
  );
  assert.deepEqual(result, { cells: 52, problems: [] });
});
