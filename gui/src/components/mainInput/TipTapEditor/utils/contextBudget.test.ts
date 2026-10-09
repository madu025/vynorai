import { beforeAll, describe, expect, it } from "vitest";

import type { ContextItemWithId } from "core";
import { countTokens } from "core/llm/countTokens";
import { ensureTokenizerLoaded } from "../../../../util/tokenCount";
import { applyContextBudget } from "./contextBudget";

// Production awaits the tokenizer before building a prompt (streamResponse).
beforeAll(() => ensureTokenizerLoaded());

function item(id: string, content: string): ContextItemWithId {
  return {
    id: { providerTitle: "test", itemId: id },
    name: id,
    description: id,
    content,
  };
}

describe("applyContextBudget", () => {
  it("preserves order while enforcing per-item and total token ceilings", () => {
    const result = applyContextBudget(
      [item("first", "a ".repeat(4_000)), item("second", "b ".repeat(4_000))],
      "gpt-4",
      1_000,
      700,
    );

    expect(result[0]?.name).toBe("first");
    expect(result[0]?.content).toContain("Context truncated");
    expect(
      result.reduce(
        (total, current) => total + countTokens(current.content, "gpt-4"),
        0,
      ),
    ).toBeLessThanOrEqual(1_000);
  });
});
