import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeInstruction } from "./intent.js";

test("politeness around a request is dropped, the request itself is kept", () => {
  assert.equal(
    normalizeInstruction(
      "could you add RTOM Name from the Lookup sheet by RTOM?",
    ),
    "add RTOM Name from the Lookup sheet by RTOM",
  );
  assert.equal(
    normalizeInstruction("Please fill blank cells with 0, thanks."),
    "fill blank cells with 0",
  );
  assert.equal(
    normalizeInstruction("fill blank cells with 0."),
    "fill blank cells with 0",
  );
  assert.equal(
    normalizeInstruction(
      "I would like you to unpivot A and B into Measure and Amount",
    ),
    "unpivot A and B into Measure and Amount",
  );
});

test("a plain question keeps its question mark", () => {
  assert.equal(
    normalizeInstruction(
      "which RTOM has the highest total Requested Quantity?",
    ),
    "which RTOM has the highest total Requested Quantity?",
  );
});

test("a value that ends in a word like 'thanks' inside a name is not cut", () => {
  assert.equal(
    normalizeInstruction("filter Status contains thanksgiving"),
    "filter Status contains thanksgiving",
  );
});
