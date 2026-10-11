import { describe, expect, it, vi } from "vitest";
import { resolveConfigJsonSecrets } from "./resolveSecretRefs";

const REF = "${{ secrets.VYNORAI_API_KEY }}";
const ide = (secrets: Record<string, string>) =>
  ({
    readSecrets: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys.filter((k) => k in secrets).map((k) => [k, secrets[k]]),
      ),
    ),
  }) as never;

describe("resolveConfigJsonSecrets", () => {
  it("replaces a secret reference with the stored value", async () => {
    const out = await resolveConfigJsonSecrets(
      { models: [{ apiKey: REF }, { apiKey: "sk-literal" }, {}] },
      ide({ VYNORAI_API_KEY: "vynor_live_x" }),
    );
    expect(out.models).toEqual([
      { apiKey: "vynor_live_x" },
      { apiKey: "sk-literal" },
      {},
    ]);
  });

  it("does not mutate the loaded config", async () => {
    const input = { models: [{ apiKey: REF }] };
    await resolveConfigJsonSecrets(input, ide({ VYNORAI_API_KEY: "k" }));
    expect(input.models[0].apiKey).toBe(REF);
  });

  it("covers the autocomplete model, single or list", async () => {
    const store = ide({ VYNORAI_API_KEY: "k" });
    const one = await resolveConfigJsonSecrets(
      { tabAutocompleteModel: { apiKey: REF } },
      store,
    );
    expect(one.tabAutocompleteModel).toEqual({ apiKey: "k" });
    const many = await resolveConfigJsonSecrets(
      { tabAutocompleteModel: [{ apiKey: REF }] },
      store,
    );
    expect(many.tabAutocompleteModel).toEqual([{ apiKey: "k" }]);
  });

  it("keeps the reference when the secret is missing or the store fails", async () => {
    const missing = await resolveConfigJsonSecrets(
      { models: [{ apiKey: REF }] },
      ide({}),
    );
    expect(missing.models).toEqual([{ apiKey: REF }]);
    const broken = {
      readSecrets: vi.fn().mockRejectedValue(new Error("no store")),
    } as never;
    const out = await resolveConfigJsonSecrets(
      { models: [{ apiKey: REF }] },
      broken,
    );
    expect(out.models).toEqual([{ apiKey: REF }]);
  });

  it("does not ask the store when nothing references a secret", async () => {
    const store = ide({});
    await resolveConfigJsonSecrets({ models: [{ apiKey: "sk" }] }, store);
    expect((store as any).readSecrets).not.toHaveBeenCalled();
  });
});
