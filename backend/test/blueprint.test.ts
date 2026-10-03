import assert from "node:assert/strict";
import { test } from "node:test";

import { detectProjectBlueprint } from "../src/services/scaffoldRegistry.ts";

test("blueprints answer requests for a whole new project", () => {
  assert.equal(
    detectProjectBlueprint("build me an ecommerce store with PayHere")?.id,
    "ecommerce",
  );
  assert.equal(
    detectProjectBlueprint("I want to create a POS system for my shop")?.id,
    "ecommerce",
  );
  assert.equal(
    detectProjectBlueprint("create a multi-tenant saas platform")?.id,
    "saas_platform",
  );
  assert.equal(
    detectProjectBlueprint("develop a fintech backend for money transfer")?.id,
    "fintech_banking",
  );
});

test("blueprints never hijack edits to existing code", () => {
  for (const prompt of [
    "Refactor HistoryManager into IndexStore and SessionStore classes",
    "fix the POST handler in routes/auth.ts",
    "update docker-compose to add redis",
    "add a restore button to the settings page",
    "move the cost ledger writes into a transaction",
    "fix the position of the store badge in the header",
    "write tests for the wallet balance helper",
  ]) {
    assert.equal(detectProjectBlueprint(prompt), null, prompt);
  }
  // Long, code-carrying prompts are edits, not project requests.
  assert.equal(
    detectProjectBlueprint("build an online store\n```ts\nconst a = 1;\n```"),
    null,
  );
});
