import assert from "node:assert/strict";
import { test } from "node:test";
import { canAutoApprove } from "./agentAutoApprove.js";

const chart: any = {
  kind: "create_chart",
  sheet: "Region Summary",
  chartType: "bar",
};
const format: any = {
  kind: "format_range",
  sheet: "'region summary'",
  address: "A1:B1",
  bold: true,
};

test("a follow-up on a sheet this run made needs no second approval", () => {
  assert.equal(canAutoApprove([chart, format], ["Region Summary"]), true);
});

test("changes to the person's own sheets or other kinds still wait", () => {
  assert.equal(canAutoApprove([chart], ["Other"]), false);
  assert.equal(canAutoApprove([chart], []), false);
  assert.equal(canAutoApprove([], ["Region Summary"]), false);
  const sort: any = {
    kind: "sort_range",
    sheet: "Region Summary",
    address: "A1:B9",
    column: "B",
    descending: true,
  };
  assert.equal(canAutoApprove([chart, sort], ["Region Summary"]), false);
  const step: any = { kind: "vynor_step", instruction: "x", understood: "y" };
  assert.equal(canAutoApprove([step], ["Region Summary"]), false);
});
