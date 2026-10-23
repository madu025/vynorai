import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { localizeMessage } from "./i18n.js";
import {
  LEDGER_KEY,
  MAX_MINUTES_PER_APPLY,
  MINUTES_BY_KIND,
  addToLedger,
  agentApplyKinds,
  classicApplyKinds,
  emptyLedger,
  formatMinutes,
  minutesForKinds,
  monthMinutes,
  parseLedger,
  readLedger,
  recordVerifiedApply,
  savedFooterText,
  streakDays,
  workKindOfAgentChange,
  workKindOfInstruction,
  type StorageLike,
  type WorkKind,
} from "./timeSaved.js";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10);

function memoryStorage(initial?: string): StorageLike & { value: string | null } {
  const store = { value: initial ?? null } as StorageLike & {
    value: string | null;
  };
  store.getItem = () => store.value;
  store.setItem = (_key, value) => {
    store.value = value;
  };
  return store;
}

test("the estimate table is small, fixed and conservative", () => {
  assert.deepEqual(MINUTES_BY_KIND, {
    chart: 3,
    cleanup: 5,
    summary: 4,
    format: 2,
    other: 2,
  });
  assert.equal(MAX_MINUTES_PER_APPLY, 15);
});

test("each kind counts once per apply and one apply is capped", () => {
  assert.equal(minutesForKinds(["chart", "chart", "chart"]), 3);
  assert.equal(minutesForKinds(["chart", "summary"]), 7);
  assert.equal(minutesForKinds([]), 0);
  const all: WorkKind[] = ["chart", "cleanup", "summary", "format", "other"];
  assert.equal(minutesForKinds(all), MAX_MINUTES_PER_APPLY);
});

test("a classic apply counts only when the source is unchanged and nothing failed", () => {
  const results = [
    { kind: "chart", status: "created" },
    { kind: "pivot-table", status: "created" },
    { kind: "new-sheet", status: "created" },
  ];
  assert.deepEqual(classicApplyKinds(results, true), ["chart", "summary"]);
  assert.deepEqual(classicApplyKinds(results, false), []);
  assert.deepEqual(
    classicApplyKinds([...results, { kind: "table", status: "failed" }], true),
    [],
  );
});

test("a result that already existed and an unknown kind add nothing", () => {
  assert.deepEqual(classicApplyKinds([{ kind: "chart", status: "exists" }], true), []);
  assert.deepEqual(
    classicApplyKinds([{ kind: "future-kind", status: "created" }], true),
    [],
  );
});

test("an agent apply counts only when every staged change ran and read back clean", () => {
  const changes = [
    { kind: "create_sheet" },
    { kind: "write_formula" },
    { kind: "create_chart" },
  ];
  const ok = [
    { status: "applied" },
    { status: "applied", detail: { cells: 4 } },
    { status: "applied" },
  ];
  assert.deepEqual(agentApplyKinds(changes, ok), ["other", "chart"]);
  assert.deepEqual(
    agentApplyKinds(changes, [ok[0], { status: "failed" }, ok[2]]),
    [],
  );
  assert.deepEqual(
    agentApplyKinds(changes, [ok[0], ok[1], { status: "skipped" }]),
    [],
  );
  assert.deepEqual(
    agentApplyKinds(changes, [
      ok[0],
      { status: "applied", detail: { mismatches: [{ cell: "B2" }] } },
      ok[2],
    ]),
    [],
  );
  assert.deepEqual(agentApplyKinds(changes, ok.slice(0, 2)), []);
  assert.deepEqual(agentApplyKinds([], []), []);
});

