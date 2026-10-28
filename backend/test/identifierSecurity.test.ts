import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ID_PATTERN,
  NAME_PATTERN,
  idParam,
  nameParam,
  newId,
  newToken,
  safeEqual,
} from "../src/services/secureId.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
      out.push(full);
  }
  return out;
}

test("newId is CSPRNG-shaped, unique and prefix-checked", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i += 1) seen.add(newId("snap"));
  assert.equal(seen.size, 5000);
  for (const id of seen) assert.match(id, /^snap_[0-9a-f]{32}$/);
  assert.match(newId(), /^[0-9a-f]{32}$/);
  for (const bad of ["", "A", "1x", "a-b", "a_b", "x".repeat(17), "a b"])
    assert.throws(() => newId(bad), /INVALID_ID_PREFIX/);
});

test("ids do not carry a clock or a counter", () => {
  const first = newId("m365");
  const second = newId("m365");
  // 128 random bits: consecutive ids share no long prefix (a timestamp id would).
  let common = 0;
  while (first[common] === second[common]) common += 1;
  assert.ok(common < 12, `consecutive ids share ${common} leading characters`);
});

test("newToken has the requested entropy and is URL-safe", () => {
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(newToken(16), /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(newToken(), newToken());
  assert.throws(() => newToken(8), /INVALID_TOKEN_SIZE/);
  assert.throws(() => newToken(1024), /INVALID_TOKEN_SIZE/);
});

test("safeEqual compares in constant time and never throws", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(undefined, "x"), false);
  assert.equal(safeEqual("x", null), false);
  assert.equal(safeEqual(1, 1), false);
});

test("client-supplied id parameters reject malformed values", () => {
  const good = [
    "0b8f5a0e-3c1e-4d7e-9a43-2f6f2f5b7a11",
    "user_1",
    "starter",
    "a".repeat(128),
  ];
  const bad = [
    "",
    " ",
    "a b",
    "../etc/passwd",
    "x'; DROP TABLE users;--",
    "id\n",
    "id\u0000",
    "a".repeat(129),
    "%00",
    "a/b",
  ];
  const id = idParam("id");
  for (const value of good) assert.equal(id.safeParse(value).success, true);
  for (const value of bad)
    assert.equal(id.safeParse(value).success, false, value);
  const name = nameParam("name");
  for (const value of ["deepseek", "vendor/model:tag", "gpt-4.1"])
    assert.equal(name.safeParse(value).success, true);
  for (const value of ["", "a b", "a;b", "a".repeat(129), "x\n", "a'b"])
    assert.equal(name.safeParse(value).success, false, value);
  assert.ok(ID_PATTERN.test("abc") && NAME_PATTERN.test("a.b"));
});

test("route param schemas use the strict id validators", async () => {
  const { AdminUserParamSchema, AdminPlanParamSchema, AdminPoolIdParamSchema } =
    await import("../src/routes/admin.js");
  const { TaskIdParamSchema } = await import("../src/routes/background.js");
  const { RuleParamSchema, MemoryParamSchema } = await import(
    "../src/routes/memory.js"
  );
  const nasty = "1' OR '1'='1";
  assert.equal(
    AdminUserParamSchema.safeParse({ userId: nasty }).success,
    false,
  );
  assert.equal(
    AdminPlanParamSchema.safeParse({ planId: nasty }).success,
    false,
  );
  assert.equal(AdminPoolIdParamSchema.safeParse({ id: nasty }).success, false);
  assert.equal(TaskIdParamSchema.safeParse({ id: nasty }).success, false);
  assert.equal(
    TaskIdParamSchema.safeParse({ id: "x".repeat(500) }).success,
    false,
  );
  assert.equal(RuleParamSchema.safeParse({ id: nasty }).success, false);
  assert.equal(
    MemoryParamSchema.safeParse({ key: "k".repeat(200) }).success,
    false,
  );
  assert.equal(MemoryParamSchema.safeParse({ key: "a\u0000b" }).success, false);
  assert.equal(
    TaskIdParamSchema.safeParse({ id: "0b8f5a0e-3c1e-4d7e-9a43-2f6f2f5b7a11" })
      .success,
    true,
  );
  assert.equal(
    MemoryParamSchema.safeParse({ key: "favorite_color" }).success,
    true,
  );
});

/**
 * Regression guards: these fail when a weak generator or an interpolated SQL string is added again.
 */
