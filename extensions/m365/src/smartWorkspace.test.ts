import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseSmartPath,
  selectionBadges,
  suggestionsForSelection,
} from "./smartWorkspace.js";

test("Smart Run keeps ordinary work local and routes workbook-wide reasoning to the agent", () => {
  assert.equal(chooseSmartPath("Create a chart", "smart", true), "local");
  assert.equal(
    chooseSmartPath(
      "Join the Orders and Items sheets, then chart the result",
      "smart",
      true,
    ),
    "agent",
  );
  assert.equal(
    chooseSmartPath(
      "Why did profit fall between these two periods?",
      "smart",
      true,
    ),
    "agent",
  );
  assert.equal(chooseSmartPath("Join two sheets", "local", true), "local");
  assert.equal(chooseSmartPath("Create a chart", "agent", true), "agent");
  assert.equal(chooseSmartPath("Join two sheets", "agent", false), "local");
});

test("selection suggestions are bounded, shape-aware and contain preview instructions", () => {
  assert.deepEqual(suggestionsForSelection(undefined), []);
  assert.equal(
    suggestionsForSelection({ address: "Data!B2", rows: 1, columns: 1 })[0]?.id,
    "formulas",
  );
  const small = suggestionsForSelection({
    address: "Data!A1:D20",
    rows: 20,
    columns: 4,
  });
  assert.deepEqual(
    small.map((item) => item.id),
    ["quality", "chart", "dashboard"],
  );
  assert.ok(small.every((item) => item.instruction && item.reason));

  const large = suggestionsForSelection({
    address: "Data!A1:J520126",
    rows: 520126,
    columns: 10,
  });
  assert.equal(large[1]?.id, "pivot");
  assert.match(large[1]?.reason ?? "", /full range/i);
});

test("selection badges disclose the range size and large-range fallback", () => {
  assert.deepEqual(
    selectionBadges({ address: "Data!A1:C20", rows: 20, columns: 3 }),
    ["20 rows", "3 columns", "Local preview"],
  );
  assert.equal(
    selectionBadges({
      address: "Data!A1:J520126",
      rows: 520126,
      columns: 10,
    })[2],
    "Large range",
  );
});
