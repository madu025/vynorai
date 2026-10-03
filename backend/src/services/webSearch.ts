/**
 * VynorAI @Web Search Service
 * ----------------------------
 * Fills the Cursor "@web" gap: when user types @web <query> or pastes a URL,
 * the backend fetches + summarises the content and injects it as context.
 *
 * Strategy:
 *  1. URL detected  → fetch page, strip HTML → text chunk → inject as context
 *  2. Query string  → DuckDuckGo Instant Answer API (no key needed)
 *               → fetch top 3 results → summarise snippets → inject
 *
 * All results are injected as a system-level context block (same as RAG).
 */

const MAX_PAGE_CHARS = 8_000; // max chars to keep from a fetched page
const FETCH_TIMEOUT_MS = 8_000;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  results: WebResult[];
  injectedTokens: number;
}

// ─── URL fetcher ──────────────────────────────────────────────────────────────
async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "VynorAI/2.0 (+https://vynorai.com)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Basic HTML → text: remove tags, collapse whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{3,}/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
    .slice(0, MAX_PAGE_CHARS);
}

// ─── DuckDuckGo Instant Answer (no API key) ───────────────────────────────────
async function ddgSearch(query: string): Promise<WebResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data: any = await res.json();

  const results: WebResult[] = [];

  // Abstract (top answer)
  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || "",
      snippet: data.AbstractText,
    });
  }
  // Related topics
  for (const t of (data.RelatedTopics ?? []).slice(0, 4)) {
    if (t.Text && t.FirstURL) {
      results.push({
        title: t.Text.slice(0, 80),
        url: t.FirstURL,
        snippet: t.Text,
      });
    }
  }
  return results.slice(0, 5);
}

// ─── @web pattern detector ────────────────────────────────────────────────────
const URL_PATTERN = /https?:\/\/[^\s\])"]+/g;
const WEB_AT_PATTERN = /@web\s+(.+?)(?:\n|$)/gi;

export function extractWebMentions(text: string): {
  urls: string[];
  queries: string[];
} {
  const urls: string[] = [...(text.match(URL_PATTERN) ?? [])];
  const queries: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WEB_AT_PATTERN.exec(text)) !== null) queries.push(m[1].trim());
  WEB_AT_PATTERN.lastIndex = 0;
  return { urls: [...new Set(urls)], queries: [...new Set(queries)] };
}

// ─── Main enricher ────────────────────────────────────────────────────────────
export async function enrichWithWeb(
  body: any,
): Promise<{ context: string; webResult: WebSearchResult | null }> {
  const messages: any[] = body.messages ?? [];
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
  const text =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((p: any) => p.text ?? "").join("")
        : "";

  const { urls, queries } = extractWebMentions(text);
  if (urls.length === 0 && queries.length === 0)
    return { context: "", webResult: null };

  const results: WebResult[] = [];

  // Fetch URLs
  for (const url of urls.slice(0, 3)) {
    try {
      const content = await fetchUrlText(url);
      results.push({ title: url, url, snippet: content });
    } catch (e: any) {
      results.push({
        title: url,
        url,
        snippet: `[Fetch failed: ${e.message}]`,
      });
    }
  }

  // Search queries
  for (const q of queries.slice(0, 2)) {
    try {
      const r = await ddgSearch(q);
      results.push(...r);
    } catch {}
  }

  if (results.length === 0) return { context: "", webResult: null };

  // Build context block
  const contextBlock = [
    "<!-- VynorAI @Web Context -->",
    ...results.map(
      (r, i) => `### [${i + 1}] ${r.title}\nSource: ${r.url}\n\n${r.snippet}`,
    ),
    "<!-- end @web context -->",
  ].join("\n\n");

  const injectedTokens = Math.ceil(contextBlock.length / 4);
  console.log(
    `[@Web] Built ${results.length} results (${injectedTokens} tokens) | urls:${urls.length} queries:${queries.length}`,
  );

  // Returned as per-turn context; the caller attaches it to the last user
  // message so the cached system/history prefix stays unchanged.
  return {
    context: contextBlock,
    webResult: {
      query: [...urls, ...queries].join(", "),
      results,
      injectedTokens,
    },
  };
}
