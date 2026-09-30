/**
 * VynorAI Smart RAG Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Retrieval-Augmented Generation for code context.
 *
 * Strategy:
 *  1. Segment  — split large code blobs into logical chunks (function/class level)
 *  2. Score    — TF-IDF + recency bias to rank chunks against the user query
 *  3. Inject   — prepend only the top-K relevant chunks to the context window
 *
 * This means: user pastes 10 files (200k chars), RAG selects the 3 most
 * relevant functions/classes (~5k chars) → 97% token reduction on context.
 *
 * Integration: call enrichWithRAG() before applyHybridContext().
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CodeChunk {
  id: string;
  filename: string;
  type: "function" | "class" | "module" | "block";
  name: string;          // function/class name if detectable
  content: string;
  startLine: number;
  tokenEst: number;
  score?: number;        // set during retrieval
}

export interface RAGResult {
  chunks: CodeChunk[];
  totalChunksScanned: number;
  savedTokens: number;
  query: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CHUNK_MAX_LINES    = 80;     // max lines per chunk
const CHUNK_MIN_LINES    = 3;      // ignore tiny fragments
const TOP_K              = 5;      // inject top 5 chunks
const CHARS_PER_TOKEN    = 4;

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split a file into semantic chunks at function/class boundaries.
 * Falls back to fixed-size sliding window if no boundaries found.
 */
export function chunkCode(filename: string, content: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];

  // Detect language from extension
  const ext = filename.split(".").pop() ?? "";
  const isTSJS = ["ts", "tsx", "js", "jsx", "mts", "mjs"].includes(ext);
  const isPython = ext === "py";
  const isRust = ext === "rs";

  // Boundary patterns
  const boundaries: RegExp[] = [];
  if (isTSJS || isRust) {
    boundaries.push(
      /^(export\s+)?(async\s+)?function\s+\w+/,
      /^(export\s+)?(abstract\s+)?class\s+\w+/,
      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
      /^\s*(public|private|protected|static)?\s*(async\s+)?\w+\s*\([^)]*\)\s*[:{]/,
      /^(export\s+)?interface\s+\w+/,
      /^(export\s+)?type\s+\w+\s*=/,
    );
  }
  if (isPython) {
    boundaries.push(
      /^def\s+\w+/,
      /^async\s+def\s+\w+/,
      /^class\s+\w+/,
    );
  }

  // Always split at comment blocks too
  boundaries.push(/^\/\*[\*-]+/, /^#{3,}/);

  if (boundaries.length === 0) {
    // Fixed-size fallback
    return fixedChunks(filename, lines);
  }

  let chunkStart = 0;
  let chunkName = "module";
  let chunkType: CodeChunk["type"] = "module";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimStart();
    const isBoundary = boundaries.some((re) => re.test(line));

    if (isBoundary || i === lines.length - 1) {
      const end = i === lines.length - 1 ? i + 1 : i;
      const chunkLines = lines.slice(chunkStart, end);

      if (chunkLines.length >= CHUNK_MIN_LINES) {
        // Extract name from first boundary line
        const nameMatch = lines[chunkStart]?.match(/(?:function|class|def|const|let|var|interface|type)\s+(\w+)/);
        chunks.push({
          id:        `${filename}:${chunkStart}`,
          filename,
          type:      chunkType,
          name:      nameMatch?.[1] ?? chunkName,
          content:   chunkLines.join("\n"),
          startLine: chunkStart + 1,
          tokenEst:  Math.ceil(chunkLines.join("\n").length / CHARS_PER_TOKEN),
        });
      }

      chunkStart = i;
      const nextLine = lines[i]?.trimStart() ?? "";
      if (/class/.test(nextLine))     chunkType = "class";
      else if (/function|def/.test(nextLine)) chunkType = "function";
      else                            chunkType = "block";
    }
  }

  return chunks.length > 0 ? chunks : fixedChunks(filename, lines);
}

function fixedChunks(filename: string, lines: string[]): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const slice = lines.slice(i, i + CHUNK_MAX_LINES);
    if (slice.length >= CHUNK_MIN_LINES) {
      chunks.push({
        id:        `${filename}:${i}`,
        filename,
        type:      "block",
        name:      `lines ${i + 1}-${i + slice.length}`,
        content:   slice.join("\n"),
        startLine: i + 1,
        tokenEst:  Math.ceil(slice.join("\n").length / CHARS_PER_TOKEN),
      });
    }
    i += CHUNK_MAX_LINES;
  }
  return chunks;
}

// ─── TF-IDF Scorer ────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function tfidf(query: string[], doc: string[]): number {
  const docSet = new Set(doc);
  const docFreq: Record<string, number> = {};
  for (const t of doc) docFreq[t] = (docFreq[t] ?? 0) + 1;

  let score = 0;
  for (const qt of query) {
    if (docSet.has(qt)) {
      const tf  = (docFreq[qt] ?? 0) / Math.max(doc.length, 1);
      const idf = Math.log(1 + 1 / Math.max(doc.filter((t) => t === qt).length, 1));
      score += tf * idf;
    }
  }
  return score;
}

