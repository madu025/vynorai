import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentConsentCard,
  emailSendCard,
  holidaysCard,
  personalColumns,
  removeResultsCard,
} from "./dialogCards.js";

test("the consent card follows the request and the real selection", () => {
  const card = agentConsentCard(
    {
      request: "Find outliers in the salary column of the staff list",
      rows: 301,
      columns: 6,
      sheet: "Staff",
      headers: ["Employee ID", "Full Name", "Email", "Phone", "Dept", "Salary"],
    },
    "en",
  );
  assert.match(card.title, /outliers/);
  assert.deepEqual(
    card.tiles.map((tile) => tile.value),
    ["301", "6", "Staff"],
  );
  const masked = card.tags.find((tag) => tag.warn);
  assert.match(masked!.text, /Name, Email, Phone/);
  assert.match(masked!.text, /\+1/);
});

test("the consent card says so when no column looks personal, and works without a selection", () => {
  const clean = agentConsentCard(
    { request: "chart", rows: 10, columns: 2, headers: ["Region", "Sales"] },
    "en",
  );
  assert.ok(clean.tags.some((tag) => /No personal columns/.test(tag.text)));
  const none = agentConsentCard({ request: "x".repeat(200) }, "si");
  assert.equal(none.tiles.length, 0);
  assert.ok(none.title.length <= 70);
  assert.deepEqual(personalColumns(["Region", "Mobile No"]), ["Mobile No"]);
});

test("the remove card names the real sheets and keeps the count", () => {
  const card = removeResultsCard(
    {
      sheets: [
        "A_Vynor_Result",
        "B_Vynor_Result",
        "C_Vynor_Result",
        "D_Vynor_Result",
      ],
      tables: ["T1"],
    },
    "ta",
    "Latest_Vynor_Result",
  );
  assert.deepEqual(
    card.tiles.map((tile) => tile.value),
    ["4", "1"],
  );
  assert.ok(card.tags.some((tag) => tag.text === "+1"));
  assert.ok(card.tags.some((tag) => /Latest_Vynor_Result/.test(tag.text)));
});

test("the holidays and e-mail cards carry their real figures", () => {
  const holidays = holidaysCard([2026, 2027], 22, "en");
  assert.deepEqual(
    holidays.tiles.map((tile) => tile.value),
    ["22", "2026, 2027"],
  );
  const mail = emailSendCard("a@b.lk", "October sales", "si");
  assert.equal(mail.title, "October sales");
  assert.equal(mail.tiles[0].value, "a@b.lk");
  assert.ok(mail.tags.some((tag) => tag.warn));
});
