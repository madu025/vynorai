import assert from "node:assert/strict";
import test from "node:test";
import { cleanCellProperties } from "./cellPropertiesUndo.js";

test("an empty fill is cleared, not set back as an empty colour", () => {
  const { cells, clearFill } = cleanCellProperties([
    [
      {
        fill: { color: "" },
        font: { bold: false, color: "#000000", name: "" },
      },
    ],
  ]);
  assert.deepEqual(clearFill, [[0, 0]]);
  assert.equal("fill" in cells[0][0], false);
  assert.deepEqual(cells[0][0].font, { bold: false, color: "#000000" });
});

test("a border with style None keeps only the style", () => {
  const { cells } = cleanCellProperties([
    [
      {
        borders: {
          top: { style: "None", color: "", weight: "Thin" },
          bottom: { style: "Continuous", color: "#000000", weight: "Thin" },
        },
      },
    ],
  ]);
  assert.deepEqual(cells[0][0].borders, {
    top: { style: "None" },
    bottom: { style: "Continuous", color: "#000000", weight: "Thin" },
  });
});