// Bonus: exact sub-string match (for function names in query)
function exactBonus(query: string, content: string): number {
  const words = query.toLowerCase().match(/\b\w{4,}\b/g) ?? [];
  let bonus = 0;
  for (const w of words) {
    if (content.toLowerCase().includes(w)) bonus += 0.15;
  }
  return Math.min(bonus, 0.6); // cap bonus
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export function retrieveTopChunks(
  query: string,
  chunks: CodeChunk[],
  topK = TOP_K
): CodeChunk[] {
  if (chunks.length === 0) return [];

  const qTokens = tokenize(query);
  const scored  = chunks.map((chunk) => ({
    ...chunk,
    score:
      tfidf(qTokens, tokenize(chunk.content)) +
      exactBonus(query, chunk.content),
  }));

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}

// ─── Session-level chunk index (keyed by API key hash + filename) ─────────────
const _index: Map<string, CodeChunk[]> = new Map();

function sessionKey(userId: string, filename: string): string {
  return `${userId}::${filename}`;
}

export function indexFileForUser(userId: string, filename: string, content: string): number {
  const chunks = chunkCode(filename, content);
  _index.set(sessionKey(userId, filename), chunks);
  return chunks.length;
}

export function getUserChunks(userId: string): CodeChunk[] {
  const out: CodeChunk[] = [];
  for (const [k, v] of _index.entries()) {
    if (k.startsWith(userId + "::")) out.push(...v);
  }
  return out;
}

export function clearUserIndex(userId: string): void {
  for (const k of _index.keys()) {
    if (k.startsWith(userId + "::")) _index.delete(k);
  }
}

// ─── Main pipeline integration point ─────────────────────────────────────────

/**
 * Extract code files from messages, index them, inject top-K relevant chunks
 * as a compressed system-level context block.
 *
 * Returns modified body + RAG stats.
 */
export function enrichWithRAG(
  body: any,
  userId: string,
  planId = "free"
): { body: any; rag: RAGResult | null } {
  const messages: any[] = body.messages ?? [];
  if (messages.length === 0) return { body, rag: null };

  // Determine topK by plan
  const topK = planId === "ultra" ? 8 : planId === "pro" ? 6 : planId === "starter" ? 5 : 3;

  // ── Step 1: Extract code blocks from all messages and index ────────────────
  const codeBlockRe = /```[\w]*[ \t]*([^\n]*)\n([\s\S]*?)```/g;
  let scannedFiles = 0;

  for (const msg of messages) {
    const text = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content) ? msg.content.map((p: any) => p.text ?? "").join("") : "";

    let m: RegExpExecArray | null;
    while ((m = codeBlockRe.exec(text)) !== null) {
      const hint    = m[1].trim();
      const content = m[2];
      if (!hint || content.split("\n").length < CHUNK_MIN_LINES) continue;
      indexFileForUser(userId, hint, content);
      scannedFiles++;
    }
    codeBlockRe.lastIndex = 0;
  }

  // ── Step 2: Get query from last user message ────────────────────────────────
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
  const query = typeof lastUser?.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser?.content) ? lastUser.content.map((p: any) => p.text ?? "").join("") : "";

  if (!query || query.length < 10) return { body, rag: null };

  // ── Step 3: Retrieve top-K relevant chunks ──────────────────────────────────
  const allChunks = getUserChunks(userId);
  if (allChunks.length === 0) return { body, rag: null };

  const topChunks  = retrieveTopChunks(query, allChunks, topK);
  if (topChunks.length === 0) return { body, rag: null };

  // ── Step 4: Build RAG context block ────────────────────────────────────────
  const ragBlock = [
    "<!-- VynorAI RAG Context: most relevant code snippets for this query -->",
    ...topChunks.map((c) =>
      `\`\`\`${c.filename.split(".").pop() ?? ""} ${c.filename} (${c.type}: ${c.name}, L${c.startLine})\n${c.content}\n\`\`\``
    ),
    "<!-- end RAG context -->",
  ].join("\n\n");

  const ragTokens  = Math.ceil(ragBlock.length / CHARS_PER_TOKEN);
  const allTokens  = allChunks.reduce((s, c) => s + c.tokenEst, 0);
  const savedTokens = Math.max(0, allTokens - ragTokens);

  // Inject as a system-level message (before first user message)
  const systemIdx = messages.findIndex((m: any) => m.role === "system");
  const newMessages = [...messages];
  const ragMsg = { role: "system", content: ragBlock };

  if (systemIdx >= 0) {
    // Append to existing system message
    newMessages[systemIdx] = {
      ...newMessages[systemIdx],
      content: (newMessages[systemIdx].content ?? "") + "\n\n" + ragBlock,
    };
  } else {
    newMessages.unshift(ragMsg);
  }

  console.log(
    `[SmartRAG] 🔍 chunks: ${allChunks.length} scanned → ${topChunks.length} injected | ` +
    `saved ~${savedTokens} tokens | query: "${query.slice(0, 50)}..."`
  );

  return {
    body: { ...body, messages: newMessages },
    rag: {
      chunks:              topChunks,
      totalChunksScanned:  allChunks.length,
      savedTokens,
      query,
    },
  };
}
