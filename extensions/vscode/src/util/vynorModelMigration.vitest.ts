import { describe, expect, it } from "vitest";
import { isSeq, parseDocument } from "yaml";

import {
  VYNOR_CLIENT_CONTEXT_LENGTH,
  migrateVynorModels,
} from "./vynorModelMigration";

// Shape of a real config written by older extension versions.
const OLD_CONFIG = `
models:
  - name: VynorAI Auto
    provider: vynorai
    model: vynor-auto
    roles: [chat, edit, apply, subagent]
  - name: "VynorAI DeepSeek V3 (Coding)"
    provider: vynorai
    model: deepseek/deepseek-chat-v3-0324
    roles: [chat, edit, apply, subagent]
  - name: "VynorAI DeepSeek R1 (Reasoning)"
    provider: vynorai
    model: deepseek/deepseek-r1
    roles: [chat, subagent]
  - name: "VynorAI Qwen 2.5 Coder 32B"
    provider: vynorai
    model: qwen/qwen-2.5-coder-32b-instruct
    roles: [chat, edit, subagent]
  - name: "VynorAI Llama 3.3 70B Instruct"
    provider: vynorai
    model: meta-llama/llama-3.3-70b-instruct
    roles: [chat, edit, subagent]
  - name: "VynorAI Claude 3.7 Sonnet"
    provider: vynorai
    model: anthropic/claude-3.7-sonnet
    roles: [chat, edit, subagent]
  - name: "VynorAI Autocomplete (FIM)"
    provider: vynorai
    model: deepseek/deepseek-coder-v2
    roles: [autocomplete, subagent]
  - name: My local Ollama
    provider: ollama
    model: qwen/qwen-2.5-coder
    roles: [chat]
`;

function migrate(yaml: string) {
  const doc = parseDocument(yaml);
  const models = doc.get("models", true);
  if (!isSeq(models)) throw new Error("no models");
  migrateVynorModels(
    doc,
    models,
    undefined,
    "${{ secrets.VYNOR }}",
    "https://vynor.lk/v1",
  );
  return (doc.toJSON().models as Array<Record<string, any>>).map((m) => ({
    name: m.name,
    model: m.model,
    roles: m.roles,
  }));
}

describe("VynorAI model migration", () => {
  it("moves an old model list to Auto / V4.1 Flash / V4 Pro and keeps other providers", () => {
    const out = migrate(OLD_CONFIG);
    expect(out.map((m) => m.model)).toEqual([
      "vynor-auto",
      "deepseek/deepseek-flash", // was V3
      "anthropic/claude-3.7-sonnet", // plan-gated premium model, kept
      "deepseek/deepseek-flash", // autocomplete, was Coder V2
      "qwen/qwen-2.5-coder", // another provider: untouched
      "deepseek/deepseek-v4-pro", // added
    ]);
    expect(out[1].name).toBe("VynorAI DeepSeek V4.1 Flash");
    // Autocomplete keeps its role but is no longer a subagent.
    expect(out[3].roles).toEqual(["autocomplete"]);
  });

  it("raises only the untouched legacy 64000 client window, so the backend owns compaction", () => {
    const yaml = `
models:
  - name: VynorAI Auto
    provider: vynorai
    model: vynor-auto
    roles: [chat, edit]
    defaultCompletionOptions: { contextLength: 64000, maxTokens: 16384 }
  - name: User chosen
    provider: vynorai
    model: deepseek/deepseek-flash
    roles: [chat]
    defaultCompletionOptions: { contextLength: 48000 }
  - name: VynorAI Autocomplete (FIM)
    provider: vynorai
    model: deepseek/deepseek-flash
    roles: [autocomplete]
    defaultCompletionOptions: { contextLength: 16000 }
`;
    const doc = parseDocument(yaml);
    const models = doc.get("models", true);
    if (!isSeq(models)) throw new Error("no models");
    migrateVynorModels(doc, models, undefined, "k", "https://vynor.lk/v1");
    const out = doc.toJSON().models as Array<Record<string, any>>;
    const length = (name: string) =>
      out.find((m) => m.name === name)?.defaultCompletionOptions?.contextLength;
    expect(length("VynorAI Auto")).toBe(VYNOR_CLIENT_CONTEXT_LENGTH);
    expect(length("User chosen")).toBe(48000);
    expect(length("VynorAI Autocomplete (FIM)")).toBe(16000);
    // Models added by the migration use the same window.
    expect(length("VynorAI DeepSeek V4 Pro")).toBe(VYNOR_CLIENT_CONTEXT_LENGTH);
  });

  it("is idempotent", () => {
    const once = parseDocument(OLD_CONFIG);
    const models = once.get("models", true);
    if (!isSeq(models)) throw new Error("no models");
    migrateVynorModels(once, models, undefined, "k", "https://vynor.lk/v1");
    const first = once.toString();
    expect(migrate(first)).toEqual(migrate(first));
    expect(migrate(first).map((m) => m.model)).toEqual(
      migrate(OLD_CONFIG).map((m) => m.model),
    );
  });
});
