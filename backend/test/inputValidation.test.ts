import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanDisplayName } from "../src/services/inputValidation.js";

test("display names lose markup, control characters and excess length", () => {
  assert.equal(
    cleanDisplayName('<img src=x onerror="alert(1)">Kasun'),
    "img src=x onerror=alert(1)Kasun",
  );
  assert.equal(cleanDisplayName("  Nimal \n\t Perera  "), "Nimal Perera");
  assert.equal(cleanDisplayName("කසුන් පෙරේරා"), "කසුන් පෙරේරා");
  assert.equal(cleanDisplayName("a".repeat(500)).length, 80);
  assert.equal(cleanDisplayName({ toString: () => "<b>" }), "");
  assert.equal(cleanDisplayName(undefined), "");
});
