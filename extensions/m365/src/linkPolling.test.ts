import assert from "node:assert/strict";
import test from "node:test";
import {
  LINK_POLL_INTERVAL_MS,
  LINK_POLL_MAX_ATTEMPTS,
  checkLinkStatus,
  linkPollOutcome,
  secondsUntil,
} from "./linkPolling.js";

test("a linked answer ends the wait, an expired one stops it, anything else keeps waiting", () => {
  assert.equal(linkPollOutcome({ linked: true, state: "linked" }), "linked");
  assert.equal(linkPollOutcome({ linked: true }), "linked");
  assert.equal(linkPollOutcome({ linked: false, state: "expired" }), "expired");
  assert.equal(
    linkPollOutcome({ linked: false, state: "pending" }),
    "continue",
  );
  assert.equal(linkPollOutcome({ linked: false, state: "none" }), "continue");
  assert.equal(linkPollOutcome({ linked: false }), "continue");
});

test("polling is bounded by the lifetime of the code", () => {
  assert.equal(LINK_POLL_INTERVAL_MS, 2000);
  const totalMs = LINK_POLL_INTERVAL_MS * LINK_POLL_MAX_ATTEMPTS;
  assert.ok(totalMs <= 10 * 60_000, "never longer than the ten-minute code");
  assert.ok(totalMs >= 2 * 60_000, "long enough for a sign-in round trip");
});

test("the countdown never goes negative and treats a bad date as expired", () => {
  const now = Date.parse("2026-10-25T10:00:00.000Z");
  assert.equal(secondsUntil("2026-10-25T10:10:00.000Z", now), 600);
  assert.equal(secondsUntil("2026-10-25T10:00:00.400Z", now), 1);
  assert.equal(secondsUntil("2026-10-25T09:59:00.000Z", now), 0);
  assert.equal(secondsUntil("not a date", now), 0);
});

const coded = (code: string) => Object.assign(new Error(code), { code });

test("a transient status failure is retried once, then skipped so the poll keeps waiting", async () => {
  let calls = 0;
  const state = await checkLinkStatus(
    async () => {
      calls += 1;
      if (calls === 1) throw coded("HTTP_502");
      return { linked: true, state: "linked" as const };
    },
    { wait: async () => {} },
  );
  assert.equal(calls, 2);
  assert.equal(state?.linked, true);

  let always = 0;
  const skipped = await checkLinkStatus(
    async () => {
      always += 1;
      throw coded("NETWORK_ERROR");
    },
    { wait: async () => {} },
  );
  assert.equal(skipped, undefined);
  assert.equal(always, 2);
});

test("a refusal (expired sign-in) is not swallowed by the status check", async () => {
  await assert.rejects(
    checkLinkStatus(
      async () => {
        throw coded("HTTP_401");
      },
      { wait: async () => {} },
    ),
  );
});
