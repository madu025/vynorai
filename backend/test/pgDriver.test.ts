import assert from "node:assert/strict";
import test from "node:test";
import { PG_NOW_TEXT, translatePostgresSql } from "../src/services/pgDriver.js";

test("placeholders become numbered, but not inside string literals", () => {
  assert.equal(
    translatePostgresSql(
      "SELECT * FROM users WHERE id = ? AND note = 'why?' AND email = ?",
    ),
    "SELECT * FROM users WHERE id = $1 AND note = 'why?' AND email = $2",
  );
});

test("CURRENT_TIMESTAMP keeps SQLite's text format", () => {
  assert.equal(
    translatePostgresSql(
      "UPDATE monthly_usage SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ),
    `UPDATE monthly_usage SET updated_at = ${PG_NOW_TEXT} WHERE id = $1`,
  );
});

test("scalar MAX(0, x) becomes GREATEST", () => {
  assert.equal(
    translatePostgresSql("SET used_tokens = MAX(0, used_tokens - ?)"),
    "SET used_tokens = GREATEST(0, used_tokens - $1)",
  );
  // Aggregate MAX is untouched.
  assert.equal(
    translatePostgresSql("SELECT MAX(created_at) FROM t"),
    "SELECT MAX(created_at) FROM t",
  );
});

test("camelCase aliases are quoted everywhere they are used", () => {
  assert.equal(
    translatePostgresSql(
      "SELECT model, COUNT(*) as requestCount, SUM(tokens_used) as totalTokens FROM usage_logs GROUP BY model ORDER BY totalTokens DESC",
    ),
    'SELECT model, COUNT(*) as "requestCount", SUM(tokens_used) as "totalTokens" FROM usage_logs GROUP BY model ORDER BY "totalTokens" DESC',
  );
  // snake_case and lowercase aliases need no quoting.
  assert.equal(
    translatePostgresSql("SELECT COUNT(*) as count FROM users"),
    "SELECT COUNT(*) as count FROM users",
  );
});