test("agent changes map to a kind of work", () => {
  assert.equal(workKindOfAgentChange({ kind: "format_range" }), "format");
  assert.equal(workKindOfAgentChange({ kind: "sort_range" }), "format");
  assert.equal(workKindOfAgentChange({ kind: "create_sheet" }), null);
  assert.equal(
    workKindOfAgentChange({ kind: "excel_action", tool: "pivot_action" }),
    "summary",
  );
  assert.equal(
    workKindOfAgentChange({ kind: "excel_action", tool: "clean_in_place" }),
    "cleanup",
  );
  assert.equal(
    workKindOfAgentChange({ kind: "excel_action", tool: "no_such_tool" }),
    null,
  );
  assert.equal(workKindOfAgentChange({ kind: "unknown" }), null);
  assert.equal(workKindOfInstruction("Remove duplicate rows"), "cleanup");
  assert.equal(workKindOfInstruction("Chart sales by region"), "chart");
  assert.equal(workKindOfInstruction("Total per department"), "summary");
  assert.equal(workKindOfInstruction("Make the header bold"), "format");
  assert.equal(workKindOfInstruction("Do the thing"), "other");
});

test("minutes are kept per month and per day", () => {
  let ledger = emptyLedger();
  ledger = addToLedger(ledger, 5, at(2026, 10, 22));
  ledger = addToLedger(ledger, 3, at(2026, 10, 22));
  ledger = addToLedger(ledger, 4, at(2026, 11, 2));
  assert.deepEqual(ledger.months, { "2026-10": 8, "2026-11": 4 });
  assert.deepEqual(ledger.days, { "2026-10-22": 2, "2026-11-02": 1 });
  assert.equal(monthMinutes(ledger, at(2026, 10, 30)), 8);
  assert.equal(monthMinutes(ledger, at(2026, 12, 1)), 0);
  assert.equal(addToLedger(ledger, 0, at(2026, 11, 3)), ledger);
});

test("the streak counts days in a row, ends after a missed day and survives a month change", () => {
  let ledger = emptyLedger();
  for (const [m, d] of [
    [10, 30],
    [10, 31],
    [11, 1],
  ])
    ledger = addToLedger(ledger, 2, at(2026, m, d));
  assert.equal(streakDays(ledger, at(2026, 11, 1)), 3);
  // Today is not over yet: yesterday keeps the streak alive.
  assert.equal(streakDays(ledger, at(2026, 11, 2)), 3);
  assert.equal(streakDays(ledger, at(2026, 11, 3)), 0);
  const gap = addToLedger(addToLedger(emptyLedger(), 2, at(2026, 3, 1)), 2, at(2026, 3, 3));
  assert.equal(streakDays(gap, at(2026, 3, 3)), 1);
  assert.equal(streakDays(emptyLedger(), at(2026, 3, 3)), 0);
});

test("the footer shows nothing until an apply was recorded, and says it is an estimate", () => {
  const now = at(2026, 10, 22);
  assert.deepEqual(savedFooterText(emptyLedger(), now), { month: "", streak: "" });
  const one = addToLedger(emptyLedger(), 25, now);
  assert.deepEqual(savedFooterText(one, now), {
    month: "About 25 min saved this month (estimate)",
    streak: "",
  });
  const two = addToLedger(one, 40, at(2026, 10, 21));
  const text = savedFooterText(two, now);
  assert.equal(text.month, "About 1 h 5 min saved this month (estimate)");
  assert.equal(text.streak, "2 day streak");
});

test("minutes read as minutes, then hours", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(59), "59 min");
  assert.equal(formatMinutes(60), "1 h");
  assert.equal(formatMinutes(125), "2 h 5 min");
});

test("recording writes the ledger and reads it back", () => {
  const storage = memoryStorage();
  const now = at(2026, 10, 22);
  recordVerifiedApply(storage, ["chart", "summary"], now);
  recordVerifiedApply(storage, ["cleanup"], now);
  const ledger = readLedger(storage);
  assert.equal(monthMinutes(ledger, now), 12);
  assert.equal(JSON.parse(storage.value ?? "{}").v, 1);
  assert.equal(LEDGER_KEY, "vynorai.m365.timeSaved");
});

