import { parseDocument } from "yaml";

// Older ids the backend now serves with DeepSeek V4.1 Flash.
const LEGACY_FLASH_MODEL =
  /^(deepseek\/)?deepseek-(coder(-v2)?|chat(-v3[-\w]*)?|v3|v4-flash)$/i;
// Models no longer offered: R1 is replaced by Flash/Pro thinking, and the
// open models are both weaker than Flash and not served without OpenRouter.
const RETIRED_MODEL =
  /^((deepseek\/)?deepseek-(r1|reasoner)|qwen\/|meta-llama\/)/i;
const FLASH_MODEL = "deepseek/deepseek-flash";
const PRO_MODEL = "deepseek/deepseek-v4-pro";

type YamlDoc = ReturnType<typeof parseDocument>;

function isVynorEntry(m: Record<string, unknown> | undefined): boolean {
  return (
    m?.provider === "vynorai" ||
    (typeof m?.apiBase === "string" && m.apiBase.includes("vynor.lk"))
  );
}

/**
 * Rewrite a config's VynorAI models to Auto / V4.1 Flash / V4 Pro: legacy
 * DeepSeek ids become Flash, retired models are removed, and Flash and Pro
 * are added if missing. Models from other providers are never touched.
 */
export function migrateVynorModels(
  document: YamlDoc,
  models: { items: unknown[] },
  localBase: string | undefined,
  apiKeyRef: string,
  prodUrl: string,
): void {
  const json = (item: unknown) =>
    (item as { toJSON?: () => unknown } | null)?.toJSON?.() as
      | Record<string, unknown>
      | undefined;

  for (let i = models.items.length - 1; i >= 0; i--) {
    const m = json(models.items[i]);
    if (!isVynorEntry(m)) continue;
    const id = String(m!.model ?? "");
    const roles = Array.isArray(m!.roles) ? (m!.roles as string[]) : [];
    const chat = roles.includes("chat");
    if (RETIRED_MODEL.test(id) && chat) {
      models.items.splice(i, 1);
      continue;
    }
    if (LEGACY_FLASH_MODEL.test(id)) {
      document.setIn(["models", i, "model"], FLASH_MODEL);
      if (chat)
        document.setIn(["models", i, "name"], "VynorAI DeepSeek V4.1 Flash");
    }
    // Autocomplete-only models must not be offered as subagents.
    if (!chat && roles.includes("subagent")) {
      document.setIn(
        ["models", i, "roles"],
        roles.filter((r) => r !== "subagent"),
      );
    }
  }

  // Keep one chat entry per model (a renamed V3 may duplicate Flash).
  const seen = new Set<string>();
  for (let i = 0; i < models.items.length; i++) {
    const m = json(models.items[i]);
    if (!isVynorEntry(m)) continue;
    const roles = Array.isArray(m!.roles) ? (m!.roles as string[]) : [];
    if (!roles.includes("chat")) continue;
    const id = String(m!.model ?? "");
    if (seen.has(id)) {
      models.items.splice(i--, 1);
      continue;
    }
    seen.add(id);
  }

  const apiBase = localBase ?? `${prodUrl}/`;
  if (!seen.has(FLASH_MODEL)) {
    models.items.push(
      document.createNode({
        name: "VynorAI DeepSeek V4.1 Flash",
        provider: "vynorai",
        model: FLASH_MODEL,
        apiBase,
        apiKey: apiKeyRef,
        roles: ["chat", "edit", "apply", "subagent"],
        defaultCompletionOptions: { contextLength: 64000, maxTokens: 8192 },
        capabilities: ["tool_use", "image_input"],
      }),
    );
  }
  if (!seen.has(PRO_MODEL)) {
    models.items.push(
      document.createNode({
        name: "VynorAI DeepSeek V4 Pro",
        provider: "vynorai",
        model: PRO_MODEL,
        apiBase,
        apiKey: apiKeyRef,
        roles: ["chat", "edit"],
        defaultCompletionOptions: { contextLength: 64000, maxTokens: 16384 },
        capabilities: ["tool_use"],
      }),
    );
  }
}

export interface JsonVynorModel {
  title: string;
  provider: string;
  model: string;
  apiBase: string;
  apiKey: string;
}

/**
 * Keeps a config.json "models" list at exactly one "VynorAI Auto" (first) and
 * one "VynorAI Coder", without ever replacing or duplicating entries on a
 * repeat run. The old code matched any entry whose apiBase contained
 * "vynor.lk" (Auto included), overwrote it with Coder and then added a new
 * Auto, so every activation grew the list by one entry (135 duplicates seen).
 * Identical entries left by that bug are collapsed here as well.
 */
export function upsertVynorJsonModels<T extends Record<string, any>>(
  models: T[],
  auto: JsonVynorModel,
  coder: JsonVynorModel,
): Array<T | JsonVynorModel> {
  // 1. Heal lists the bug already grew: drop exact duplicates, keep order.
  const seen = new Set<string>();
  const unique = models.filter((m) => {
    const key = JSON.stringify([m?.title, m?.provider, m?.model, m?.apiBase]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 2. Exactly one Coder, matched by its own title only, updated in place.
  const withoutAuto = unique.filter((m) => m?.model !== auto.model);
  const coderIndex = withoutAuto.findIndex((m) => m?.title === coder.title);
  const next: Array<T | JsonVynorModel> = [...withoutAuto];
  if (coderIndex >= 0) {
    next[coderIndex] = coder;
    // a second entry with the Coder title is a leftover duplicate
    for (let i = next.length - 1; i > coderIndex; i--) {
      if ((next[i] as any)?.title === coder.title) next.splice(i, 1);
    }
  } else {
    next.unshift(coder);
  }

  // 3. Auto first: the default for new users.
  next.unshift(auto);
  return next;
}
