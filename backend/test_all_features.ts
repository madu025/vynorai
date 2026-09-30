import { GOLDEN_TEMPLATES, detectTemplateIntent, checkInstantTemplateMatch } from "./src/services/templateVault.js";
import { indexProjectFiles, getProjectMap, retrieveTopChunks, getUserChunks, clearUserIndex } from "./src/services/ragEngine.js";
import { generateZKUserId, computeAuditHash } from "./src/services/zkShield.js";

async function runTests() {
  console.log("=================================================");
  console.log("🚀 VYNORAI ENTERPRISE TEST SUITE: FULL VERIFICATION");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${details ? ` (${details})` : ""}`);
      failed++;
    }
  }

  // ── TEST 1: Golden Template Vault Integrity ─────────────────────────────────
  console.log("\n📦 1. TESTING GOLDEN TEMPLATES VAULT...");
  assert(GOLDEN_TEMPLATES.length >= 7, "Vault contains required pre-vetted templates", `Found ${GOLDEN_TEMPLATES.length}`);
  
  const expectedTemplates = [
    "sl-mobile-validator",
    "sl-nic-parser",
    "payhere-lkr-gateway",
    "jwt-auth-rotation",
    "security-headers-ratelimit",
    "db-users-schema",
    "nextjs-app-auth",
    "fastapi-jwt-auth",
    "prisma-production-schema"
  ];
  for (const tId of expectedTemplates) {
    const found = GOLDEN_TEMPLATES.find(t => t.id === tId);
    assert(!!found, `Template '${tId}' exists and has code`, `Found: ${!!found}`);
  }

  // ── TEST 2: Instant 0-Token Slash Command & Direct Matches ─────────────────
  console.log("\n⚡ 2. TESTING 0-TOKEN INSTANT DETERMINISTIC DELIVERY...");
  const slashTest1 = checkInstantTemplateMatch("/template sl-phone");
  assert(slashTest1.matched === true, "Slash command /template sl-phone matched");
  assert(slashTest1.template?.id === "sl-mobile-validator", "Correct template ID matched (sl-mobile-validator)");
  assert(slashTest1.responseMarkdown?.includes("07") === true, "Markdown contains phone regex logic");

  const slashTest2 = checkInstantTemplateMatch("give me payhere hash code in typescript");
  assert(slashTest2.matched === true, "Direct phrase 'give me payhere hash code' matched");
  assert(slashTest2.template?.id === "payhere-lkr-gateway", "Matched payhere-lkr-gateway");

  const slashTest3 = checkInstantTemplateMatch("give me nextjs auth boilerplate");
  assert(slashTest3.matched === true, "Direct phrase 'give me nextjs auth boilerplate' matched");
  assert(slashTest3.template?.id === "nextjs-app-auth", "Matched nextjs-app-auth");

  // ── TEST 3: Intent Detection for RAG Injection ──────────────────────────────
  console.log("\n🎯 3. TESTING INTENT DETECTION FOR RAG PIPELINE...");
  const intent1 = detectTemplateIntent("I need to validate national identity card in my app");
  assert(intent1?.id === "sl-nic-parser", "Detected SL NIC intent from natural language");

  const intent2 = detectTemplateIntent("How do I setup refresh token rotation and bcrypt in express?");
  assert(intent2?.id === "jwt-auth-rotation", "Detected JWT auth rotation intent");

  const intent3 = detectTemplateIntent("Show me prisma model for users and subscriptions");
  assert(intent3?.id === "prisma-production-schema", "Detected Prisma schema intent");

  // ── TEST 4: Universal Multi-Language Project Indexer & Smart RAG ────────────
  console.log("\n🌐 4. TESTING UNIVERSAL MULTI-LANGUAGE PROJECT INDEX MAPPING...");
  const testUserId = "user_test_" + Date.now();
  clearUserIndex(testUserId);

  const testProjectFiles = [
    {
      path: "services/auth.ts",
      content: `export async function verifyUserToken(token: string) {\n  return token === 'secret';\n}\n\nexport class AuthController {\n  login() { return true; }\n}`
    },
    {
      path: "main.py",
      content: `def calculate_interest_rate(principal, rate):\n    return principal * rate\n\nclass PaymentManager:\n    def process_sl_payment(self):\n        pass`
    },
    {
      path: "server.go",
      content: `package main\n\nfunc HandleWebhookRoute(w http.ResponseWriter, r *http.Request) {\n    fmt.Println("Webhook received")\n}\n\ntype OrderService struct {\n    ID string\n}`
    },
    {
      path: "UserController.java",
      content: `public class UserController {\n    public void registerNewAccount() {\n        System.out.println("Registering");\n    }\n}`
    },
    {
      path: "auth.php",
      content: `<?php\nclass AuthenticationProvider {\n    public function authenticateSession() {\n        return true;\n    }\n}`
    }
  ];

  const projectMap = indexProjectFiles(testUserId, "my-enterprise-app", testProjectFiles);
  assert(projectMap.fileCount === 5, "Indexed 5 files across 5 different languages");
  assert(projectMap.chunkCount >= 5, "Generated semantic chunks across all languages", `Chunks: ${projectMap.chunkCount}`);
  assert(projectMap.symbolCount >= 5, "Extracted AST symbols across TS, Python, Go, Java, PHP", `Symbols: ${projectMap.symbolCount}`);
  assert(projectMap.languages.includes("ts") && projectMap.languages.includes("py") && projectMap.languages.includes("go"), "Detected languages TS, Python, Go");

  // Check symbol-weighted retrieval
  const userChunks = getUserChunks(testUserId);
  const retrieved = retrieveTopChunks("How does verifyUserToken work in auth?", userChunks, 3, projectMap);
  assert(retrieved.length > 0, "Retrieved top chunks for user query");
  assert(retrieved[0].name.toLowerCase().includes("verifyusertoken"), "Symbol-weighted bonus ranked verifyUserToken as #1 chunk");

  // ── TEST 5: Blockchain Zero-Knowledge ID & Merkle Hash Integrity ───────────
  console.log("\n⛓️ 5. TESTING BLOCKCHAIN MERKLE AUDIT CHAIN & ZK-ID...");
  const zkId1 = generateZKUserId("user_real_email@gmail.com");
  const zkId2 = generateZKUserId("user_real_email@gmail.com");
  assert(zkId1.startsWith("zk_vynor_"), "ZK-ID formatted with prefix zk_vynor_");
  assert(zkId1 === zkId2, "Deterministic HMAC-SHA256 within the same day");
  assert(!zkId1.includes("gmail.com"), "Zero leakage of user email in ZK-ID");

  // Merkle Hash Chaining simulation
  const genesisHash = "GENESIS_BLOCK_VYNORAI_0000000000000000";
  const block1Hash = computeAuditHash(genesisHash, { userId: "u1", tokens: 100, ts: 1000 });
  const block2Hash = computeAuditHash(block1Hash, { userId: "u1", tokens: 250, ts: 1001 });
  const block3Hash = computeAuditHash(block2Hash, { userId: "u1", tokens: 500, ts: 1002 });

  assert(block1Hash !== genesisHash, "Block 1 computed unique SHA-256 hash");
  assert(block2Hash !== block1Hash, "Block 2 chained onto Block 1 hash");
  assert(block3Hash !== block2Hash, "Block 3 chained onto Block 2 hash");

  // Verify tampering detection
  const tamperedBlock1Hash = computeAuditHash(genesisHash, { userId: "u1", tokens: 999999, ts: 1000 }); // Hacker edited tokens!
  assert(tamperedBlock1Hash !== block1Hash, "Tampered tokens immediately break the cryptographic hash");

  // ── TEST 6: 100-Template Compound Scaffold Registry ────────────────────────
  console.log("\n📚 6. TESTING 100-TEMPLATE COMPOUND SCAFFOLD REGISTRY...");
  const { getScaffoldCatalog, resolveCompoundScaffold } = await import("./src/services/scaffoldRegistry.js");
  const catalog = getScaffoldCatalog();
  assert(catalog.domains.length === 11, "All 11 enterprise domains represented", `Found ${catalog.domains.length} domains`);
  assert(catalog.count >= 60, "Catalog contains 60+ pre-mapped production templates", `Found ${catalog.count} templates`);

  const paymentPkg = resolveCompoundScaffold("payment.payhere_checkout");
  assert(!!paymentPkg, "Resolved compound package 'payment.payhere_checkout'");
  assert(paymentPkg?.files.length === 2, "Payment package contains multiple files (service + route)");
  assert(paymentPkg?.securityChecklist.length === 3, "Contains mandatory security checklist");
  assert(paymentPkg?.tests.length === 1, "Contains automated unit test suite");

  console.log("\n=================================================");
  console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
