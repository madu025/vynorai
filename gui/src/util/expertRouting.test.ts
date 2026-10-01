import { inferExpertRoles } from "./expertRouting";

test("uses a compact default expert team", () => {
  expect(inferExpertRoles("rename a function")).toEqual([
    "Architect",
    "Engineer",
    "QA",
  ]);
});

test("routes only relevant specialist passes", () => {
  expect(
    inferExpertRoles("Deploy the React billing UI with PostgreSQL auth"),
  ).toEqual([
    "Architect",
    "Engineer",
    "Frontend",
    "Database",
    "Security",
    "DevOps",
    "QA",
  ]);
});
