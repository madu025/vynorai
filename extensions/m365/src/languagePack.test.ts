import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureLanguagePack, localizeMessage, translate } from "./i18n.js";
import { languagePack } from "./languageRegistry.js";

test("Sinhala and Tamil text is not part of the pane until a pack is loaded", async () => {
  assert.equal(languagePack("si"), undefined);
  assert.equal(translate("si", "hero", "Hello"), "Hello");
  assert.equal(localizeMessage("ta", "Undo"), "Undo");
  await ensureLanguagePack("en");
  assert.equal(languagePack("si"), undefined);
});

test("loading a pack makes translate and localizeMessage use it, once", async () => {
  await Promise.all([ensureLanguagePack("si"), ensureLanguagePack("si")]);
  assert.ok(languagePack("si"));
  assert.notEqual(translate("si", "hero", "Hello"), "Hello");
  assert.equal(languagePack("ta"), undefined);
  await ensureLanguagePack("ta");
  assert.ok(languagePack("ta"));
  assert.notEqual(translate("ta", "hero", "Hello"), "Hello");
  // a message that has no Sinhala wording stays English
  assert.equal(
    localizeMessage("si", "zzz not a known message"),
    "zzz not a known message",
  );
});
