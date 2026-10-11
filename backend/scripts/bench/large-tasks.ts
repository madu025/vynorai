/**
 * Large tasks. Each works on a copy of a real package and is scored by hidden
 * tests the fixture does not contain, the package's own suite and the type
 * check. `solve` is the reference solution, used only by --selfcheck.
 */
import fs from "node:fs";
import path from "node:path";

export interface LargeTask {
  id: string;
  size: "M" | "L" | "XL";
  type: "feature" | "rename" | "bugfix";
  lang: string;
  package: string;
  prompt: string;
  /** Files the reference solution changes, relative to the package. */
  refFiles: string[];
  hidden?: Record<string, string>;
  /** Patterns no TypeScript file may contain afterwards. */
  absent?: RegExp[];
  solve: (dir: string) => void;
}

const ADAPTERS = "packages/openai-adapters";

function edit(dir: string, rel: string, from: string | RegExp, to: string) {
  const full = path.join(dir, rel);
  const text = fs.readFileSync(full, "utf8");
  const next =
    typeof from === "string"
      ? text.replace(from, () => to)
      : text.replace(from, to);
  if (next === text) throw new Error(`reference edit did not apply: ${rel}`);
  fs.writeFileSync(full, next, "utf8");
}

const FETCH_USERS = [
  "src/apis/AiSdk.ts",
  "src/apis/Anthropic.ts",
  "src/apis/AskSage.ts",
  "src/apis/Azure.ts",
  "src/apis/Cohere.ts",
  "src/apis/DeepSeek.ts",
  "src/apis/Gemini.ts",
  "src/apis/Inception.ts",
  "src/apis/Jina.ts",
  "src/apis/LlamaStack.ts",
  "src/apis/Moonshot.ts",
  "src/apis/OpenAI.ts",
  "src/apis/Relace.ts",
  "src/apis/VertexAI.ts",
  "src/apis/WatsonX.ts",
  "src/test/customFetch-auth-override.vitest.ts",
  "src/util.ts",
];

