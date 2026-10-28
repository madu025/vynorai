import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkbookPreferencesController } from "./taskpanePreferences.js";

test("preferences controller keeps workbook preferences behind explicit callbacks", () => {
  let preferences = {};
  const nodes = new Map<string, any>();
  const document = {
    querySelector(selector: string) {
      return nodes.get(selector) ?? null;
    },
  } as unknown as Document;
  const controller = createWorkbookPreferencesController({
    document,
    office: () => undefined,
    officeRuntime: () => undefined,
    workbookStorageFingerprint: () => "test-workbook",
    getPreferences: () => preferences,
    setPreferences: (next) => {
      preferences = next;
    },
    setStatus: () => {},
    record: () => {},
  });
  controller.save({ currency: "LKR" });
  assert.equal(preferences.currency, "LKR");
  controller.update({ audience: "management" as any });
  assert.equal(preferences.audience, "management");
});
