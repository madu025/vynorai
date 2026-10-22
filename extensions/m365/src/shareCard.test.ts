import assert from "node:assert/strict";
import test from "node:test";
import { buildShareCard, parsePastedCells } from "./shareCard.js";
import {
  deliverShare,
  shareOutcomeText,
  type ShareEnv,
} from "./shareDelivery.js";
import { WHATSAPP_MAX } from "./whatsappSummary.js";

const date = new Date(2026, 9, 22);
const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

test("cells copied from Excel (tab separated) become numbers and text", () => {
  const rows = parsePastedCells(
    "Region\tNet Amount\tShare\nWestern\t1,200,500\t12%\nCentral\tRs 96,400\t(5%)\nNorth\t4,500/=\t\n",
  );
  assert.deepEqual(rows[0], ["Region", "Net Amount", "Share"]);
  assert.deepEqual(rows[1], ["Western", 1200500, 0.12]);
  assert.deepEqual(rows[2], ["Central", 96400, -0.05]);
  assert.deepEqual(rows[3], ["North", 4500, null]);
});

test("ids with leading zeros, dates and formulas stay text", () => {
  const rows = parsePastedCells("007\t2026-01-05\t=SUM(A1:A3)\t-12.5");
  assert.deepEqual(rows[0], ["007", "2026-01-05", "=SUM(A1:A3)", -12.5]);
});

test("a CSV paste works, with quotes", () => {
  const rows = parsePastedCells('Name,Amount\n"Silva, K",1000\nPerera,2500');
  assert.deepEqual(rows, [
    ["Name", "Amount"],
    ["Silva, K", 1000],
    ["Perera", 2500],
  ]);
});

test("a paste is bounded and trailing empty rows and columns are dropped", () => {
  const big = Array.from({ length: 400 }, (_, i) => `a${i}\t${i}\t`).join("\n");
  const rows = parsePastedCells(`${big}\n\n`);
  assert.equal(rows.length, 200);
  assert.equal(rows[0].length, 2);
});

test("a dashboard gives its KPI cards and breakdown", () => {
  const card = buildShareCard(
    [
      ["Sales by Region"],
      ["subtitle"],
      [],
      ["RECORDS", "TOTAL SALES", "% OF TARGET"],
      [120, 4500000, 0.82],
      [],
      ["Region", "Sales"],
      ["Western", 3000000],
      ["Central", 1000000],
      ["North", 500000],
    ],
    { sheet: "Dashboard", symbol: "Rs", date },
  );
  assert.equal(card.kind, "dashboard");
  assert.equal(card.title, "Sales by Region");
  assert.deepEqual(
    card.tiles.map((tile) => tile.label),
    ["Records", "Total Sales", "% of Target"],
  );
  assert.equal(card.tiles[1].value, "Rs 4,500,000");
  assert.equal(card.tiles[2].value, "82%");
  assert.equal(card.bars[0].name, "Western");
  assert.equal(card.headline, "Western brings 67% of Sales.");
  assert.match(card.message, /Total Sales: \*Rs 4,500,000\*/);
  assert.ok(card.message.length <= WHATSAPP_MAX);
});

test("a plain table gives a total, a row count and the top groups", () => {
  const rows = parsePastedCells(
    "Order Date\tRegion\tNet Amount\tQty\n2026-01-05\tWestern\t182500\t40\n2026-01-12\tCentral\t96400\t22\n2026-02-02\tWestern\t203900\t51\n2026-02-09\tNorthern\t64800\t18",
  );
  const card = buildShareCard(rows, {
    sheet: "Orders",
    symbol: "Rs",
    date,
    source: "pasted",
  });
  assert.equal(card.kind, "table");
  assert.equal(card.title, "Pasted cells");
  assert.equal(card.subtitle, "Net Amount · Region");
  assert.equal(card.tiles[0].value, "Rs 547,600");
  assert.equal(card.tiles[1].value, "4");
  assert.equal(card.tiles[2].label, "Top Region");
  assert.equal(card.tiles[2].value, "Western · 71%");
  assert.deepEqual(
    card.bars.map((bar) => bar.name),
    ["Western", "Central", "Northern"],
  );
  assert.match(card.message, /From pasted cells \(VynorAI\)/);
  assert.match(card.message, /1\. Western: Rs 386,400/);
});

test("the measure is the money column, not the id or the quantity", () => {
  const rows = parsePastedCells(
    "Emp No\tName\tDepartment\tQty\tSalary\nE001\tNimal\tFinance\t3\t85000\nE002\tKamala\tSales\t5\t142000\nE003\tRuwan\tSales\t2\t260000",
  );
  const card = buildShareCard(rows, { sheet: "Staff", date });
  assert.equal(card.tiles[0].label, "Total Salary");
  assert.equal(card.tiles[2].label, "Top Department");
  assert.equal(card.bars[0].name, "Sales");
});

test("a list of names with one number each shows the names as bars", () => {
  const card = buildShareCard(
    parsePastedCells(
      "Name\tBasic\nNimal\t85000\nKamala\t142000\nRuwan\t260000",
    ),
    { sheet: "Staff", date },
  );
  assert.equal(card.kind, "table");
  assert.equal(card.bars.length, 3);
  assert.equal(card.bars[0].name, "Ruwan");
});

