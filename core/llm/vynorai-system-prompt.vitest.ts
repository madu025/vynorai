import { describe, expect, test } from "vitest";

import { DEFAULT_AGENT_SYSTEM_MESSAGE } from "./defaultSystemMessages";
import { VYNORAI_XML_SYSTEM_PROMPT } from "./vynorai-system-prompt";

describe("VYNORAI_XML_SYSTEM_PROMPT", () => {
  test("requires scope to be inferred from the intended outcome", () => {
    expect(VYNORAI_XML_SYSTEM_PROMPT).toContain(
      "semantic task-scope assessment",
    );
    expect(VYNORAI_XML_SYSTEM_PROMPT).toContain(
      "Its first tool call must be update_todo_list",
    );
  });

  test("does not require a repository map for every task", () => {
    expect(DEFAULT_AGENT_SYSTEM_MESSAGE).toContain(
      "When a task needs broad exploration",
    );
    expect(DEFAULT_AGENT_SYSTEM_MESSAGE).toContain(
      "Skip it for a clearly bounded file or question",
    );
  });
});
