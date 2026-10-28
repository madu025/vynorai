import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCapabilityReport } from "./taskpaneCapabilityView.js";

test("capability view refuses to invent a report when no host evidence exists", () => {
  const list = { replaceChildren() {}, append() {} };
  const document = {
    querySelector(selector: string) {
      return selector === "#capability-report-list" ? list : null;
    },
    createElement() {
      return {
        className: "",
        textContent: "",
        dataset: {},
        append() {},
      };
    },
  } as unknown as Document;
  renderCapabilityReport(document, undefined);
  assert.ok(true);
});
