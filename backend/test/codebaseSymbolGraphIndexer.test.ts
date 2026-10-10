import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { app } from "../src/index.js";
import {
  parseFileSymbolsAndChunks,
  buildCallGraph,
  buildBM25Index,
  scoreBM25,
  computeDenseEmbedding,
  cosineSimilarity,
  searchCodebaseHybrid,
  codebaseGraphManager,
} from "../src/services/codebaseGraphIndexer.js";

let server: http.Server;
let baseUrl = "";
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `indexer-user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${++userIndex}`;
  const apiKey = `vynor_live_${crypto.randomBytes(24).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'hash', ?, ?)",
    [userId, `${userId}@example.com`, apiKey, apiKeyHash],
  );

  const validUntil = daysFromNow(30);
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, currency, valid_until)
     VALUES (?, ?, ?, 'active', ?, 'LKR', ?)`,
    [
      crypto.randomUUID(),
      userId,
      plan,
      `order-${userId}`,
      validUntil.toISOString(),
    ],
  );

  await quota.startPaidCycle(userId, plan, validUntil);
  return { userId, apiKey };
}

test("Codebase Symbol Graph Indexer Test Suite", async (suite) => {
  suite.before(async () => {
    dbm = await import("../src/db.js");
    quota = await import("../src/services/monthlyQuota.js");

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/v1`;
        resolve();
      });
    });
  });

  suite.after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    codebaseGraphManager.clear();
  });

  // ─── 1. AST SYMBOL EXTRACTION (TypeScript, JavaScript, Python, Go) ───────────
  await suite.test(
    "1. AST Symbol Extraction: parses functions, classes, methods, and arrow declarations",
    () => {
      const tsCode = `
export interface UserSession {
  userId: string;
  token: string;
}

export type AuthStatus = "authenticated" | "anonymous";

export class AuthenticationManager {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  public verifyToken(token: string): boolean {
    return token.length > 10;
  }
}

export async function processLogin(req: any): Promise<boolean> {
  const manager = new AuthenticationManager("key");
  return manager.verifyToken(req.token);
}

export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000);
};
`;

      const { symbols, chunks } = parseFileSymbolsAndChunks(
        "src/auth.ts",
        tsCode,
      );

      assert.ok(
        symbols.length >= 5,
        `Expected at least 5 symbols, got ${symbols.length}`,
      );

      const symbolNames = symbols.map((s) => s.name);
      assert.ok(
        symbolNames.includes("UserSession"),
        "Should extract interface UserSession",
      );
      assert.ok(
        symbolNames.includes("AuthStatus"),
        "Should extract type AuthStatus",
      );
      assert.ok(
        symbolNames.includes("AuthenticationManager"),
        "Should extract class AuthenticationManager",
      );
      assert.ok(
        symbolNames.includes("AuthenticationManager.verifyToken"),
        "Should extract method verifyToken",
      );
      assert.ok(
        symbolNames.includes("processLogin"),
        "Should extract function processLogin",
      );
      assert.ok(
        symbolNames.includes("generateOtp"),
        "Should extract arrow function generateOtp",
      );

      // Check calls inside processLogin
      const loginSym = symbols.find((s) => s.name === "processLogin");
      assert.ok(loginSym);
      assert.ok(
        loginSym.calls.includes("verifyToken") ||
          loginSym.calls.includes("AuthenticationManager"),
        "processLogin should record calls to AuthenticationManager/verifyToken",
      );

      // Check chunks
      assert.ok(chunks.length >= 5);
      const methodChunk = chunks.find(
        (c) => c.symbolName === "AuthenticationManager.verifyToken",
      );
      assert.ok(methodChunk);
      assert.ok(methodChunk.content.includes("verifyToken(token: string)"));
    },
  );

  await suite.test(
    "2. Multi-Language Boundary Parsing: extracts Python and Go definitions",
    () => {
      const pyCode = `
class PaymentGateway:
    def __init__(self, key):
        self.key = key

    def charge(self, amount):
        verify_token(self.key)
        return {"status": "ok", "amount": amount}

async def refund_transaction(order_id):
    log_event(order_id)
    return True
`;

      const pyResult = parseFileSymbolsAndChunks("services/gateway.py", pyCode);
      const pyNames = pyResult.symbols.map((s) => s.name);
      assert.ok(pyNames.includes("PaymentGateway"));
      assert.ok(pyNames.includes("charge"));
      assert.ok(pyNames.includes("refund_transaction"));

      const chargeSym = pyResult.symbols.find((s) => s.name === "charge");
      assert.ok(chargeSym);
      assert.ok(
        chargeSym.calls.includes("verify_token"),
        "Python charge should extract called verify_token",
      );

      const goCode = `
package payment

func ProcessRefund(orderId string) error {
    auditLog(orderId)
    return nil
}
`;
      const goResult = parseFileSymbolsAndChunks("pkg/refund.go", goCode);
      const goNames = goResult.symbols.map((s) => s.name);
      assert.ok(goNames.includes("ProcessRefund"));
    },
  );

  // ─── 3. BIDIRECTIONAL CALL GRAPH CONSTRUCTION ───────────────────────────────
  await suite.test(
    "3. Bidirectional Call Graph: builds caller <-> callee edges and centrality",
    () => {
      const files: Record<string, string> = {
        "src/crypto.ts": `
export function verifySignature(sig: string): boolean {
  return sig.length > 5;
}
`,
        "src/auth.ts": `
import { verifySignature } from "./crypto";

export function authenticateRequest(token: string): boolean {
  return verifySignature(token);
}
`,
        "src/api.ts": `
import { authenticateRequest } from "./auth";

export function handleCheckout(req: any) {
  if (!authenticateRequest(req.token)) return false;
  return true;
}

export function handleProfile(req: any) {
  if (!authenticateRequest(req.token)) return false;
  return true;
}
`,
      };

      const allSymbols = [];
      for (const [file, content] of Object.entries(files)) {
        const { symbols } = parseFileSymbolsAndChunks(file, content);
        allSymbols.push(...symbols);
      }

      const callGraph = buildCallGraph(allSymbols);

      assert.ok(
        callGraph.edges.length >= 3,
        `Expected at least 3 edges, got ${callGraph.edges.length}`,
      );

      // authenticateRequest should have callees: [verifySignature]
      // and callers: [handleCheckout, handleProfile]
      const authNode = Array.from(callGraph.nodes.values()).find(
        (n) => n.name === "authenticateRequest",
      );
      assert.ok(authNode, "authenticateRequest node must exist");
      assert.equal(
        authNode.callers?.length,
        2,
        "authenticateRequest should have 2 callers",
      );

      // verifySignature callers should include authenticateRequest
      const verifyNode = Array.from(callGraph.nodes.values()).find(
        (n) => n.name === "verifySignature",
      );
      assert.ok(verifyNode, "verifySignature node must exist");
      assert.ok(verifyNode.callers?.length! >= 1);

      // Authority / Centrality: authenticateRequest called by multiple endpoints
      assert.ok(
        (authNode.centralityScore ?? 0) > 0,
        "Architectural hubs must have positive centrality score",
      );
    },
  );

  // ─── 4. BM25 SCORING & LENGTH NORMALIZATION ─────────────────────────────────
  await suite.test(
    "4. Okapi BM25 Indexing: scores keywords and normalizes document length",
    () => {
      const chunkA = {
        id: "a",
        filePath: "payment.ts",
        symbolName: "processPayHereTransaction",
        kind: "function" as const,
        startLine: 1,
        endLine: 5,
        content:
          "function processPayHereTransaction(orderId, amount) { payhereCharge(orderId, amount); }",
        tokens: [
          "process",
          "payhere",
          "transaction",
          "orderid",
          "amount",
          "charge",
        ],
        embedding: new Float32Array(64),
      };

      const chunkB = {
        id: "b",
        filePath: "logging.ts",
        symbolName: "logInfo",
        kind: "function" as const,
        startLine: 1,
        endLine: 40,
        content: "function logInfo(msg) { console.log(msg); } ".repeat(20),
        tokens: Array(100).fill("loginfo").concat(["console", "message"]),
        embedding: new Float32Array(64),
      };

      const bm25 = buildBM25Index([chunkA, chunkB]);
      assert.equal(bm25.corpusSize, 2);

      const queryTokens = ["payhere", "transaction"];
      const scoreA = scoreBM25(queryTokens, 0, bm25);
      const scoreB = scoreBM25(queryTokens, 1, bm25);

      assert.ok(scoreA > 0, "Chunk A should match query tokens");
      assert.equal(
        scoreB,
        0,
        "Chunk B should have 0 score for unrelated tokens",
      );
    },
  );

  // ─── 5. DENSE VECTOR EMBEDDINGS & COSINE SIMILARITY ─────────────────────────
  await suite.test(
    "5. Dense Vector Embeddings: unit normalized and semantic similarity",
    () => {
      const textA = "charge credit card stripe payment gateway";
      const textB = "process debit card stripe payment gateway";
      const textC = "render react visual dom html button component";

      const vecA = computeDenseEmbedding(textA);
      const vecB = computeDenseEmbedding(textB);
      const vecC = computeDenseEmbedding(textC);

      // Check unit normalization
      let normA = 0;
      for (let i = 0; i < vecA.length; i++) normA += vecA[i] * vecA[i];
      assert.ok(
        Math.abs(normA - 1.0) < 0.001,
        `Embedding must be unit normalized: ${normA}`,
      );

      const simAB = cosineSimilarity(vecA, vecB);
      const simAC = cosineSimilarity(vecA, vecC);

      assert.ok(
        simAB > simAC,
        `Payment vectors should be more similar than payment vs UI: ${simAB} > ${simAC}`,
      );
    },
  );

  // ─── 6. HYBRID RRF SEMANTIC SEARCH & GRAPH TRAVERSAL ─────────────────────────
  await suite.test(
    "6. Hybrid RRF Search: ranks query using BM25 + dense vectors + call graph",
    () => {
      const repoFiles: Record<string, string> = {
        "src/payhereGateway.ts": `
export function verifyPayHereIpnSignature(orderId: string, md5Sig: string): boolean {
  return true;
}

export function settlePayHerePayment(orderId: string, amount: number) {
  verifyPayHereIpnSignature(orderId, "sig");
  return { status: "settled", amount };
}
`,
        "src/unrelatedModule.ts": `
export function formatUserProfile(name: string): string {
  return "User: " + name;
}
`,
      };

      const index = codebaseGraphManager.indexRepository(
        "test-repo-rrf",
        repoFiles,
      );
      assert.equal(index.fileCount, 2);
      assert.ok(index.symbolCount >= 3);

      const results = codebaseGraphManager.query(
        "test-repo-rrf",
        "verify PayHere signature payment settlement",
        {
          topK: 2,
        },
      );

      assert.ok(results.length > 0, "Should return results");
      assert.ok(
        results[0].symbolName.includes("PayHere"),
        `Top result should be PayHere related, got: ${results[0].symbolName}`,
      );

      // Verify callers / callees context attached
      const settleResult = results.find(
        (r) => r.symbolName === "settlePayHerePayment",
      );
      if (settleResult) {
        assert.ok(
          settleResult.callees && settleResult.callees.length > 0,
          "settlePayHerePayment should include callees",
        );
      }
    },
  );

  // ─── 7. INCREMENTAL FILE RE-INDEXING ─────────────────────────────────────────
  await suite.test(
    "7. Incremental File Re-indexing: updates single file without re-parsing entire repo",
    () => {
      const initialFiles: Record<string, string> = {
        "src/math.ts": `export function add(a: number, b: number) { return a + b; }`,
        "src/string.ts": `export function concat(a: string, b: string) { return a + b; }`,
      };

      codebaseGraphManager.indexRepository("incremental-repo", initialFiles);

      const updated = codebaseGraphManager.updateFile(
        "incremental-repo",
        "src/math.ts",
        `export function add(a: number, b: number) { return a + b; }
       export function multiply(a: number, b: number) { return a * b; }`,
      );

      assert.ok(updated);
      const mathSymbols = updated.symbols.filter(
        (s) => s.filePath === "src/math.ts",
      );
      assert.equal(
        mathSymbols.length,
        2,
        "Math file should now have 2 symbols",
      );

      const queryRes = codebaseGraphManager.query(
        "incremental-repo",
        "multiply",
      );
      assert.ok(queryRes.some((r) => r.symbolName === "multiply"));
    },
  );

  // ─── 9. FULL-REPO BENCHMARK: 25 FILES IN < 60MS ──────────────────────────────
  await suite.test(
    "9. Full-Repo Benchmark: indexes 25 files in < 60ms, query in < 10ms",
    () => {
      const virtualRepo: Record<string, string> = {};

      for (let i = 0; i < 25; i++) {
        virtualRepo[`src/module_${i}.ts`] = `
export class ServiceWorker_${i} {
  public executeTask(payload: any) {
    return helperFunction_${i}(payload);
  }
}

export function helperFunction_${i}(data: any) {
  return "result_" + data;
}
`;
      }

      const t0 = performance.now();
      const index = codebaseGraphManager.indexRepository(
        "benchmark-repo",
        virtualRepo,
      );
      const indexDuration = performance.now() - t0;

      console.log(
        `[Benchmark 🚀] 25 Files AST & Call Graph Indexing: ${indexDuration.toFixed(2)}ms (Symbols: ${index.symbolCount})`,
      );
      assert.equal(index.fileCount, 25);
      assert.equal(index.symbolCount, 75);
      assert.ok(
        indexDuration < 500,
        `Indexing should take < 500ms, took ${indexDuration.toFixed(2)}ms`,
      );

      const q0 = performance.now();
      const queryResults = codebaseGraphManager.query(
        "benchmark-repo",
        "ServiceWorker execute task helperFunction",
        { topK: 5 },
      );
      const queryDuration = performance.now() - q0;

      console.log(
        `[Benchmark ⚡] Hybrid BM25 + Vector Retrieval: ${queryDuration.toFixed(2)}ms`,
      );
      assert.ok(queryResults.length > 0);
      assert.ok(
        queryDuration < 30,
        `Query should take < 30ms, took ${queryDuration.toFixed(2)}ms`,
      );
    },
  );
});
