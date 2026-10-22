import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRelationships, type RelationTable } from "./relationships.js";

const orders: RelationTable = {
  label: "Orders!A1:D7",
  headers: ["OrderID", "CustomerID", "Amount", "Date"],
  rows: [
    [1, "C1", 100.5, 45000],
    [2, "C2", 20.25, 45001],
    [3, "C1", 30.5, 45002],
    [4, "C3", 40.75, 45003],
    [5, "C9", 50.5, 45004],
    [6, "C2", 60.25, 45005],
  ],
};
const customers: RelationTable = {
  label: "Customers!A1:C4",
  headers: ["CustomerID", "Name", "Region"],
  rows: [
    ["C1", "Ann", "North"],
    ["C2", "Bo", "South"],
    ["C3", "Cy", "North"],
  ],
};

test("a two-sheet join is found, one customer to many orders, with the orphan counted", () => {
  const { links } = mapRelationships([orders, customers]);
  const link = links[0];
  assert.equal(link.from.column, "CustomerID");
  assert.equal(link.from.table, orders.label);
  assert.equal(link.cardinality, "many-to-one");
  assert.equal(link.fromRowsWithoutPartner, 1);
  assert.ok(link.advice.some((line) => /no partner/.test(line)));
});

test("a three-table chain links both pairs and not the unrelated ones", () => {
  const regions: RelationTable = {
    label: "Regions!A1:B3",
    headers: ["Region", "Manager"],
    rows: [
      ["North", "Dee"],
      ["South", "Eve"],
    ],
  };
  const { links } = mapRelationships([orders, customers, regions]);
  const pairs = links.map((l) => `${l.from.column}->${l.to.column}`);
  assert.ok(pairs.includes("CustomerID->CustomerID"));
  assert.ok(pairs.some((p) => p === "Region->Region"));
  assert.equal(links.some((l) => l.from.column === "Amount"), false);
});

test("a repeated key on the lookup side is called out", () => {
  const dup: RelationTable = {
    ...customers,
    rows: [...customers.rows, ["C1", "Ann again", "North"]],
  };
  const link = mapRelationships([orders, dup]).links[0];
  assert.ok(link.advice.some((line) => /repeat/.test(line)));
});

test("keys spelled differently match after cleaning and say so", () => {
  const messy: RelationTable = {
    label: "Messy!A1:B4",
    headers: ["Customer", "Tier"],
    rows: [
      [" c1 ", "Gold"],
      ["C2", "Silver"],
      ["c3", "Bronze"],
    ],
  };
  const link = mapRelationships([orders, messy]).links[0];
  assert.equal(link.needsCleaning, true);
  assert.ok(link.advice.some((line) => /clean them/.test(line)));
});

test("leading zeros stored as text on one side still match", () => {
  const a: RelationTable = {
    label: "A!A1:B3",
    headers: ["Ref", "X"],
    rows: [["001", 1], ["002", 2], ["003", 3]],
  };
  const b: RelationTable = {
    label: "B!A1:B3",
    headers: ["Ref", "Y"],
    rows: [[1, "a"], [2, "b"], [3, "c"]],
  };
  assert.equal(mapRelationships([a, b]).links[0].needsCleaning, true);
});

test("tables with nothing in common get no invented link", () => {
  const other: RelationTable = {
    label: "Other!A1:B3",
    headers: ["Code", "Label"],
    rows: [["Z1", "a"], ["Z2", "b"], ["Z3", "c"]],
  };
  const result = mapRelationships([orders, other]);
  assert.deepEqual(result.links, []);
  assert.match(result.note ?? "", /do not guess/);
});

test("two repeating categories with different names are not a join", () => {
  const a: RelationTable = {
    label: "A!A1:B5",
    headers: ["Area", "N"],
    rows: [["N", "a"], ["N", "b"], ["S", "c"], ["S", "d"]],
  };
  const b: RelationTable = {
    label: "B!A1:B5",
    headers: ["Zone", "M"],
    rows: [["N", "p"], ["N", "q"], ["S", "r"], ["S", "t"]],
  };
  assert.deepEqual(mapRelationships([a, b]).links, []);
});

test("measure columns such as amounts are never offered as keys", () => {
  const a: RelationTable = {
    label: "A!A1:A4",
    headers: ["Amount"],
    rows: [[1.5], [2.5], [3.5]],
  };
  const b: RelationTable = {
    label: "B!A1:A4",
    headers: ["Amount"],
    rows: [[1.5], [2.5], [3.5]],
  };
  assert.deepEqual(mapRelationships([a, b]).links, []);
});

test("one table or more than ten tables are refused", () => {
  assert.throws(() => mapRelationships([orders]), /at least two/);
  assert.throws(() => mapRelationships(Array(11).fill(orders)), /at most 10/);
});
