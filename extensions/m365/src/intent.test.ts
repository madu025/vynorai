import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretInstruction } from "./intent.js";

test("a Sinhala pivot request names its rows and values", () => {
  const headers = ["Service ID", "RTOM", "Status", "Requested Quantity"];
  const rows = [["a", "R-HK", "S", 1]];
  const result: any = interpretInstruction(
    "RTOM අනුව Requested Quantity එකතුව pivot table එකක් හදන්න",
    headers,
    rows,
  );
  assert.deepEqual(result.actions, ["pivot-table"]);
  assert.equal(result.specs.pivot.rows, 1);
  assert.equal(result.specs.pivot.values, 3);
});
