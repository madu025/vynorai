import { describe, expect, it } from "vitest";
import { focusFirst } from "./generateRepoMap";

const ranked = [
  "src/core/db.ts",
  "app/Http/Controllers/UserController.php",
  "src/billing/invoice.ts",
  "app/Models/User.php",
  "src/billing/tax.ts",
];

describe("focusFirst", () => {
  it("keeps the importance order without a focus", () => {
    expect(focusFirst(ranked)).toEqual(ranked);
    expect(focusFirst(ranked, "  ")).toEqual(ranked);
  });

  it("puts the focus folder first, keeping order inside each group", () => {
    expect(focusFirst(ranked, "./app/Http/Controllers/")).toEqual([
      "app/Http/Controllers/UserController.php",
      "src/core/db.ts",
      "src/billing/invoice.ts",
      "app/Models/User.php",
      "src/billing/tax.ts",
    ]);
  });

  it("matches any feature word, case-insensitively and with Windows slashes", () => {
    expect(focusFirst(ranked, "Billing, user").slice(0, 4)).toEqual([
      "app/Http/Controllers/UserController.php",
      "src/billing/invoice.ts",
      "app/Models/User.php",
      "src/billing/tax.ts",
    ]);
    expect(focusFirst(ranked, "src\\billing")[0]).toBe(
      "src/billing/invoice.ts",
    );
  });
});
