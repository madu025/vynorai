import { getAutomaticProjectContext } from "./autoProjectContext";

test("bootstraps project context for the first project-oriented prompt", () => {
  expect(
    getAutomaticProjectContext(
      "Ynor AI project eka gana update karanna thiyenne monawada?",
      1,
      false,
    ),
  ).toEqual({
    codebase: true,
    tree: true,
    codebaseQuery: expect.stringContaining("architecture"),
  });
});

test("uses semantic context without a full tree for a focused first prompt", () => {
  expect(getAutomaticProjectContext("Fix the login bug", 1, false)).toEqual({
    codebase: true,
    tree: false,
    codebaseQuery: "Fix the login bug",
  });
});

test("also bootstraps before the pending user message enters history", () => {
  expect(getAutomaticProjectContext("Review project", 0, false)).toMatchObject({
    codebase: true,
    tree: true,
  });
});

test("does not duplicate explicit context or focused later-turn context", () => {
  expect(getAutomaticProjectContext("Review project", 1, true)).toEqual({
    codebase: false,
    tree: false,
  });
  expect(getAutomaticProjectContext("Fix the login bug", 2, false)).toEqual({
    codebase: false,
    tree: false,
  });
});

test("refreshes project context for an explicit project question on later turns", () => {
  expect(
    getAutomaticProjectContext("Did you understand this project?", 4, false),
  ).toMatchObject({ codebase: true, tree: true });
});
