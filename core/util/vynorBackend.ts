/**
 * Best-effort POST of small client reports (feedback, errors, task outcomes)
 * to the VynorAI backend that serves the selected chat model.
 */
export interface VynorChatModel {
  apiBase?: string;
  apiKey?: string;
  providerName?: string;
}

/** True when the model is served by VynorAI and has a key. */
export function isVynorModel(llm: VynorChatModel | undefined): boolean {
  if (!llm?.apiKey) return false;
  return (
    llm.providerName === "vynorai" || (llm.apiBase ?? "").includes("vynor")
  );
}

/** Never throws. Returns true when the backend answered 2xx. */
export async function postToVynor(
  llm: VynorChatModel | undefined,
  route: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!llm || !isVynorModel(llm)) return false;
  const base = (llm.apiBase ?? "").replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/${route.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
