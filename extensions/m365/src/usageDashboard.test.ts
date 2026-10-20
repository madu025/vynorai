import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageAccumulator, normalizeUnit } from "./usageDashboard.js";
import { buildUsageLayout } from "./usageLayout.js";

test("length units are converted to km and other units stay apart", () => {
  assert.deepEqual(normalizeUnit("m"), { label: "km", factor: 0.001 });
  assert.deepEqual(normalizeUnit("KM"), { label: "km", factor: 1 });
  assert.deepEqual(normalizeUnit("Ea"), { label: "Ea", factor: 1 });
  assert.deepEqual(normalizeUnit(" "), { label: "(no unit)", factor: 1 });
});

const feed = () => {
  const acc = new UsageAccumulator();
  // circuit, item, quantity, unit
  acc.add("0112097342", "OSPACC011", 10, "Ea");
  acc.add("0112097342", "OSPACC017", 5, "Ea");
  acc.add("0112097342", "OSPFTA003", 0.2, "km");
  acc.add("0112097342", "OSPFTA003", 300, "m");
  acc.add("0472258889", "OSPACC011", 20, "Ea");
  acc.add("0472258889", "OSPACC011", 1, "Ea");
  acc.add("0332227745", "OSPFTA005", 14, "Ea");
  acc.add("", "OSPACC011", 4, "Ea"); // no circuit: skipped
  acc.add("0332227745", "OSPFTA005", "abc", "Ea"); // not a number: skipped
  acc.add("0332227745", "OSPFTA005", "", "Ea"); // blank quantity: skipped
  return acc;
};

test("totals per unit are never mixed and metres are added to kilometres", () => {
  const result = feed().finish(10);
  assert.equal(result.entities, 3);
  assert.equal(result.items, 4);
  assert.equal(result.lines, 7);
  assert.equal(result.skipped, 3);
  const ea = result.units.find((u) => u.label === "Ea");
  const km = result.units.find((u) => u.label === "km");
  assert.equal(ea?.total, 50);
  assert.equal(km?.total, 0.5);
  assert.deepEqual(km?.raw.map((entry) => entry.text).sort(), ["km", "m"]);
});

test("top tables are ranked per unit and by distinct items, ties by name", () => {
  const result = feed().finish(2);
  assert.deepEqual(
    result.topByUnit.Ea.map((row) => [row.entity, row.quantity]),
    [
      ["0472258889", 21],
      ["0112097342", 15],
    ],
  );
  assert.deepEqual(
    result.topByUnit.km.map((row) => row.entity),
    ["0112097342"],
  );
  assert.deepEqual(result.topByItems[0], { entity: "0112097342", items: 3 });
});

test("an identifier keeps its leading zeros and numbers given as text are read", () => {
  const acc = new UsageAccumulator();
  acc.add("007", "A", "1,250.5", "Ea");
  const result = acc.finish();
  assert.equal(result.topByUnit.Ea[0].entity, "007");
  assert.equal(result.topByUnit.Ea[0].quantity, 1250.5);
});

test("the layout has live KPI and lookup formulas, text ids, a snapshot note and one chart per unit", () => {
  const result = feed().finish(10);
  const layout = buildUsageLayout(
    result,
    {
      entityName: "Circuit ID",
      itemName: "Item Code",
      quantityName: "Issued Quantity",
      entity: "'detail'!$J$2:$J$100",
      item: "'detail'!$F$2:$F$100",
      quantity: "'detail'!$H$2:$H$100",
      unit: "'detail'!$I$2:$I$100",
    },
    "on 20 Oct 2026",
  );
  const all = layout.blocks.flatMap((block) => block.cells.flat()).map(String);
  assert.ok(
    all.some((cell) =>
      /^=COUNTA\(UNIQUE\(FILTER\('detail'!\$J\$2:\$J\$100/.test(cell),
    ),
  );
  assert.ok(
    all.some((cell) =>
      cell.includes(
        "SUM(FILTER('detail'!$H$2:$H$100,('detail'!$J$2:$J$100=$B$8)*",
      ),
    ),
  );
  assert.ok(
    all.some(
      (cell) =>
        cell.startsWith("=IFERROR(") && cell.includes("0.001*SUM(FILTER"),
    ),
  );
  assert.ok(all.includes("0472258889"));
  assert.equal(layout.charts.length, 2); // Ea and km
  assert.match(layout.note, /never added together/);
  assert.match(layout.note, /3 rows/);
  const lookupInput = layout.blocks.find((block) => block.style === "input");
  assert.equal(lookupInput?.text, true);
  assert.equal(lookupInput?.cells[0][0], "0472258889");
});

test("without a unit column the totals are plain sums and there is one chart", () => {
  const acc = new UsageAccumulator();
  acc.add("A", "x", 3);
  acc.add("A", "y", 4);
  const layout = buildUsageLayout(
    acc.finish(),
    {
      entityName: "Customer",
      itemName: "Product",
      quantityName: "Qty",
      entity: "S!$A$2:$A$9",
      item: "S!$B$2:$B$9",
      quantity: "S!$C$2:$C$9",
    },
    "today",
  );
  const all = layout.blocks.flatMap((block) => block.cells.flat()).map(String);
  assert.ok(all.includes("=SUM(S!$C$2:$C$9)"));
  assert.equal(layout.charts.length, 1);
});