test("an apply with no counted work records nothing", () => {
  const storage = memoryStorage();
  recordVerifiedApply(storage, [], at(2026, 10, 22));
  assert.equal(storage.value, null);
});

test("a blocked or broken store never throws", () => {
  const now = at(2026, 10, 22);
  assert.doesNotThrow(() => recordVerifiedApply(undefined, ["chart"], now));
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() => recordVerifiedApply(throwing, ["chart"], now));
  assert.deepEqual(readLedger(throwing), emptyLedger());
  const writeOnly = memoryStorage();
  writeOnly.setItem = () => {
    throw new Error("quota");
  };
  assert.deepEqual(recordVerifiedApply(writeOnly, ["chart"], now), emptyLedger());
});

test("a damaged ledger is ignored, bad keys and numbers are dropped", () => {
  assert.deepEqual(parseLedger("not json"), emptyLedger());
  assert.deepEqual(parseLedger(null), emptyLedger());
  assert.deepEqual(parseLedger('{"v":2,"months":{"2026-10":5}}'), emptyLedger());
  const mixed = parseLedger(
    JSON.stringify({
      v: 1,
      months: { "2026-10": 7, "bad": 3, "2026-09": -4, "2026-08": "9" },
      days: { "2026-10-22": 1, "yesterday": 1, "2026-10-21": 1e99 },
    }),
  );
  assert.deepEqual(mixed.months, { "2026-10": 7 });
  assert.deepEqual(Object.keys(mixed.days).sort(), ["2026-10-21", "2026-10-22"]);
  assert.equal(mixed.days["2026-10-21"], 100_000);
});

test("old days and months are dropped so the stored ledger stays small", () => {
  let ledger = emptyLedger();
  const start = new Date(2024, 0, 1, 10);
  for (let i = 0; i < 500; i += 1)
    ledger = addToLedger(
      ledger,
      1,
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 10),
    );
  assert.equal(Object.keys(ledger.days).length, 400);
  assert.ok(Object.keys(ledger.months).length <= 24);
});

test("both apply paths record only through the verified-kind helpers, and the footer is run-time text", () => {
  const source = readFileSync(new URL("./taskpane.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /noteVerifiedApply\(\s*classicApplyKinds\(report\.results, report\.sourceUnchangedAfterApply\)/,
  );
  assert.match(
    source,
    /if \(agentRounds === 0\)\s*noteVerifiedApply\(\s*agentApplyKinds\(/,
  );
  // Nothing else writes the ledger.
  assert.equal(source.match(/recordVerifiedApply\(/g)?.length, 1);
  const html = readFileSync(new URL("../taskpane.html", import.meta.url), "utf8");
  const footer = /<p id="saved-footer"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";
  assert.match(footer, /hidden/);
  assert.doesNotMatch(
    footer,
    /data-i18n/,
    "the code writes this text, localizeMessage translates it",
  );
});

test("the footer sends nothing anywhere", () => {
  const source = readFileSync(new URL("./timeSaved.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

test("the footer lines have Sinhala and Tamil wording with the numbers kept", () => {
  const month = "About 1 h 5 min saved this month (estimate)";
  assert.match(localizeMessage("si", month), /පැය 1 විනාඩි 5/);
  assert.match(localizeMessage("si", month), /ඇස්තමේන්තුවක්/);
  assert.match(localizeMessage("ta", month), /1 மணி 5 நிமிடம்/);
  assert.match(localizeMessage("ta", month), /மதிப்பீடு/);
  assert.match(
    localizeMessage("si", "About 25 min saved this month (estimate)"),
    /විනාඩි 25/,
  );
  assert.match(
    localizeMessage("ta", "About 2 h saved this month (estimate)"),
    /2 மணி \(மதிப்பீடு\)/,
  );
  assert.equal(localizeMessage("si", "3 day streak"), "දින 3ක් අඛණ්ඩව");
  assert.equal(localizeMessage("ta", "3 day streak"), "3 நாள் தொடர்ச்சி");
});
