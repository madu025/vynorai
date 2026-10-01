const PROJECT_OVERVIEW_TERMS =
  /\b(project|repo|repository|codebase|workspace|architecture|application|app structure|system design)\b/i;

export type AutomaticProjectContext = {
  codebase: boolean;
  tree: boolean;
  codebaseQuery?: string;
};

const PROJECT_OVERVIEW_RETRIEVAL_HINT =
  "Identify this project's architecture, entry points, frameworks, configuration, important modules, tests, security boundaries, and likely maintenance gaps.";

/**
 * The first IDE prompt should be project-aware without forcing users to know
 * about @codebase. A tree is reserved for explicit project-level questions;
 * The English retrieval hint improves recall when the user's prompt is written
 * in another language while the repository identifiers are mostly English.
 */
export function getAutomaticProjectContext(
  input: string,
  userMessageCount: number,
  hasExplicitProjectContext: boolean,
): AutomaticProjectContext {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (
    userMessageCount > 1 ||
    hasExplicitProjectContext ||
    normalized.length < 4
  ) {
    return { codebase: false, tree: false };
  }

  const isProjectOverview = PROJECT_OVERVIEW_TERMS.test(normalized);

  return {
    codebase: true,
    tree: isProjectOverview,
    codebaseQuery: isProjectOverview
      ? `${normalized}\n\n${PROJECT_OVERVIEW_RETRIEVAL_HINT}`
      : normalized,
  };
}
