import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net"; /**
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
/** Private, loopback, link-local and metadata addresses are never fetched. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("only public http(s) URLs");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await dnsLookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
    throw new Error("private or internal address");
  return url;
}

async function fetchUrlText(url: string): Promise<string> {
  // SSRF guard: the server must never read its own network for a prompt.
  await assertPublicUrl(url);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "VynorAI/2.0 (+https://vynorai.com)" },
    // A redirect could point at an internal host after the check.
    redirect: "error",
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
// Only URLs the user explicitly asks to read (@url <link> or @web <link>);
// a URL that merely appears in a prompt or stack trace is not fetched.
const URL_PATTERN = /@(?:url|web)\s+(https?:\/\/[^\s\])"]+)/gi;
const WEB_AT_PATTERN = /@web\s+(.+?)(?:\n|$)/gi;

export function extractWebMentions(text: string): {
  urls: string[];
  queries: string[];
} {
  const urls: string[] = [...text.matchAll(URL_PATTERN)].map((m) => m[1]);
  const queries: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WEB_AT_PATTERN.exec(text)) !== null) {
    const q = m[1].trim();
    if (!/^https?:\/\//i.test(q)) queries.push(q);
  }
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
