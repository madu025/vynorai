import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// SQLite's CURRENT_TIMESTAMP is zone-less UTC text. Read with `new Date`, it is local time, so in a
// UTC+5:30 zone a timestamp just written looks five and a half hours old (a heartbeat looks dead,
// a cooldown never fires). dbTimestampMs must read it as UTC in any zone.
test("dbTimestampMs reads SQLite CURRENT_TIMESTAMP as UTC outside UTC", async () => {
  const previousDirectory = process.cwd();
  const previousEnv = { ...process.env };
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-db-time-")));
  process.env.NODE_ENV = "test";
  process.env.TZ = "Asia/Colombo";
  try {
    const db = await import("../src/db.js");
    await db.initDb();
    const row = await db.dbGet<{ now: string }>(
      "SELECT CURRENT_TIMESTAMP AS now",
    );
    const raw = row!.now;
    // The bug this guards against: local-time parsing is off by the zone offset.
    assert.ok(Math.abs(Date.now() - new Date(raw).getTime()) > 5 * 3600_000);
    assert.ok(Math.abs(Date.now() - db.dbTimestampMs(raw)) < 5_000);

    const at = Date.parse("2026-11-01T10:00:00.000Z");
    assert.equal(db.dbTimestampMs("2026-11-01 10:00:00"), at);
    assert.equal(db.dbTimestampMs("2026-11-01T10:00:00"), at);
    assert.equal(db.dbTimestampMs("2026-11-01 10:00:00.250"), at + 250);
    assert.equal(db.dbTimestampMs("2026-11-01T10:00:00.000Z"), at);
    assert.equal(db.dbTimestampMs("2026-11-01T15:30:00+05:30"), at);
    assert.equal(db.dbTimestampMs(new Date(at)), at);
    assert.ok(Number.isNaN(db.dbTimestampMs("not a time")));
  } finally {
    process.chdir(previousDirectory);
    process.env = previousEnv;
  }
});
