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
  name: string; // function/class name if detectable
  content: string;
  startLine: number;
  tokenEst: number;
  score?: number; // set during retrieval
}

export interface RAGResult {
  chunks: CodeChunk[];
  totalChunksScanned: number;
  savedTokens: number;
  query: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CHUNK_MAX_LINES = 80; // max lines per chunk
const CHUNK_MIN_LINES = 3; // ignore tiny fragments
const TOP_K = 5; // inject top 5 chunks
const CHARS_PER_TOKEN = 4;

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Split a file into semantic chunks at function/class boundaries.
 * Falls back to fixed-size sliding window if no boundaries found.
 */
export function chunkCode(filename: string, content: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];

  // Detect language from extension
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const isTSJS = ["ts", "tsx", "js", "jsx", "mts", "mjs", "cjs"].includes(ext);
  const isPython = ["py", "pyw"].includes(ext);
  const isRust = ext === "rs";
  const isGo = ext === "go";
  const isJavaFamily = [
    "java",
    "kt",
    "swift",
    "cs",
    "cpp",
    "c",
    "h",
    "hpp",
  ].includes(ext);
  const isPHP = ext === "php";
  const isRuby = ext === "rb";

  // Boundary patterns for semantic code mapping
  const boundaries: RegExp[] = [];
  if (isTSJS || isRust) {
    boundaries.push(
      /^(export\s+)?(async\s+)?function\s+\w+/,
      /^(export\s+)?(abstract\s+)?class\s+\w+/,
      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
      /^\s*(public|private|protected|static)?\s*(async\s+)?\w+\s*\([^)]*\)\s*[:{]/,
      /^(export\s+)?interface\s+\w+/,
      /^(export\s+)?type\s+\w+\s*=/,
      /^(pub\s+)?(fn|struct|impl|enum|trait)\s+\w+/,
    );
  }
  if (isGo) {
    boundaries.push(
      /^func\s+(\([^)]+\)\s+)?\w+/,
      /^type\s+\w+\s+(struct|interface)/,
    );
  }
  if (isJavaFamily) {
    boundaries.push(
      /^\s*(public|private|protected|internal|abstract|static|final|override|\w+)\s+[\w<>\[\],\s]+\s+\w+\s*\([^)]*\)\s*[{;]?/,
      /^\s*(public|private|protected)?\s*(class|interface|enum|record|struct)\s+\w+/,
      /^(fun|func)\s+\w+/,
    );
  }
  if (isPHP) {
    boundaries.push(
      /^\s*(public|private|protected|static)?\s*function\s+\w+/,
      /^(abstract\s+)?class\s+\w+/,
      /^(interface|trait)\s+\w+/,
    );
  }
  if (isRuby) {
    boundaries.push(/^def\s+\w+/, /^class\s+\w+/, /^module\s+\w+/);
  }
  if (isPython) {
    boundaries.push(/^def\s+\w+/, /^async\s+def\s+\w+/, /^class\s+\w+/);
  }

  // Split at major documentation block headers
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
        // Extract name from first boundary line (TS, Python, Java, C#, C++, Go, PHP, Rust)
        const nameMatch =
          lines[chunkStart]?.match(
            /(?:function|class|def|func|fn|const|let|var|interface|type|struct)\s+(\w+)/,
          ) ||
          lines[chunkStart]?.match(
            /\b(?:void|int|string|bool|boolean|async|public|private|protected)\s+(?:[\w<>\[\]]+\s+)?(\w+)\s*\(/,
          ) ||
          lines[chunkStart]?.match(/(\w+)\s*\([^)]*\)\s*[:{]/);
        chunks.push({
          id: `${filename}:${chunkStart}`,
          filename,
          type: chunkType,
          name: nameMatch?.[1] ?? chunkName,
          content: chunkLines.join("\n"),
          startLine: chunkStart + 1,
          tokenEst: Math.ceil(chunkLines.join("\n").length / CHARS_PER_TOKEN),
        });
      }

      chunkStart = i;
      const nextLine = lines[i]?.trimStart() ?? "";
      if (/class/.test(nextLine)) chunkType = "class";
      else if (/function|def/.test(nextLine)) chunkType = "function";
      else chunkType = "block";
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
        id: `${filename}:${i}`,
        filename,
        type: "block",
        name: `lines ${i + 1}-${i + slice.length}`,
        content: slice.join("\n"),
        startLine: i + 1,
        tokenEst: Math.ceil(slice.join("\n").length / CHARS_PER_TOKEN),
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
      const tf = (docFreq[qt] ?? 0) / Math.max(doc.length, 1);
      const idf = Math.log(
        1 + 1 / Math.max(doc.filter((t) => t === qt).length, 1),
      );
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

export interface ProjectSymbol {
  name: string;
  type: "function" | "class" | "module" | "block";
  filename: string;
  startLine: number;
}

export interface ProjectMap {
  userId: string;
  projectRoot: string;
  fileCount: number;
  chunkCount: number;
  symbolCount: number;
  languages: string[];
  symbols: Record<string, ProjectSymbol>;
  updatedAt: number;
}

