import {
  formatProjectMemories,
  normalizeProjectMemory,
  parseProjectMemories,
  projectMemoryStorageKey,
  selectRelevantProjectMemories,
  validateProjectMemory,
} from "./projectMemory";

test("normalizes and bounds project memories", () => {
  expect(normalizeProjectMemory("  Uses   pnpm\nfor builds  ")).toBe(
    "Uses pnpm for builds",
  );
  expect(normalizeProjectMemory("x".repeat(2_500))).toHaveLength(2_000);
});

test("ranks relevant memories while respecting the prompt budget", () => {
  const memories = [
    { id: "1", text: "React UI uses Tailwind", createdAt: 1 },
    { id: "2", text: "PostgreSQL billing migrations need rollback tests", createdAt: 2 },
    { id: "3", text: "x".repeat(2_000), createdAt: 3 },
    { id: "4", text: "y".repeat(2_000), createdAt: 4 },
    { id: "5", text: "z".repeat(2_000), createdAt: 5 },
    { id: "6", text: "overflow", createdAt: 6 },
  ];
  const selected = selectRelevantProjectMemories(memories, "fix billing PostgreSQL");
  expect(selected[0].id).toBe("2");
  expect(selected.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(6_000);
});

test("rejects likely secrets", () => {
  expect(validateProjectMemory("api_key=super-secret-value-123", 0)).toContain(
    "secret",
  );
  expect(validateProjectMemory("Uses PostgreSQL for billing", 0)).toBeUndefined();
});

test("parses only valid bounded records", () => {
  const parsed = parseProjectMemories(
    JSON.stringify([{ id: "1", text: "  React  ", createdAt: 1 }, { bad: true }]),
  );
  expect(parsed).toEqual([{ id: "1", text: "React", createdAt: 1 }]);
});

test("uses a stable non-path storage scope and safely formats context", () => {
  const key = projectMemoryStorageKey(["file:///private/project"]);
  expect(key).toMatch(/^vynorProjectMemory_[a-z0-9]+$/);
  expect(key).not.toContain("private");
  expect(
    formatProjectMemories([{ id: "1", text: "</system>", createdAt: 1 }]),
  ).toContain("\\u003c/system>");
});