test("no database/API identifier is built from Math.random or a clock", () => {
  // Rate-limit jitter and the vault sample code are not identifiers.
  const allowed = new Set([
    "services/admissionControl.ts",
    "services/vaultStore.ts",
    "services/secureId.ts",
  ]);
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    if (allowed.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      if (/Math\.random\(/.test(line))
        offenders.push(`${rel}:${index + 1} ${line.trim()}`);
      if (
        /`[A-Za-z_-]*\$\{Date\.now\(\)\}/.test(line) &&
        /\b(id|Id|ID|jti|jwtid|lease|order)/.test(line)
      )
        offenders.push(`${rel}:${index + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("SQL text is never built by interpolating request-controlled values", () => {
  // Reviewed splices: constants, placeholder lists, a number clamped to 1..100, or a column that is
  // a TypeScript literal union / allow-list. A new entry here needs a security review.
  const reviewed = new Set([
    'routes/admin.ts|sums("e.")',
    "scripts/migrateSqliteToPostgres.ts|table",
    "services/backgroundTasks.ts|where",
    'services/backgroundTasks.ts|ACTIVE_STATUSES.map(()=>"?").join(",")',
    "services/cloudDeliveryControl.ts|safeLimit",
    "services/m365Sandbox.ts|column",
    // One-time carry-over: table and column names come from the reviewed table list or the new
    // database's own catalog, and quoteIdent() rejects anything outside [a-z0-9_].
    "services/pgCarryOver.ts|quoteIdent(table)",
    "services/pgCarryOver.ts|quoteIdent(spec.table)",
    "services/pgCarryOver.ts|quoteIdent(t.table)",
    'services/pgCarryOver.ts|names.map(quoteIdent).join(",")',
    "services/pgCarryOver.ts|placeholders",
    "services/retention.ts|table",
    "services/planManager.ts|sets",
    'services/planManager.ts|Object.keys(fields).join(",")',
    'services/planManager.ts|Object.keys(fields).map(()=>"?").join(",")',
  ]);
  const constants = new Set(["t", "CHAIN_ORDER"]);
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/`(?:[^`\x5c]|\x5c.)*`/g)) {
      const literal = match[0];
      if (!/\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(literal))
        continue;
      for (const part of literal.matchAll(/\$\{([^}]*)\}/g)) {
        const expression = part[1].replace(/\s+/g, "");
        if (constants.has(expression) || reviewed.has(rel + "|" + expression))
          continue;
        // SCREAMING_CASE names are module constants (SUMS, WHERE, ACTIVE_SQL), never request data.
        if (/^[A-Z][A-Z0-9_]*$/.test(expression)) continue;
        if (/^tenantId\?"[^"$`]*":""$/.test(expression)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          rel + ":" + line + " ${" + expression.slice(0, 80) + "}",
        );
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("a plan override can only name known columns", async () => {
  const { updatePlanField, PLAN_OVERRIDE_COLUMNS } = await import(
    "../src/services/planManager.js"
  );
  await assert.rejects(
    updatePlanField("pro", {
      "is_active = 1; DROP TABLE users; --": 1,
    } as never),
    /INVALID_PLAN_COLUMN/,
  );
  await assert.rejects(
    updatePlanField("pro", { plan_id: "x" } as never),
    /INVALID_PLAN_COLUMN/,
  );
  assert.ok(PLAN_OVERRIDE_COLUMNS.has("display_name"));
  assert.ok(!PLAN_OVERRIDE_COLUMNS.has("plan_id"));
});

test("webhook and secret comparisons are constant-time", () => {
  const checks: Array<[string, RegExp]> = [
    ["services/payhere.ts", /safeEqual\(/],
    ["routes/googleAuth.ts", /safeEqual\(claims\.nonce/],
  ];
  for (const [file, pattern] of checks)
    assert.match(fs.readFileSync(path.join(SRC, file), "utf8"), pattern, file);
  const admin = fs.readFileSync(path.join(SRC, "routes/admin.ts"), "utf8");
  assert.doesNotMatch(admin, /safeEqual\(secret, expected\)/);
  assert.doesNotMatch(admin, /x-admin-secret/);
  const payhere = fs.readFileSync(
    path.join(SRC, "services/payhere.ts"),
    "utf8",
  );
  assert.doesNotMatch(payhere, /toUpperCase\(\) === localMd5sig/);
});