export const LARGE_TASKS: LargeTask[] = [
  {
    id: "lg-add-provider",
    size: "L",
    type: "feature",
    lang: "en",
    package: ADAPTERS,
    prompt: `Add a new provider "vynor" to this package.

- New class VynorApi in src/apis/Vynor.ts, built on the OpenAI adapter like the other OpenAI-compatible providers.
- Default apiBase "https://vynor.lk/v1/" when the config has none; a configured apiBase wins.
- Every request carries the header "X-Vynor-Client: continue" in addition to the normal OpenAI headers.
- The LLMConfig type in src/types.ts accepts provider "vynor", through a schema like the other providers have.
- constructLlmApi returns a VynorApi for it, and VynorApi is exported from the package index.

Follow the conventions already used in the package. The type check and the existing tests must still pass.`,
    refFiles: ["src/apis/Vynor.ts", "src/index.ts", "src/types.ts"],
    hidden: {
      "src/test/vynor-provider.hidden.vitest.ts": `import { describe, expect, it } from "vitest";
import { constructLlmApi, VynorApi } from "../index.js";
import type { LLMConfig } from "../types.js";

// Checked by the type check: the config type must know the provider.
const config: LLMConfig = { provider: "vynor", apiKey: "k" };

describe("vynor provider", () => {
  it("is constructed with the default apiBase", () => {
    const api: any = constructLlmApi(config);
    expect(api).toBeInstanceOf(VynorApi);
    expect(api.config.apiBase).toBe("https://vynor.lk/v1/");
  });
  it("keeps a configured apiBase", () => {
    const api: any = constructLlmApi({ provider: "vynor", apiKey: "k", apiBase: "http://localhost:3000/v1/" } as any);
    expect(api.config.apiBase).toBe("http://localhost:3000/v1/");
  });
  it("sends the client header with the OpenAI headers", () => {
    const api: any = new VynorApi({ provider: "vynor", apiKey: "k" } as any);
    const headers = api.getHeaders();
    expect(headers["X-Vynor-Client"]).toBe("continue");
    expect(headers["Authorization"]).toBe("Bearer k");
  });
});
`,
    },
    solve(dir) {
      fs.writeFileSync(
        path.join(dir, "src/apis/Vynor.ts"),
        `import { VynorConfig } from "../types.js";
import { OpenAIApi } from "./OpenAI.js";

export class VynorApi extends OpenAIApi {
  constructor(config: VynorConfig) {
    super({
      ...config,
      provider: "openai",
      apiBase: config.apiBase ?? "https://vynor.lk/v1/",
    });
  }

  protected override getHeaders(): Record<string, string> {
    return { ...super.getHeaders(), "X-Vynor-Client": "continue" };
  }
}
`,
      );
      edit(
        dir,
        "src/types.ts",
        "export const BedrockConfigSchema",
        `export const VynorConfigSchema = OpenAIConfigSchema.extend({
  provider: z.literal("vynor"),
});
export type VynorConfig = z.infer<typeof VynorConfigSchema>;

export const BedrockConfigSchema`,
      );
      edit(
        dir,
        "src/types.ts",
        /  AiSdkConfigSchema,(\r?\n)\]\);/,
        "  AiSdkConfigSchema,$1  VynorConfigSchema,$1]);",
      );
      edit(
        dir,
        "src/index.ts",
        'import { WatsonXApi } from "./apis/WatsonX.js";',
        'import { WatsonXApi } from "./apis/WatsonX.js";\nimport { VynorApi } from "./apis/Vynor.js";',
      );
      edit(
        dir,
        "src/index.ts",
        '    case "mock":',
        '    case "vynor":\n      return new VynorApi(config);\n    case "mock":',
      );
      edit(
        dir,
        "src/index.ts",
        'export { AiSdkApi } from "./apis/AiSdk.js";',
        'export { AiSdkApi } from "./apis/AiSdk.js";\nexport { VynorApi } from "./apis/Vynor.js";',
      );
    },
  },
  {
    id: "lg-rename-fetch",
    size: "L",
    type: "rename",
    lang: "en",
    package: ADAPTERS,
    prompt: `Rename the exported function customFetch (src/util.ts) to createFetch everywhere in this package: the definition, every import, every call and the tests. Leave no alias and no remaining mention of the old name in any TypeScript file. Behaviour must not change. Finish with the type check and the tests passing.`,
    refFiles: FETCH_USERS,
    absent: [/\bcustomFetch\b/],
    hidden: {
      "src/test/create-fetch.hidden.vitest.ts": `import { expect, it } from "vitest";
import * as util from "../util.js";

it("exports createFetch and not customFetch", () => {
  expect(typeof (util as any).createFetch).toBe("function");
  expect((util as any).customFetch).toBeUndefined();
});
`,
    },
    solve(dir) {
      for (const rel of FETCH_USERS) {
        edit(dir, rel, /\bcustomFetch\b/g, "createFetch");
      }
    },
  },
  {
    id: "lg-fim-finish",
    size: "L",
    type: "bugfix",
    lang: "en",
    package: ADAPTERS,
    prompt: `Bug report: with the Moonshot provider, fill-in-the-middle streaming always reports finish_reason "stop" on the last chunk, even when the server sent "length". The server puts finish_reason inside choices[0], as the OpenAI format says.

Find the cause, fix it, and fix the same mistake in every other adapter of this package that has it. Do not change behaviour that is already correct.`,
    refFiles: [
      "src/apis/DeepSeek.ts",
      "src/apis/LlamaStack.ts",
      "src/apis/Moonshot.ts",
    ],
    hidden: {
      "src/test/fim-finish-reason.hidden.vitest.ts": `import { describe, expect, it, vi } from "vitest";

vi.mock("@continuedev/fetch", async () => {
  const actual = await vi.importActual<any>("@continuedev/fetch");
  return { ...actual, fetchwithRequestOptions: vi.fn() };
});

import { fetchwithRequestOptions } from "@continuedev/fetch";
import { constructLlmApi } from "../index.js";

const sse = (events: unknown[]) =>
  events.map((e) => "data: " + JSON.stringify(e) + "\\n\\n").join("") + "data: [DONE]\\n\\n";

async function lastFinishReason(provider: string, events: unknown[]) {
  (fetchwithRequestOptions as any).mockResolvedValue(new Response(sse(events)));
  const api: any = constructLlmApi({ provider, apiKey: "k" } as any);
  const chunks: any[] = [];
  for await (const c of api.fimStream(
    { model: "m", prompt: "a", suffix: "b", stream: true },
    new AbortController().signal,
  )) {
    chunks.push(c);
  }
  expect(chunks.length).toBe(2);
  return chunks[1].choices[0].finish_reason;
}

describe("fim finish_reason comes from choices[0]", () => {
  const text = [
    { choices: [{ text: "x", finish_reason: null }] },
    { choices: [{ text: "y", finish_reason: "length" }] },
  ];
  it("deepseek", async () => {
    expect(await lastFinishReason("deepseek", text)).toBe("length");
  });
  it("llamastack", async () => {
    expect(await lastFinishReason("llamastack", text)).toBe("length");
  });
  it("moonshot", async () => {
    expect(
      await lastFinishReason("moonshot", [
        { choices: [{ delta: { content: "x" }, finish_reason: null }] },
        { choices: [{ delta: { content: "y" }, finish_reason: "length" }] },
      ]),
    ).toBe("length");
  });
});
`,
    },
    solve(dir) {
      for (const rel of [
        "src/apis/DeepSeek.ts",
        "src/apis/LlamaStack.ts",
        "src/apis/Moonshot.ts",
      ]) {
        edit(
          dir,
          rel,
          "finish_reason: chunk.finish_reason,",
          "finish_reason: chunk.choices[0].finish_reason,",
        );
      }
    },
  },
];
