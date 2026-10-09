import { describe, expect, it } from "vitest";

import { upsertVynorJsonModels } from "./vynorModelMigration";

const BASE = "https://vynor.lk/v1";
const REF = "${{ secrets.VYNORAI_API_KEY }}";
const auto = {
  title: "VynorAI Auto",
  provider: "vynorai",
  model: "vynor-auto",
  apiBase: BASE,
  apiKey: REF,
};
const coder = {
  title: "VynorAI Coder",
  provider: "vynorai",
  model: "deepseek/deepseek-flash",
  apiBase: BASE,
  apiKey: REF,
};

describe("upsertVynorJsonModels", () => {
  it("builds Auto then Coder from an empty list", () => {
    expect(upsertVynorJsonModels([], auto, coder)).toEqual([auto, coder]);
  });

  it("is idempotent: running it again never grows the list", () => {
    let models: any[] = [];
    for (let run = 0; run < 25; run++) {
      models = upsertVynorJsonModels(models, auto, coder) as any[];
    }
    expect(models).toEqual([auto, coder]);
  });

  it("does not turn the Auto entry into a Coder (the old apiBase match)", () => {
    const next = upsertVynorJsonModels([auto, coder], auto, coder);
    expect(next.filter((m: any) => m.model === "vynor-auto")).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it("heals a list the old bug grew: 140 entries collapse to Auto and Coder", () => {
    const grown: any[] = [auto];
    for (let i = 0; i < 135; i++) grown.push({ ...coder });
    for (let i = 0; i < 4; i++)
      grown.push({ ...coder, model: "deepseek/deepseek-chat-v3-0324" });
    expect(grown).toHaveLength(140);

    const healed = upsertVynorJsonModels(grown, auto, coder);
    expect(healed).toEqual([auto, coder]);
  });

  it("keeps models from other providers and other VynorAI titles untouched", () => {
    const ollama = { title: "Local", provider: "ollama", model: "llama3" };
    const other = {
      title: "VynorAI DeepSeek V4 Pro",
      provider: "vynorai",
      model: "deepseek/deepseek-v4-pro",
      apiBase: BASE,
      apiKey: REF,
    };
    const next = upsertVynorJsonModels([ollama, other], auto, coder);
    expect(next).toEqual([auto, coder, ollama, other]);
    // and a repeat run keeps them exactly once
    expect(upsertVynorJsonModels(next as any[], auto, coder)).toEqual(next);
  });

  it("updates an existing Coder in place (new key reference, same position)", () => {
    const stale = {
      ...coder,
      apiKey: "old",
      apiBase: "https://old.example/v1",
    };
    const ollama = { title: "Local", provider: "ollama", model: "llama3" };
    expect(upsertVynorJsonModels([ollama, stale], auto, coder)).toEqual([
      auto,
      ollama,
      coder,
    ]);
  });
});