test("label and value pairs give tiles; nothing useful gives an empty card", () => {
  const pairs = buildShareCard(
    [
      ["Total", 1200],
      ["Tax", 180],
    ],
    { sheet: "Summary", date },
  );
  assert.equal(pairs.kind, "pairs");
  assert.deepEqual(pairs.tiles, [
    { label: "Total", value: "1,200" },
    { label: "Tax", value: "180" },
  ]);
  const empty = buildShareCard([["just words"]], { sheet: "Notes", date });
  assert.equal(empty.kind, "empty");
  assert.equal(empty.message, "");
});

test("the card is written in Sinhala and Tamil", () => {
  const rows = parsePastedCells(
    "Region\tSales\nWestern\t300\nCentral\t100\nNorth\t50",
  );
  const si = buildShareCard(rows, {
    sheet: "S",
    date,
    language: "si",
    source: "pasted",
  });
  const ta = buildShareCard(rows, {
    sheet: "S",
    date,
    language: "ta",
    source: "pasted",
  });
  assert.match(si.headline, SINHALA);
  assert.match(si.title, SINHALA);
  assert.match(si.footer, SINHALA);
  assert.match(ta.headline, TAMIL);
  assert.match(ta.tiles[1].label, TAMIL);
  assert.match(ta.footer, TAMIL);
});

test("WhatsApp formatting characters in cell text do not change the message", () => {
  const card = buildShareCard(
    parsePastedCells("Region\tSales\n*Bold*\t300\n_it_\t100\nNorth\t50"),
    { sheet: "S", date },
  );
  assert.doesNotMatch(card.message, /\*Bold\*|_it_/);
});

const image = new Blob(["png"], { type: "image/png" });
const fake = (over: Partial<ShareEnv> = {}) => {
  const calls: string[] = [];
  const env: ShareEnv = {
    preferShare: false,
    share: async () => void calls.push("share"),
    canShare: () => true,
    writeClipboard: async (items) =>
      void calls.push(`clip:${Object.keys(items[0]).join("+")}`),
    writeText: async () => void calls.push("text"),
    execCopy: () => (calls.push("exec"), true),
    ...over,
  };
  return { env, calls };
};

test("a computer copies the picture and the text for Ctrl+V in WhatsApp", async () => {
  const { env, calls } = fake();
  assert.equal(await deliverShare(image, "hello", env), "image-copied");
  assert.deepEqual(calls, ["clip:image/png+text/plain"]);
});

test("a phone opens the share sheet first", async () => {
  const { env, calls } = fake({ preferShare: true });
  assert.equal(await deliverShare(image, "hello", env), "shared");
  assert.deepEqual(calls, ["share"]);
});

test("a cancelled share sheet is not an error and nothing else is tried", async () => {
  const { env, calls } = fake({
    preferShare: true,
    share: async () => {
      throw Object.assign(new Error("x"), { name: "AbortError" });
    },
  });
  assert.equal(await deliverShare(image, "hello", env), "cancelled");
  assert.deepEqual(calls, []);
});

test("a browser that refuses the text type copies the picture alone", async () => {
  const seen: string[] = [];
  const { env } = fake({
    writeClipboard: async (items) => {
      seen.push(Object.keys(items[0]).join("+"));
      if (Object.keys(items[0]).length > 1) throw new Error("refused");
    },
  });
  assert.equal(await deliverShare(image, "hello", env), "image-copied");
  assert.deepEqual(seen, ["image/png+text/plain", "image/png"]);
});

test("without a clipboard picture the text is copied, then the old copy command", async () => {
  const noImage = fake({ writeClipboard: undefined });
  assert.equal(await deliverShare(image, "hello", noImage.env), "text-copied");
  assert.deepEqual(noImage.calls, ["text"]);
  const old = fake({
    writeClipboard: undefined,
    writeText: async () => {
      throw new Error("denied");
    },
  });
  assert.equal(await deliverShare(image, "hello", old.env), "text-copied");
  assert.deepEqual(old.calls, ["exec"]);
  const none = fake({
    writeClipboard: undefined,
    writeText: undefined,
    execCopy: () => false,
    share: undefined,
  });
  assert.equal(await deliverShare(image, "hello", none.env), "failed");
});

test("every outcome has a sentence in all three languages", () => {
  for (const outcome of [
    "shared",
    "image-copied",
    "text-copied",
    "cancelled",
    "failed",
  ] as const) {
    assert.ok(shareOutcomeText(outcome, "en"));
    assert.match(shareOutcomeText(outcome, "si"), SINHALA);
    assert.match(shareOutcomeText(outcome, "ta"), TAMIL);
  }
});

test("a date column is never the group, even when Region repeats little", () => {
  const card = buildShareCard(
    parsePastedCells(
      "Order Date\tRegion\tNet Amount\n2026-01-05\tWestern\t182500\n2026-01-12\tCentral\t96400\n2026-02-02\tWestern\t203900\n2026-02-09\tNorthern\t64800\n2026-02-16\tSouthern\t75200",
    ),
    { sheet: "Orders", source: "pasted" },
  );
  assert.match(card.tiles[2].label, /Region/);
  assert.match(card.headline, /^Western brings/);
});
