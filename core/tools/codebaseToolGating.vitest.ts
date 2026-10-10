import { describe, expect, test } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { getConfigDependentToolDefinitions } from "./index";

const names = async (extra: {
  enableExperimentalTools: boolean;
  indexingEnabled?: boolean;
}) =>
  (
    await getConfigDependentToolDefinitions({
      rules: [],
      isRemote: false,
      modelName: "",
      ide: {} as any,
      ...extra,
    })
  ).map((t) => t.function.name);

describe("codebase tool", () => {
  test("is offered when the index is on", async () => {
    const list = await names({
      enableExperimentalTools: false,
      indexingEnabled: true,
    });
    expect(list).toContain(BuiltInToolNames.CodebaseTool);
    expect(list).not.toContain(BuiltInToolNames.ViewSubdirectory);
  });

  test("is not offered when indexing is off (no empty results, no schema tokens)", async () => {
    const list = await names({
      enableExperimentalTools: false,
      indexingEnabled: false,
    });
    expect(list).not.toContain(BuiltInToolNames.CodebaseTool);
  });

  test("experimental tools still enable both", async () => {
    const list = await names({ enableExperimentalTools: true });
    expect(list).toContain(BuiltInToolNames.CodebaseTool);
    expect(list).toContain(BuiltInToolNames.ViewSubdirectory);
  });
});
