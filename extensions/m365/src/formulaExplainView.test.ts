import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EXPLAIN_MAX_REFERENCE_CELLS,
  EXPLAIN_MAX_VISIBLE_STEPS,
  buildFormulaExplainView,
  singleCellReferences,
} from "./formulaExplainView.js";

const read = (formula: string | null, over: object = {}) => ({
  address: "Sheet1!C2",
  cellCount: 1,
  formula,
  values: {},
  ...over,
});

test("a selection without a formula says so and never calls the explainer", () => {
  assert.deepEqual(buildFormulaExplainView(read(null)), {
    kind: "no_formula",
    address: "Sheet1!C2",
  });
  assert.equal(buildFormulaExplainView(read("=")).kind, "error");
});

test("more than one selected cell asks for a single cell", () => {
  const view = buildFormulaExplainView(read("=A1+1", { cellCount: 4 }));
  assert.equal(view.kind, "many_cells");
});

test("a formula over the explainer limit is reported as too long", () => {
  const view = buildFormulaExplainView(read(`=${"A1+".repeat(4000)}1`));
  assert.equal(view.kind, "too_long");
});

test("an explainer error is passed on as an error with its text", () => {
  const view = buildFormulaExplainView(read('=IF(A1>1,"x'));
  assert.equal(view.kind, "error");
  if (view.kind === "error") assert.match(view.detail, /closing quote/);
});

test("steps are listed innermost first, whole formula last, with values as inputs", () => {
  const view = buildFormulaExplainView(
    read("=IF(SUM(A1,B1)>10,A1,0)", {
      values: { A1: 7, B1: "", Z9: 1 },
    }),
  );
  assert.equal(view.kind, "steps");
  if (view.kind !== "steps") return;
  assert.equal(view.hiddenCount, 0);
  assert.deepEqual(
    view.rows.map((r) => [r.number, r.expression]),
    [
      [1, "SUM(A1,B1)"],
      [2, "IF(SUM(A1,B1)>10,A1,0)"],
    ],
  );
  assert.deepEqual(view.rows[0].inputs, [
    { reference: "A1", text: "7" },
    { reference: "B1", text: null },
  ]);
  assert.equal(view.rows[1].isWhole, true);
  assert.equal(view.rows[0].isWhole, false);
});

test("many steps are cut to a bounded list, keeping the whole formula, with an N more count", () => {
  let formula = "A1";
  for (let i = 0; i < 20; i++) formula = `ABS(${formula})`;
  const view = buildFormulaExplainView(read(`=${formula}`));
  assert.equal(view.kind, "steps");
  if (view.kind !== "steps") return;
  assert.equal(view.rows.length, EXPLAIN_MAX_VISIBLE_STEPS);
  assert.equal(view.hiddenCount, 20 - EXPLAIN_MAX_VISIBLE_STEPS);
  assert.equal(view.totalSteps, 20);
  const last = view.rows[view.rows.length - 1];
  assert.equal(last.number, 20);
  assert.equal(last.isWhole, true);
  assert.equal(view.rows[0].number, 1);
});

test("a long value is clipped", () => {
  const view = buildFormulaExplainView(
    read("=LEN(A1)", { values: { A1: "x".repeat(500) } }),
  );
  if (view.kind !== "steps") throw new Error("expected steps");
  const text = view.rows[0].inputs[0].text ?? "";
  assert.ok(text.length <= 41, String(text.length));
});

test("only single cells are returned for the value read, bounded and unique", () => {
  assert.deepEqual(
    singleCellReferences("=SUM(A1:A9)+B2+$B$2+Data!C3+'My Sheet'!D4"),
    ["B2", "Data!C3", "My Sheet!D4"],
  );
  assert.deepEqual(singleCellReferences("=1+"), []);
  const many = `=${Array.from({ length: 60 }, (_, i) => `A${i + 1}`).join("+")}`;
  assert.equal(singleCellReferences(many).length, EXPLAIN_MAX_REFERENCE_CELLS);
});

test("the pane action has an accessible label and Sinhala and Tamil wording for every key it uses", async () => {
  await import("./packSi.js");
  await import("./packTa.js");
  const { translate } = await import("./i18n.js");
  const html = readFileSync(
    new URL("../taskpane.html", import.meta.url),
    "utf8",
  );
  assert.match(
    html,
    /id="explain-formula"[^>]*aria-label="Explain the formula in the selected cell"/,
  );
  const view = readFileSync(
    new URL("./taskpaneFormulaExplainView.ts", import.meta.url),
    "utf8",
  );
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-aria-label)?="(explain_\w+)"/g)].map(
      (m) => m[1],
    ),
    ...[...view.matchAll(/^ {2}(explain_\w+):/gm)].map((m) => m[1]),
  ]);
  assert.ok(keys.size >= 14, String(keys.size));
  for (const language of ["si", "ta"] as const)
    for (const key of keys)
      assert.notEqual(translate(language, key, ""), "", `${language} ${key}`);
});

test("the explain read never assigns to the workbook", () => {
  const source = readFileSync(
    new URL("./officeExcel.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "export async function readSelectedFormulaForExplain",
  );
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.ok(body.length > 200);
  assert.doesNotMatch(
    body,
    /\.(values|formulas|numberFormat|clear|delete|insert)\s*=[^=]/,
  );
});
