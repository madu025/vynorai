import { describe, expect, test } from "vitest";

import { VYNORAI_XML_SYSTEM_PROMPT } from "./vynorai-system-prompt";

describe("VYNORAI_XML_SYSTEM_PROMPT", () => {
  test("requires scope to be inferred from the intended outcome", () => {
    expect(VYNORAI_XML_SYSTEM_PROMPT).toContain(
      "Infer the work needed to achieve the user's intended outcome",
    );
    expect(VYNORAI_XML_SYSTEM_PROMPT).toContain(
      "complete e-commerce website for my clothing shop",
    );
  });
});