export function retrieveTopChunks(
  query: string,
  chunks: CodeChunk[],
  topK = TOP_K,
  projectMap?: ProjectMap | null,
): CodeChunk[] {
  if (chunks.length === 0) return [];

  const qTokens = tokenize(query);
  const scored = chunks.map((chunk) => {
    let symbolBonus = 0;
    const chunkNameLower = chunk.name.toLowerCase();
    if (
      qTokens.some(
        (t) => chunkNameLower.includes(t) || t.includes(chunkNameLower),
      )
    ) {
      symbolBonus = 0.45;
    }
    return {
      ...chunk,
      score:
        tfidf(qTokens, tokenize(chunk.content)) +
        exactBonus(query, chunk.content) +
        symbolBonus,
    };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}

// ─── Session-level chunk index (keyed by user ID + filename) ─────────────
const _index: Map<string, CodeChunk[]> = new Map();
const _projectMaps: Map<string, ProjectMap> = new Map();

function sessionKey(userId: string, filename: string): string {
  return `${userId}::${filename}`;
}

export function indexFileForUser(
  userId: string,
  filename: string,
  content: string,
): number {
  const chunks = chunkCode(filename, content);
  _index.set(sessionKey(userId, filename), chunks);
  return chunks.length;
}

/**
 * Universal Project Indexer: Maps an entire workspace/project (regardless of language)
 * into a structured semantic symbol tree & chunk index.
 */
export function indexProjectFiles(
  userId: string,
  projectRoot: string,
  files: Array<{ path: string; content: string }>,
): ProjectMap {
  const languagesSet = new Set<string>();
  const symbols: Record<string, ProjectSymbol> = {};
  let totalChunks = 0;

  for (const f of files) {
    if (!f.path || typeof f.content !== "string") continue;
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    if (ext) languagesSet.add(ext);

    const chunks = chunkCode(f.path, f.content);
    _index.set(sessionKey(userId, f.path), chunks);
    totalChunks += chunks.length;

    for (const chunk of chunks) {
      if (
        chunk.name &&
        chunk.name !== "module" &&
        !chunk.name.startsWith("lines ")
      ) {
        symbols[chunk.name.toLowerCase()] = {
          name: chunk.name,
          type: chunk.type,
          filename: chunk.filename,
          startLine: chunk.startLine,
        };
      }
    }
  }

  const pMap: ProjectMap = {
    userId,
    projectRoot: projectRoot || "workspace",
    fileCount: files.length,
    chunkCount: totalChunks,
    symbolCount: Object.keys(symbols).length,
    languages: Array.from(languagesSet),
    symbols,
    updatedAt: Date.now(),
  };

  _projectMaps.set(userId, pMap);
  return pMap;
}

export function getProjectMap(userId: string): ProjectMap | null {
  return _projectMaps.get(userId) || null;
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
  _projectMaps.delete(userId);
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
  planId = "free",
): { context: string; rag: RAGResult | null } {
  const messages: any[] = body.messages ?? [];
  if (messages.length === 0) return { context: "", rag: null };

  // Only retrieve from an explicitly indexed project (POST /v1/project/index).
  // Re-injecting code that is already in the conversation costs tokens twice.
  const pMap = getProjectMap(userId);
  if (!pMap) return { context: "", rag: null };

  // Determine topK by plan
  const topK =
    planId === "ultra"
      ? 8
      : planId === "pro"
        ? 6
        : planId === "starter"
          ? 5
          : 3;

  // ── Step 1: Get query from last user message ────────────────────────────────
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
  const query =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((p: any) => p.text ?? "").join("")
        : "";

  if (!query || query.length < 10) return { context: "", rag: null };

  // ── Step 2: Retrieve top-K relevant chunks ──────────────────────────────────
  const allChunks = getUserChunks(userId);
  if (allChunks.length === 0) return { context: "", rag: null };

  const topChunks = retrieveTopChunks(query, allChunks, topK, pMap);
  if (topChunks.length === 0) return { context: "", rag: null };

  // ── Step 4: Build RAG context block ────────────────────────────────────────
  const ragBlock = [
    "<!-- VynorAI RAG Context: most relevant code snippets for this query -->",
    ...topChunks.map(
      (c) =>
        `\`\`\`${c.filename.split(".").pop() ?? ""} ${c.filename} (${c.type}: ${c.name}, L${c.startLine})\n${c.content}\n\`\`\``,
    ),
    "<!-- end RAG context -->",
  ].join("\n\n");

  const ragTokens = Math.ceil(ragBlock.length / CHARS_PER_TOKEN);
  const allTokens = allChunks.reduce((s, c) => s + c.tokenEst, 0);
  const savedTokens = Math.max(0, allTokens - ragTokens);

  console.log(
    `[SmartRAG] 🔍 chunks: ${allChunks.length} scanned → ${topChunks.length} selected | ` +
      `saved ~${savedTokens} tokens | query: "${query.slice(0, 50)}..."`,
  );

  // Returned as per-turn context; the caller attaches it to the last user message.
  return {
    context: ragBlock,
    rag: {
      chunks: topChunks,
      totalChunksScanned: allChunks.length,
      savedTokens,
      query,
    },
  };
}
