import type { IDE } from "..";

/**
 * config.yaml fills "${{ secrets.NAME }}" through the platform client.
 * config.json never did, so a model written there with a secret reference
 * sent the text "${{ secrets.NAME }}" as its API key and every request came
 * back as an invalid key. This resolves the same reference for config.json
 * from the IDE's secret store; an unknown name is left as it is.
 */
const SECRET_REF = /^\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}$/;

type WithKey = { apiKey?: string };

export async function resolveSecretRefs<T extends WithKey>(
  items: T[],
  ide: Pick<IDE, "readSecrets">,
): Promise<T[]> {
  const names = new Set<string>();
  for (const item of items) {
    const m =
      typeof item?.apiKey === "string" ? SECRET_REF.exec(item.apiKey) : null;
    if (m) names.add(m[1]);
  }
  if (names.size === 0) return items;

  let secrets: Record<string, string> = {};
  try {
    secrets = await ide.readSecrets([...names]);
  } catch {
    return items; // unreadable store: keep the reference, as before
  }
  return items.map((item) => {
    const m =
      typeof item?.apiKey === "string" ? SECRET_REF.exec(item.apiKey) : null;
    const value = m ? secrets[m[1]] : undefined;
    return value ? { ...item, apiKey: value } : item;
  });
}

/** The model lists of a config.json that can carry a key. */
export async function resolveConfigJsonSecrets<
  C extends { models?: WithKey[]; tabAutocompleteModel?: WithKey | WithKey[] },
>(config: C, ide: Pick<IDE, "readSecrets">): Promise<C> {
  const out: C = { ...config };
  if (Array.isArray(config.models)) {
    out.models = (await resolveSecretRefs(config.models, ide)) as C["models"];
  }
  const tab = config.tabAutocompleteModel;
  if (Array.isArray(tab)) {
    out.tabAutocompleteModel = (await resolveSecretRefs(
      tab,
      ide,
    )) as C["tabAutocompleteModel"];
  } else if (tab) {
    const [one] = await resolveSecretRefs([tab], ide);
    out.tabAutocompleteModel = one as C["tabAutocompleteModel"];
  }
  return out;
}
